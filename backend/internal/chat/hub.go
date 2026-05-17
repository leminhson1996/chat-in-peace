package chat

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"chatinpeace/internal/push"
	rdb "chatinpeace/internal/redis"
)

// ── Wire types ─────────────────────────────────────────────────────────────

type IncomingMsg struct {
	Action string `json:"action"` // send_room | send_dm | join_room
	RoomID string `json:"room_id,omitempty"`
	To     string `json:"to,omitempty"`
	IV     string `json:"iv,omitempty"`
	CT     string `json:"ct,omitempty"`
}

type OutgoingMsg struct {
	Event  string      `json:"event"` // message | dm | error
	RoomID string      `json:"room_id,omitempty"`
	From   string      `json:"from,omitempty"`
	Msg    *rdb.Message `json:"msg,omitempty"`
	Error  string      `json:"error,omitempty"`
}

// ── Client ─────────────────────────────────────────────────────────────────

type Client struct {
	hub      *Hub
	conn     *websocket.Conn
	username string
	send     chan []byte
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	c.conn.SetReadLimit(64 * 1024)
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
		c.hub.incoming <- clientMsg{client: c, data: data}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// ── Hub ────────────────────────────────────────────────────────────────────

type clientMsg struct {
	client *Client
	data   []byte
}

type Hub struct {
	mu         sync.RWMutex
	clients    map[string]*Client        // username → client
	rooms      map[string]map[string]bool // roomID → set of usernames

	register   chan *Client
	unregister chan *Client
	incoming   chan clientMsg

	redis      *rdb.Client
	push       *push.Sender
}

func NewHub(redis *rdb.Client, pushSender *push.Sender) *Hub {
	return &Hub{
		clients:    make(map[string]*Client),
		rooms:      make(map[string]map[string]bool),
		register:   make(chan *Client, 64),
		unregister: make(chan *Client, 64),
		incoming:   make(chan clientMsg, 256),
		redis:      redis,
		push:       pushSender,
	}
}

// isOnline reports whether a user has at least one active WS connection on this
// node. Used to gate push notifications — online users get the WS frame, offline
// users get a push.
func (h *Hub) isOnline(username string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.clients[username] != nil
}

func (h *Hub) Run() {
	for {
		select {
		case c := <-h.register:
			h.mu.Lock()
			h.clients[c.username] = c
			h.mu.Unlock()

		case c := <-h.unregister:
			h.mu.Lock()
			if h.clients[c.username] == c {
				delete(h.clients, c.username)
				close(c.send)
			}
			for _, members := range h.rooms {
				delete(members, c.username)
			}
			h.mu.Unlock()

		case cm := <-h.incoming:
			h.handle(cm)
		}
	}
}

func (h *Hub) handle(cm clientMsg) {
	var in IncomingMsg
	if err := json.Unmarshal(cm.data, &in); err != nil {
		h.sendError(cm.client, "invalid message")
		return
	}

	ctx := context.Background()
	ttl, _ := h.redis.GetHistoryTTL(ctx)

	switch in.Action {
	case "join_room":
		h.mu.Lock()
		if _, ok := h.rooms[in.RoomID]; !ok {
			h.rooms[in.RoomID] = make(map[string]bool)
		}
		h.rooms[in.RoomID][cm.client.username] = true
		h.mu.Unlock()

	case "send_room":
		msg := rdb.Message{
			ID:     uuid.NewString(),
			Sender: cm.client.username,
			Ts:     time.Now().UnixMilli(),
			IV:     in.IV,
			CT:     in.CT,
		}
		if err := h.redis.SaveRoomMessage(ctx, in.RoomID, msg, ttl); err != nil {
			log.Printf("save room msg: %v", err)
		}
		h.broadcastRoom(in.RoomID, OutgoingMsg{
			Event:  "message",
			RoomID: in.RoomID,
			Msg:    &msg,
		})
		go h.pushRoom(in.RoomID, cm.client.username)

	case "send_dm":
		log.Printf("dm: %s -> %s", cm.client.username, in.To)
		msg := rdb.Message{
			ID:     uuid.NewString(),
			Sender: cm.client.username,
			Ts:     time.Now().UnixMilli(),
			IV:     in.IV,
			CT:     in.CT,
		}
		if err := h.redis.SaveDM(ctx, cm.client.username, in.To, msg, ttl); err != nil {
			log.Printf("save dm: %v", err)
		}
		// For each side, From identifies the *peer* (the other party in the DM).
		// Recipient sees From = sender; sender sees From = recipient. This lets the
		// client derive the correct ECDH shared key and bucket the message into the
		// right conversation.
		h.sendTo(in.To, OutgoingMsg{Event: "dm", From: cm.client.username, Msg: &msg})
		h.sendTo(cm.client.username, OutgoingMsg{Event: "dm", From: in.To, Msg: &msg})
		go h.pushDM(cm.client.username, in.To)

	default:
		h.sendError(cm.client, "unknown action")
	}
}

func (h *Hub) broadcastRoom(roomID string, out OutgoingMsg) {
	data, _ := json.Marshal(out)
	h.mu.RLock()
	members := h.rooms[roomID]
	h.mu.RUnlock()
	for username := range members {
		h.mu.RLock()
		c := h.clients[username]
		h.mu.RUnlock()
		if c != nil {
			select {
			case c.send <- data:
			default:
			}
		}
	}
}

func (h *Hub) sendTo(username string, out OutgoingMsg) {
	data, _ := json.Marshal(out)
	h.mu.RLock()
	c := h.clients[username]
	h.mu.RUnlock()
	if c != nil {
		select {
		case c.send <- data:
		default:
		}
	}
}

// pushDM notifies the recipient of a DM if they're offline. Payload is
// intentionally generic — the server can't see the plaintext, so we only
// surface the sender's name.
func (h *Hub) pushDM(sender, to string) {
	if !h.push.Enabled() {
		log.Printf("push dm %s->%s: skipped (push disabled)", sender, to)
		return
	}
	if h.isOnline(to) {
		log.Printf("push dm %s->%s: skipped (%s online)", sender, to, to)
		return
	}
	log.Printf("push dm %s->%s: sending", sender, to)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	h.push.Send(ctx, to, push.Payload{
		Title: "New message from " + sender,
		Body:  "Tap to open the conversation",
		Tag:   "dm:" + sender,
		URL:   "/",
	})
}

// pushRoom notifies every member of the room except the sender and anyone
// currently connected.
func (h *Hub) pushRoom(roomID, sender string) {
	if !h.push.Enabled() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	members, err := h.redis.RoomMembers(ctx, roomID)
	if err != nil {
		return
	}
	info, _ := h.redis.GetRoom(ctx, roomID)
	roomName := info["name"]
	if roomName == "" {
		roomName = "a channel"
	}
	for _, m := range members {
		if m == sender || h.isOnline(m) {
			continue
		}
		h.push.Send(ctx, m, push.Payload{
			Title: "#" + roomName,
			Body:  "New message from " + sender,
			Tag:   "room:" + roomID,
			URL:   "/",
		})
	}
}

func (h *Hub) sendError(c *Client, msg string) {
	data, _ := json.Marshal(OutgoingMsg{Event: "error", Error: msg})
	select {
	case c.send <- data:
	default:
	}
}

// ── Upgrade ────────────────────────────────────────────────────────────────

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request, username string) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	c := &Client{hub: h, conn: conn, username: username, send: make(chan []byte, 256)}
	h.register <- c
	go c.writePump()
	go c.readPump()
}
