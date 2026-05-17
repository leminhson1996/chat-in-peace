package admin

import (
	"encoding/json"
	"net/http"
	"strconv"

	"chatinpeace/internal/auth"
	rdb "chatinpeace/internal/redis"
)

type Handler struct {
	redis  *rdb.Client
	secret string
}

func New(redis *rdb.Client, secret string) *Handler {
	return &Handler{redis: redis, secret: secret}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func readJSON(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}

// ── Users ──────────────────────────────────────────────────────────────────

func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	names, err := h.redis.ListUsers(r.Context())
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	type userInfo struct {
		Username string `json:"username"`
		Role     string `json:"role"`
		Icon     string `json:"icon"`
	}
	result := make([]userInfo, 0, len(names))
	for _, name := range names {
		u, _ := h.redis.GetUser(r.Context(), name)
		result = append(result, userInfo{Username: name, Role: u["role"], Icon: u["icon"]})
	}
	writeJSON(w, 200, result)
}

func (h *Handler) CreateUser(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := readJSON(r, &body); err != nil || body.Username == "" || body.Password == "" {
		writeJSON(w, 400, map[string]string{"error": "username and password required"})
		return
	}
	if body.Role != "admin" {
		body.Role = "user"
	}
	exists, _ := h.redis.UserExists(r.Context(), body.Username)
	if exists {
		writeJSON(w, 409, map[string]string{"error": "user already exists"})
		return
	}
	hash, err := auth.HashPassword(body.Password)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "hash error"})
		return
	}
	if err := h.redis.CreateUser(r.Context(), body.Username, hash, body.Role); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 201, map[string]string{"username": body.Username})
}

func (h *Handler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	username := r.PathValue("username")
	if err := h.redis.DeleteUser(r.Context(), username); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(204)
}

func (h *Handler) SetIcon(w http.ResponseWriter, r *http.Request) {
	username := r.PathValue("username")
	exists, _ := h.redis.UserExists(r.Context(), username)
	if !exists {
		writeJSON(w, 404, map[string]string{"error": "user not found"})
		return
	}
	var body struct {
		Icon string `json:"icon"`
	}
	if err := readJSON(r, &body); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid body"})
		return
	}
	if err := h.redis.SetUserIcon(r.Context(), username, body.Icon); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]string{"username": username, "icon": body.Icon})
}

func (h *Handler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	username := r.PathValue("username")
	var body struct {
		Password string `json:"password"`
	}
	if err := readJSON(r, &body); err != nil || body.Password == "" {
		writeJSON(w, 400, map[string]string{"error": "password required"})
		return
	}
	hash, err := auth.HashPassword(body.Password)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "hash error"})
		return
	}
	if err := h.redis.UpdatePassword(r.Context(), username, hash); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(204)
}

// ── Rooms ──────────────────────────────────────────────────────────────────

func (h *Handler) DeleteRoom(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.redis.DeleteRoom(r.Context(), id); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(204)
}

func (h *Handler) AddMember(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Username   string `json:"username"`
		WrappedKey string `json:"wrapped_key"`
	}
	if err := readJSON(r, &body); err != nil || body.Username == "" {
		writeJSON(w, 400, map[string]string{"error": "username required"})
		return
	}
	if err := h.redis.AddRoomMember(r.Context(), id, body.Username); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	if body.WrappedKey != "" {
		h.redis.SetRoomKey(r.Context(), id, body.Username, body.WrappedKey)
	}
	w.WriteHeader(204)
}

func (h *Handler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	username := r.PathValue("username")
	if err := h.redis.RemoveRoomMember(r.Context(), id, username); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(204)
}

// ── Settings ───────────────────────────────────────────────────────────────

func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	ttl, err := h.redis.GetHistoryTTL(r.Context())
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]int{"history_ttl_days": ttl})
}

func (h *Handler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		HistoryTTLDays string `json:"history_ttl_days"`
	}
	if err := readJSON(r, &body); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid body"})
		return
	}
	days, err := strconv.Atoi(body.HistoryTTLDays)
	if err != nil || days < 0 {
		writeJSON(w, 400, map[string]string{"error": "history_ttl_days must be a non-negative integer"})
		return
	}
	if err := h.redis.SetHistoryTTL(r.Context(), days); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]int{"history_ttl_days": days})
}
