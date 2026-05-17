package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

type Client struct {
	rdb *redis.Client
}

func New(url string) (*Client, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	rdb := redis.NewClient(opt)
	if err := rdb.Ping(context.Background()).Err(); err != nil {
		return nil, fmt.Errorf("redis ping: %w", err)
	}
	return &Client{rdb: rdb}, nil
}

// ── Users ──────────────────────────────────────────────────────────────────

func (c *Client) UserExists(ctx context.Context, username string) (bool, error) {
	return c.rdb.SIsMember(ctx, "users", username).Result()
}

func (c *Client) CreateUser(ctx context.Context, username, passwordHash, role string) error {
	pipe := c.rdb.TxPipeline()
	pipe.SAdd(ctx, "users", username)
	pipe.HSet(ctx, "user:"+username, map[string]any{
		"password_hash": passwordHash,
		"role":          role,
		"created_at":    time.Now().UnixMilli(),
	})
	_, err := pipe.Exec(ctx)
	return err
}

func (c *Client) GetUser(ctx context.Context, username string) (map[string]string, error) {
	return c.rdb.HGetAll(ctx, "user:"+username).Result()
}

func (c *Client) ListUsers(ctx context.Context) ([]string, error) {
	return c.rdb.SMembers(ctx, "users").Result()
}

func (c *Client) DeleteUser(ctx context.Context, username string) error {
	pipe := c.rdb.TxPipeline()
	pipe.SRem(ctx, "users", username)
	pipe.Del(ctx, "user:"+username, "user:"+username+":pubkey", "user:"+username+":push")
	_, err := pipe.Exec(ctx)
	return err
}

// ── Push subscriptions ─────────────────────────────────────────────────────
// Stored as a SET of JSON strings at user:{username}:push. Each member is a
// PushSubscription blob {endpoint, keys: {p256dh, auth}} as produced by the
// browser. SET semantics mean re-subscribing the same device is idempotent.

func (c *Client) AddPushSub(ctx context.Context, username, sub string) error {
	return c.rdb.SAdd(ctx, "user:"+username+":push", sub).Err()
}

func (c *Client) RemovePushSub(ctx context.Context, username, sub string) error {
	return c.rdb.SRem(ctx, "user:"+username+":push", sub).Err()
}

func (c *Client) GetPushSubs(ctx context.Context, username string) ([]string, error) {
	return c.rdb.SMembers(ctx, "user:"+username+":push").Result()
}

func (c *Client) UpdatePassword(ctx context.Context, username, hash string) error {
	return c.rdb.HSet(ctx, "user:"+username, "password_hash", hash).Err()
}

func (c *Client) SetUserPubkey(ctx context.Context, username, pubkey string) error {
	return c.rdb.Set(ctx, "user:"+username+":pubkey", pubkey, 0).Err()
}

func (c *Client) GetUserPubkey(ctx context.Context, username string) (string, error) {
	return c.rdb.Get(ctx, "user:"+username+":pubkey").Result()
}

// Wrapped private key for cross-device recovery. The blob is opaque to the
// server — it's the client's ECDH private key (PKCS#8) encrypted with an
// AES-GCM key derived from the user's login password via PBKDF2. The server
// never sees the password or the unwrapped key.
func (c *Client) SetWrappedPrivkey(ctx context.Context, username, blob string) error {
	return c.rdb.Set(ctx, "user:"+username+":wrapped_privkey", blob, 0).Err()
}

func (c *Client) GetWrappedPrivkey(ctx context.Context, username string) (string, error) {
	return c.rdb.Get(ctx, "user:"+username+":wrapped_privkey").Result()
}

// SetUserIcon writes the chosen icon identifier into the user hash. An empty
// string clears it — empty means "fall back to the first letter of the
// username".
func (c *Client) SetUserIcon(ctx context.Context, username, icon string) error {
	if icon == "" {
		return c.rdb.HDel(ctx, "user:"+username, "icon").Err()
	}
	return c.rdb.HSet(ctx, "user:"+username, "icon", icon).Err()
}

// SetUserColor writes the chosen color identifier into the user hash. An empty
// string clears it — empty means "fall back to the default accent color".
func (c *Client) SetUserColor(ctx context.Context, username, color string) error {
	if color == "" {
		return c.rdb.HDel(ctx, "user:"+username, "color").Err()
	}
	return c.rdb.HSet(ctx, "user:"+username, "color", color).Err()
}

// ── Rooms ──────────────────────────────────────────────────────────────────

func (c *Client) CreateRoom(ctx context.Context, id, name, createdBy string) error {
	pipe := c.rdb.TxPipeline()
	pipe.SAdd(ctx, "rooms", id)
	pipe.HSet(ctx, "room:"+id, map[string]any{
		"name":       name,
		"created_by": createdBy,
		"created_at": time.Now().UnixMilli(),
	})
	pipe.SAdd(ctx, "room:"+id+":members", createdBy)
	_, err := pipe.Exec(ctx)
	return err
}

func (c *Client) GetRoom(ctx context.Context, id string) (map[string]string, error) {
	return c.rdb.HGetAll(ctx, "room:"+id).Result()
}

func (c *Client) RenameRoom(ctx context.Context, id, name string) error {
	return c.rdb.HSet(ctx, "room:"+id, "name", name).Err()
}

func (c *Client) ListRooms(ctx context.Context) ([]string, error) {
	return c.rdb.SMembers(ctx, "rooms").Result()
}

func (c *Client) DeleteRoom(ctx context.Context, id string) error {
	members, _ := c.rdb.SMembers(ctx, "room:"+id+":members").Result()
	pipe := c.rdb.TxPipeline()
	pipe.SRem(ctx, "rooms", id)
	pipe.Del(ctx, "room:"+id, "room:"+id+":members", "room:"+id+":messages")
	for _, m := range members {
		pipe.Del(ctx, "room:"+id+":key:"+m)
	}
	_, err := pipe.Exec(ctx)
	return err
}

func (c *Client) RoomMembers(ctx context.Context, id string) ([]string, error) {
	return c.rdb.SMembers(ctx, "room:"+id+":members").Result()
}

func (c *Client) AddRoomMember(ctx context.Context, roomID, username string) error {
	return c.rdb.SAdd(ctx, "room:"+roomID+":members", username).Err()
}

func (c *Client) RemoveRoomMember(ctx context.Context, roomID, username string) error {
	pipe := c.rdb.TxPipeline()
	pipe.SRem(ctx, "room:"+roomID+":members", username)
	pipe.Del(ctx, "room:"+roomID+":key:"+username)
	_, err := pipe.Exec(ctx)
	return err
}

func (c *Client) SetRoomKey(ctx context.Context, roomID, username, wrappedKey string) error {
	return c.rdb.Set(ctx, "room:"+roomID+":key:"+username, wrappedKey, 0).Err()
}

func (c *Client) GetRoomKey(ctx context.Context, roomID, username string) (string, error) {
	return c.rdb.Get(ctx, "room:"+roomID+":key:"+username).Result()
}

// ── Messages ───────────────────────────────────────────────────────────────

type Message struct {
	ID     string `json:"id"`
	Sender string `json:"sender"`
	Ts     int64  `json:"ts"`
	IV     string `json:"iv"`
	CT     string `json:"ct"`
}

func (c *Client) SaveMessage(ctx context.Context, key string, msg Message, ttlDays int) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	score := float64(msg.Ts)
	pipe := c.rdb.TxPipeline()
	pipe.ZAdd(ctx, key, redis.Z{Score: score, Member: string(data)})
	if ttlDays > 0 {
		cutoff := float64(time.Now().Add(-time.Duration(ttlDays)*24*time.Hour).UnixMilli())
		pipe.ZRemRangeByScore(ctx, key, "0", fmt.Sprintf("%f", cutoff))
	}
	_, err = pipe.Exec(ctx)
	return err
}

func (c *Client) GetMessages(ctx context.Context, key string, ttlDays int) ([]Message, error) {
	var min string
	if ttlDays > 0 {
		cutoff := time.Now().Add(-time.Duration(ttlDays) * 24 * time.Hour).UnixMilli()
		min = strconv.FormatInt(cutoff, 10)
	} else {
		min = "-inf"
	}
	strs, err := c.rdb.ZRangeByScore(ctx, key, &redis.ZRangeBy{
		Min: min,
		Max: "+inf",
	}).Result()
	if err != nil {
		return nil, err
	}
	msgs := make([]Message, 0, len(strs))
	for _, s := range strs {
		var m Message
		if err := json.Unmarshal([]byte(s), &m); err == nil {
			msgs = append(msgs, m)
		}
	}
	return msgs, nil
}

func dmKey(a, b string) string {
	if a < b {
		return "dm:" + a + ":" + b + ":messages"
	}
	return "dm:" + b + ":" + a + ":messages"
}

func (c *Client) SaveDM(ctx context.Context, from, to string, msg Message, ttlDays int) error {
	return c.SaveMessage(ctx, dmKey(from, to), msg, ttlDays)
}

func (c *Client) GetDMHistory(ctx context.Context, a, b string, ttlDays int) ([]Message, error) {
	return c.GetMessages(ctx, dmKey(a, b), ttlDays)
}

func (c *Client) SaveRoomMessage(ctx context.Context, roomID string, msg Message, ttlDays int) error {
	return c.SaveMessage(ctx, "room:"+roomID+":messages", msg, ttlDays)
}

func (c *Client) GetRoomHistory(ctx context.Context, roomID string, ttlDays int) ([]Message, error) {
	return c.GetMessages(ctx, "room:"+roomID+":messages", ttlDays)
}

// ── Config ─────────────────────────────────────────────────────────────────

func (c *Client) GetHistoryTTL(ctx context.Context) (int, error) {
	val, err := c.rdb.Get(ctx, "config:history_ttl_days").Result()
	if err == redis.Nil {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(val)
}

func (c *Client) SetHistoryTTL(ctx context.Context, days int) error {
	return c.rdb.Set(ctx, "config:history_ttl_days", days, 0).Err()
}
