package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"

	"chatinpeace/internal/admin"
	"chatinpeace/internal/auth"
	"chatinpeace/internal/chat"
	"chatinpeace/internal/config"
	"chatinpeace/internal/push"
	rdb "chatinpeace/internal/redis"
)

func main() {
	cfg := config.Load()

	redis, err := rdb.New(cfg.RedisURL)
	if err != nil {
		log.Fatalf("redis: %v", err)
	}

	bootstrap(redis, cfg.JWTSecret)

	pushSender := push.New(redis, cfg.VAPIDPublic, cfg.VAPIDPrivate, cfg.VAPIDSubject)
	hub := chat.NewHub(redis, pushSender)
	go hub.Run()

	adminH := admin.New(redis, cfg.JWTSecret)

	mux := http.NewServeMux()

	// ── Auth ────────────────────────────────────────────────────────────
	mux.HandleFunc("POST /api/auth/login", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, 400, map[string]string{"error": "invalid body"})
			return
		}
		u, err := redis.GetUser(r.Context(), body.Username)
		if err != nil || u["password_hash"] == "" {
			writeJSON(w, 401, map[string]string{"error": "invalid credentials"})
			return
		}
		if !auth.CheckPassword(u["password_hash"], body.Password) {
			writeJSON(w, 401, map[string]string{"error": "invalid credentials"})
			return
		}
		token, err := auth.IssueToken(cfg.JWTSecret, body.Username, u["role"])
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": "token error"})
			return
		}
		writeJSON(w, 200, map[string]string{"token": token, "username": body.Username, "role": u["role"]})
	})

	mux.HandleFunc("GET /api/auth/me", requireAuth(cfg.JWTSecret, func(w http.ResponseWriter, r *http.Request, claims *auth.Claims) {
		pubkey, _ := redis.GetUserPubkey(r.Context(), claims.Username)
		u, _ := redis.GetUser(r.Context(), claims.Username)
		writeJSON(w, 200, map[string]string{
			"username":   claims.Username,
			"role":       claims.Role,
			"has_pubkey": fmt.Sprintf("%v", pubkey != ""),
			"icon":       u["icon"],
			"color":      u["color"],
		})
	}))

	// ── Pubkeys ─────────────────────────────────────────────────────────
	mux.HandleFunc("POST /api/users/me/pubkey", requireAuth(cfg.JWTSecret, func(w http.ResponseWriter, r *http.Request, claims *auth.Claims) {
		var body struct {
			Pubkey string `json:"pubkey"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Pubkey == "" {
			writeJSON(w, 400, map[string]string{"error": "pubkey required"})
			return
		}
		if err := redis.SetUserPubkey(r.Context(), claims.Username, body.Pubkey); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		w.WriteHeader(204)
	}))

	mux.HandleFunc("GET /api/users/{username}/pubkey", requireAuth(cfg.JWTSecret, func(w http.ResponseWriter, r *http.Request, claims *auth.Claims) {
		username := r.PathValue("username")
		pubkey, err := redis.GetUserPubkey(r.Context(), username)
		if err != nil {
			writeJSON(w, 404, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, 200, map[string]string{"pubkey": pubkey})
	}))

	// ── Web Push ────────────────────────────────────────────────────────
	// Public key is published so the frontend can call pushManager.subscribe.
	mux.HandleFunc("GET /api/push/vapid-public", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{
			"public_key": cfg.VAPIDPublic,
			"enabled":    pushSender.Enabled(),
		})
	})

	// Register a device. Body is the JSON the browser produced from
	// PushSubscription.toJSON(); stored verbatim so SET semantics dedupe.
	mux.HandleFunc("POST /api/users/me/push", requireAuth(cfg.JWTSecret, func(w http.ResponseWriter, r *http.Request, claims *auth.Claims) {
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 4096))
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": "body too large"})
			return
		}
		var probe struct {
			Endpoint string `json:"endpoint"`
			Keys     struct {
				P256dh string `json:"p256dh"`
				Auth   string `json:"auth"`
			} `json:"keys"`
		}
		if err := json.Unmarshal(raw, &probe); err != nil || probe.Endpoint == "" || probe.Keys.P256dh == "" || probe.Keys.Auth == "" {
			writeJSON(w, 400, map[string]string{"error": "invalid subscription"})
			return
		}
		if err := redis.AddPushSub(r.Context(), claims.Username, string(raw)); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		w.WriteHeader(204)
	}))

	// Unsubscribe a device. Body is the same blob registered earlier.
	mux.HandleFunc("DELETE /api/users/me/push", requireAuth(cfg.JWTSecret, func(w http.ResponseWriter, r *http.Request, claims *auth.Claims) {
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 4096))
		if err != nil || len(raw) == 0 {
			writeJSON(w, 400, map[string]string{"error": "body required"})
			return
		}
		if err := redis.RemovePushSub(r.Context(), claims.Username, string(raw)); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		w.WriteHeader(204)
	}))

	// ── Rooms ────────────────────────────────────────────────────────────
	mux.HandleFunc("GET /api/rooms", requireAuth(cfg.JWTSecret, func(w http.ResponseWriter, r *http.Request, claims *auth.Claims) {
		ids, _ := redis.ListRooms(r.Context())
		type roomInfo struct {
			ID        string   `json:"id"`
			Name      string   `json:"name"`
			CreatedBy string   `json:"created_by"`
			Members   []string `json:"members"`
		}
		result := make([]roomInfo, 0, len(ids))
		for _, id := range ids {
			members, _ := redis.RoomMembers(r.Context(), id)
			isMember := false
			for _, m := range members {
				if m == claims.Username {
					isMember = true
					break
				}
			}
			if !isMember {
				continue
			}
			info, _ := redis.GetRoom(r.Context(), id)
			result = append(result, roomInfo{
				ID: id, Name: info["name"], CreatedBy: info["created_by"], Members: members,
			})
		}
		writeJSON(w, 200, result)
	}))

	// Rename a room — owner only
	mux.HandleFunc("PATCH /api/rooms/{id}", requireAuth(cfg.JWTSecret, func(w http.ResponseWriter, r *http.Request, claims *auth.Claims) {
		id := r.PathValue("id")
		info, _ := redis.GetRoom(r.Context(), id)
		if info["created_by"] != claims.Username {
			writeJSON(w, 403, map[string]string{"error": "only the room owner can rename it"})
			return
		}
		var body struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
			writeJSON(w, 400, map[string]string{"error": "name required"})
			return
		}
		if err := redis.RenameRoom(r.Context(), id, body.Name); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]string{"id": id, "name": body.Name})
	}))

	// Delete a room — owner only
	mux.HandleFunc("DELETE /api/rooms/{id}", requireAuth(cfg.JWTSecret, func(w http.ResponseWriter, r *http.Request, claims *auth.Claims) {
		id := r.PathValue("id")
		info, _ := redis.GetRoom(r.Context(), id)
		if info["created_by"] != claims.Username {
			writeJSON(w, 403, map[string]string{"error": "only the room owner can delete it"})
			return
		}
		if err := redis.DeleteRoom(r.Context(), id); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		w.WriteHeader(204)
	}))

	// Add a member to a room — caller must already be a member (they have the key)
	mux.HandleFunc("POST /api/rooms/{id}/members", requireAuth(cfg.JWTSecret, func(w http.ResponseWriter, r *http.Request, claims *auth.Claims) {
		id := r.PathValue("id")
		members, _ := redis.RoomMembers(r.Context(), id)
		isMember := false
		for _, m := range members {
			if m == claims.Username {
				isMember = true
				break
			}
		}
		if !isMember {
			writeJSON(w, 403, map[string]string{"error": "only members can add new members"})
			return
		}
		var body struct {
			Username   string `json:"username"`
			WrappedKey string `json:"wrapped_key"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Username == "" || body.WrappedKey == "" {
			writeJSON(w, 400, map[string]string{"error": "username and wrapped_key required"})
			return
		}
		// Verify the user exists
		exists, _ := redis.UserExists(r.Context(), body.Username)
		if !exists {
			writeJSON(w, 404, map[string]string{"error": "user not found"})
			return
		}
		redis.AddRoomMember(r.Context(), id, body.Username)
		redis.SetRoomKey(r.Context(), id, body.Username, body.WrappedKey)
		w.WriteHeader(204)
	}))

	// List all users with pubkey status (for the add-member dropdown).
	mux.HandleFunc("GET /api/users", requireAuth(cfg.JWTSecret, func(w http.ResponseWriter, r *http.Request, claims *auth.Claims) {
		names, err := redis.ListUsers(r.Context())
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		type userInfo struct {
			Username  string `json:"username"`
			HasPubkey bool   `json:"has_pubkey"`
			Icon      string `json:"icon"`
			Color     string `json:"color"`
		}
		result := make([]userInfo, 0, len(names))
		for _, n := range names {
			pk, _ := redis.GetUserPubkey(r.Context(), n)
			u, _ := redis.GetUser(r.Context(), n)
			result = append(result, userInfo{Username: n, HasPubkey: pk != "", Icon: u["icon"], Color: u["color"]})
		}
		writeJSON(w, 200, result)
	}))

	mux.HandleFunc("POST /api/rooms", requireAuth(cfg.JWTSecret, func(w http.ResponseWriter, r *http.Request, claims *auth.Claims) {
		var body struct {
			Name       string `json:"name"`
			WrappedKey string `json:"wrapped_key"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
			writeJSON(w, 400, map[string]string{"error": "name required"})
			return
		}
		id := fmt.Sprintf("%x", rand.Int63())
		if err := redis.CreateRoom(r.Context(), id, body.Name, claims.Username); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		if body.WrappedKey != "" {
			redis.SetRoomKey(r.Context(), id, claims.Username, body.WrappedKey)
		}
		writeJSON(w, 201, map[string]string{"id": id, "name": body.Name})
	}))

	mux.HandleFunc("GET /api/rooms/{id}/key", requireAuth(cfg.JWTSecret, func(w http.ResponseWriter, r *http.Request, claims *auth.Claims) {
		id := r.PathValue("id")
		key, err := redis.GetRoomKey(r.Context(), id, claims.Username)
		if err != nil {
			writeJSON(w, 404, map[string]string{"error": "no key found"})
			return
		}
		writeJSON(w, 200, map[string]string{"wrapped_key": key})
	}))

	// ── History ──────────────────────────────────────────────────────────
	mux.HandleFunc("GET /api/rooms/{id}/history", requireAuth(cfg.JWTSecret, func(w http.ResponseWriter, r *http.Request, claims *auth.Claims) {
		id := r.PathValue("id")
		ttl, _ := redis.GetHistoryTTL(r.Context())
		msgs, err := redis.GetRoomHistory(r.Context(), id, ttl)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, msgs)
	}))

	mux.HandleFunc("GET /api/dm/{username}/history", requireAuth(cfg.JWTSecret, func(w http.ResponseWriter, r *http.Request, claims *auth.Claims) {
		other := r.PathValue("username")
		ttl, _ := redis.GetHistoryTTL(r.Context())
		msgs, err := redis.GetDMHistory(r.Context(), claims.Username, other, ttl)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, msgs)
	}))

	// ── WebSocket ────────────────────────────────────────────────────────
	mux.HandleFunc("GET /ws", func(w http.ResponseWriter, r *http.Request) {
		tokenStr := auth.ExtractToken(r)
		claims, err := auth.ParseToken(cfg.JWTSecret, tokenStr)
		if err != nil {
			http.Error(w, "unauthorized", 401)
			return
		}
		hub.ServeWS(w, r, claims.Username)
	})

	// ── Admin ────────────────────────────────────────────────────────────
	mux.HandleFunc("GET /api/admin/users", requireAdmin(cfg.JWTSecret, adminH.ListUsers))
	mux.HandleFunc("POST /api/admin/users", requireAdmin(cfg.JWTSecret, adminH.CreateUser))
	mux.HandleFunc("DELETE /api/admin/users/{username}", requireAdmin(cfg.JWTSecret, adminH.DeleteUser))
	mux.HandleFunc("PATCH /api/admin/users/{username}/password", requireAdmin(cfg.JWTSecret, adminH.ResetPassword))
	mux.HandleFunc("PATCH /api/admin/users/{username}/icon", requireAdmin(cfg.JWTSecret, adminH.SetIcon))
	mux.HandleFunc("DELETE /api/admin/rooms/{id}", requireAdmin(cfg.JWTSecret, adminH.DeleteRoom))
	mux.HandleFunc("POST /api/admin/rooms/{id}/members", requireAdmin(cfg.JWTSecret, adminH.AddMember))
	mux.HandleFunc("DELETE /api/admin/rooms/{id}/members/{username}", requireAdmin(cfg.JWTSecret, adminH.RemoveMember))
	mux.HandleFunc("GET /api/admin/settings", requireAdmin(cfg.JWTSecret, adminH.GetSettings))
	mux.HandleFunc("PUT /api/admin/settings", requireAdmin(cfg.JWTSecret, adminH.UpdateSettings))

	// ── CORS + serve ─────────────────────────────────────────────────────
	addr := ":" + cfg.Port
	log.Printf("Chat In Peace listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, cors(mux)))
}

// ── Middleware helpers ──────────────────────────────────────────────────────

type authHandler func(http.ResponseWriter, *http.Request, *auth.Claims)

func requireAuth(secret string, h authHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, err := auth.ParseToken(secret, auth.ExtractToken(r))
		if err != nil {
			writeJSON(w, 401, map[string]string{"error": "unauthorized"})
			return
		}
		h(w, r, claims)
	}
}

func requireAdmin(secret string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, err := auth.ParseToken(secret, auth.ExtractToken(r))
		if err != nil || claims.Role != "admin" {
			writeJSON(w, 403, map[string]string{"error": "forbidden"})
			return
		}
		h(w, r)
	}
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

func bootstrap(redis *rdb.Client, secret string) {
	ctx := context.Background()
	exists, _ := redis.UserExists(ctx, "admin")
	if exists {
		return
	}
	password := randomPassword(12)
	hash, _ := auth.HashPassword(password)
	if err := redis.CreateUser(ctx, "admin", hash, "admin"); err != nil {
		log.Fatalf("bootstrap admin: %v", err)
	}
	log.Printf("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	log.Printf("  Admin account created")
	log.Printf("  Username: admin")
	log.Printf("  Password: %s", password)
	log.Printf("  Change this password immediately in the Admin UI")
	log.Printf("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
}

const charset = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func randomPassword(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = charset[rand.Intn(len(charset))]
	}
	return string(b)
}
