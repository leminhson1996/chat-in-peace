# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Chat In Peace** — a self-hosted, personal-use, end-to-end encrypted chat service.

- **Backend**: Go (`backend/`) — `net/http` + `gorilla/websocket`, no framework
- **Frontend**: React + TypeScript (`frontend/`) — Vite, Tailwind, Zustand, PWA
- **Database**: Redis only (no SQL)
- **Transport**: WebSocket for real-time messaging; REST for auth, history, admin
- **Encryption**: End-to-end via Web Crypto API (ECDH P-256 + AES-256-GCM); the server only ever sees ciphertext + public keys

---

## Development Commands

### Local dev (hot-reload)
```bash
docker-compose up -d redis              # Redis only
cd backend && go run ./cmd/server       # Backend on :8080
cd frontend && npm run dev              # Frontend on :5173, proxies /api + /ws → :8080
```

### Production (Docker)
```bash
cp .env.example .env        # fill in JWT_SECRET
docker-compose up -d        # builds + starts redis + backend + frontend on :80
docker-compose logs -f      # follow logs (first run prints admin password)
docker-compose down         # stop all
```

### Backend only
```bash
cd backend
go build ./...              # verify all packages compile
make build                  # → backend/bin/server
```

### Frontend only
```bash
cd frontend
npm run build               # production PWA build
npx tsc -p tsconfig.app.json --noEmit   # type-check only
```

---

## Backend Architecture (`backend/`)

```
cmd/server/main.go          HTTP routes, middleware, bootstrap
internal/config/            env var loading via godotenv
internal/auth/              JWT (golang-jwt/jwt v5) + bcrypt; ExtractToken handles header + ?token= param
internal/redis/             all Redis data access; ZSET for messages; dmKey() sorts usernames
internal/chat/hub.go        WebSocket Hub (goroutine-safe); Client read/write goroutines
internal/admin/handlers.go  admin-only CRUD handlers
internal/push/push.go       Web Push (VAPID) sender; no-op when env vars unset
```

**Key invariants:**
- Messages stored as ZSETs scored by Unix ms timestamp; `ZREMRANGEBYSCORE` prunes by TTL on every write (no background job)
- DM key format: `dm:{min(a,b)}:{max(a,b)}:messages` — always lexicographically sorted to avoid dual keys
- Config TTL of `0` means "keep forever" — skip pruning
- WebSocket upgrade uses `?token=<jwt>` query param (browsers can't send Authorization headers on WS)
- Bootstrap: on first run with no `user:admin` in Redis, a random password is printed to stdout and the admin user is created
- `GET /api/rooms` is **filtered by membership** — only rooms the caller is in are returned
- **DM WS echo**: when a client sends a DM, the hub sends the wire frame to *both* parties with `From` set to the **peer** (the other party) in each delivery — recipient sees `From = sender`, sender sees `From = recipient`. This lets the client derive the correct ECDH shared key and bucket the message into the right conversation on both sides (ECDH is symmetric, so `From` always identifying the peer is what matters; the sender is in `msg.sender`).

**Authorization model for rooms:**
- Anyone in a room can `POST /api/rooms/{id}/members` (must hold the room key to wrap it)
- Only the room's `created_by` can `PATCH /api/rooms/{id}` (rename) or `DELETE /api/rooms/{id}`
- `requireAdmin` is only used for user CRUD and global settings — room ownership lives on the room itself, not on the admin role

**Adding a new HTTP route:** register in `main.go` using Go 1.22 pattern syntax (`METHOD /path/{param}`). Use `requireAuth` or `requireAdmin` middleware wrappers.

**Web Push:** opt-in via `VAPID_PUBLIC`/`VAPID_PRIVATE`/`VAPID_SUBJECT` env vars. When set, `hub.go` sends a generic notification (sender name only — no plaintext, since server has only ciphertext) to every offline recipient of a room/DM message. Subscriptions live in a Redis SET at `user:{username}:push`. Dead 404/410 subscriptions are pruned automatically on next send.

---

## Frontend Architecture (`frontend/src/`)

```
crypto/index.ts                          all Web Crypto API logic — never import crypto primitives elsewhere
push.ts                                  Web Push subscribe/unsubscribe helpers (talks to PushManager + backend)
sw.ts                                    custom service worker (vite-plugin-pwa injectManifest); handles push + notificationclick
store/authStore.ts                       JWT, username, role (persisted to localStorage via zustand/middleware)
store/chatStore.ts                       rooms list, decrypted messages map, active conversation, per-conversation unread counts; exports Room type
hooks/useCrypto.ts                       initializes key pair on login; encrypt/decrypt + wrapRoomKeyForUser
hooks/useWebSocket.ts                    connects on login; dispatches incoming events; exponential backoff reconnect
hooks/useAuth.ts                         login() + logout() — clears crypto cache on logout
api/client.ts                            typed fetch wrapper; reads token from authStore.getState() (no prop drilling)
pages/LoginPage.tsx                      login form
pages/ChatPage.tsx                       top-level layout — loads rooms, wires up crypto + WS hooks
pages/AdminPage.tsx                      Users tab (CRUD) + Settings tab (history TTL)
components/Sidebar/                      channel list + DM list + user area
components/ChatArea/ChatArea.tsx         message list (grouped), input
components/ChatArea/NewRoomModal.tsx     create channel
components/ChatArea/AddMemberModal.tsx   invite — filters by pubkey availability
components/ChatArea/RoomSettingsModal.tsx owner-only rename + delete
```

### Crypto flow

1. `useCrypto` calls `getOrGenerateKeyPair()` on mount → private key stored as a **non-extractable** `CryptoKey` in IndexedDB; public key uploaded to server
2. **DM encryption**: ECDH(my private, peer public) → HKDF → AES-256-GCM key, cached per peer
3. **Room encryption**: room creator generates a random AES-256-GCM room key; for each member, wraps the room key using an ephemeral ECDH + AES-GCM and stores the blob at `room:{id}:key:{username}`
4. **Adding a member**: caller fetches their own wrapped room key, unwraps it client-side, re-wraps with the new member's public key, POSTs the wrapped blob with the member's username — server never sees the unwrapped key
5. Decrypted messages live only in `chatStore` in memory; only ciphertext is ever persisted

### Pubkey gating (important)

A user has no pubkey in Redis until they log in for the first time. **Without a pubkey, they cannot be added to encrypted rooms** — the wrapping math has no key to wrap to. The Add Member modal queries `GET /api/users` (which returns `has_pubkey` per user) and splits candidates into **eligible** (shown in the dropdown) and **pending** (shown in a warning panel listing usernames).

### Zustand gotcha

Selectors must return primitives or stable references — `useStore(s => ({ a: s.a, b: s.b }))` creates a new object every render and triggers React error #185 (max update depth). Use one selector per field, or use `useShallow` from `zustand/shallow`.

### State key convention

`convKey(conv)` in `chatStore.ts` produces the map key for `messages` and `unread` — `room:{id}` or `dm:{username}`.

### Unread tracking

`chatStore.unread: Record<convKey, number>` powers the sidebar badges. Rules baked into the store:

- `appendMessage(key, msg, bumpUnread = true)` increments `unread[key]` unless the conversation is currently `active` or the caller passes `bumpUnread=false`.
- `useWebSocket` passes `bumpUnread=false` when `msg.sender === myUsername` so the server-side DM echo (and any self-echo on rooms) doesn't notify you about your own messages.
- `setActive(conv)` clears `unread[convKey(conv)]` — opening a conversation marks it read. There is no separate "mark read" action.

Sidebar reads `unread` directly; channel rows get a count pill on the right, DM rows get a red dot on the avatar's top-right corner, and the row text bolds while unread.

### DM list source

`ChatPage.tsx` populates the sidebar DM list from `GET /api/users` filtered to `has_pubkey === true && username !== self`, unioned with peers surfaced via shared rooms. **Don't** derive the DM list from room members alone — `GET /api/rooms` is membership-filtered, so a user with no shared rooms would see an empty DM list. Users without a pubkey (never logged in) are intentionally hidden because you can't encrypt to them anyway — same gating as `AddMemberModal`.

The same fetch also seeds `chatStore.userIcons` (see below), so the DM list, message avatars, and sidebar user-area all stay in sync.

### Avatars and icons

User avatars are rendered via `components/UserAvatar.tsx`. It reads `chatStore.userIcons[username]` and, if present, looks the id up in the whitelist in `src/icons.tsx` (curated lucide icons) and renders the icon centred on a colored circle. If no icon is set or the id is unknown, it falls back to the first letter of the username — that fallback is intentional and must not be removed.

**Icon flow:**

1. Admin opens AdminPage → clicks an avatar in the user table → picker modal lists icons from `ICONS` in `src/icons.tsx`.
2. Picker calls `PATCH /api/admin/users/{username}/icon` with `{ icon: "<id>" | "" }`. Empty string clears the field (server uses `HDEL`).
3. On success, AdminPage updates both its local user list and `chatStore.setUserIcon(username, icon)` so the change shows up immediately in the sidebar and ongoing chat messages without a refetch.
4. On other clients, the new icon is picked up the next time `GET /api/users` runs (currently on ChatPage mount/room-change).

**Adding a new icon to the picker:** import the lucide component in `src/icons.tsx`, add an `{ id, label, Component }` entry. **Never rename an existing `id`** — it's persisted in Redis and orphaning a selection means users silently lose their icon.

### Adding a new page

Add a `<Route>` in `App.tsx`; protect with `RequireAuth` or `RequireAdmin`.

---

## Environment Variables

Root `.env` (consumed by docker-compose, passed into backend container):
```
JWT_SECRET=<random 32+ char string — required>
VAPID_PUBLIC=<base64url public key — optional, enables Web Push when set>
VAPID_PRIVATE=<base64url private key — optional, paired with public>
VAPID_SUBJECT=mailto:you@example.com   # contact for push services; required if VAPID_* set
```

Backend-only `.env` (only used for local `go run`, not in Docker):
```
PORT=8080
REDIS_URL=redis://localhost:6379
JWT_SECRET=<random 32+ char string — required>
VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT  # same as root .env, optional
```

In Docker, `REDIS_URL` defaults to `redis://redis:6379` via `docker-compose.yml`.

---

## Redis Key Schema

```
# Users
users                           SET    — all usernames
user:{username}                 HASH   — { password_hash, role, created_at, icon? }
user:{username}:pubkey          STRING — base64 SPKI ECDH public key (set on first login)

# Rooms
rooms                           SET    — all room IDs
room:{id}                       HASH   — { name, created_by, created_at }
room:{id}:members               SET    — member usernames
room:{id}:key:{username}        STRING — JSON-packed wrapped room key (ephemeral ECDH + AES-GCM)
room:{id}:messages              ZSET   — score=Unix ms, value=JSON { id, sender, ts, iv, ct }

# DMs
dm:{a}:{b}:messages             ZSET   — same shape; a < b lexicographically

# Push subscriptions
user:{username}:push            SET    — JSON blobs {endpoint, keys: {p256dh, auth}}, one per device

# Config
config:history_ttl_days         STRING — "0" = keep forever, else integer days
```

---

## Key HTTP Routes

```
POST   /api/auth/login                  → JWT
GET    /api/auth/me                     → { username, role, has_pubkey }

POST   /api/users/me/pubkey             upload own public key
GET    /api/users/{username}/pubkey     fetch any user's public key
GET    /api/users                       list { username, has_pubkey, icon } — used by DM list + AddMemberModal + avatars

GET    /api/rooms                       list rooms caller is a member of (with created_by + members)
POST   /api/rooms                       create room (creator uploads own wrapped key)
PATCH  /api/rooms/{id}                  rename — owner only (created_by)
DELETE /api/rooms/{id}                  delete — owner only
GET    /api/rooms/{id}/key              fetch caller's wrapped room key
POST   /api/rooms/{id}/members          add member — caller must be a member; body { username, wrapped_key }
GET    /api/rooms/{id}/history          decrypted-on-client message history
GET    /api/dm/{username}/history       DM history with another user
GET    /ws                              WebSocket upgrade (?token=<jwt>)

GET    /api/push/vapid-public           → { public_key, enabled } — public (no auth needed)
POST   /api/users/me/push               register a device subscription (PushSubscription.toJSON())
DELETE /api/users/me/push               unregister a device subscription (same body)

# Admin only
GET/POST/DELETE/PATCH /api/admin/users[...]
PATCH               /api/admin/users/{username}/icon     body { icon } — "" clears it
DELETE              /api/admin/rooms/{id}              (admin override)
POST                /api/admin/rooms/{id}/members      (admin override; still needs a wrapped key)
DELETE              /api/admin/rooms/{id}/members/{u}
GET/PUT             /api/admin/settings                history_ttl_days
```

---

## Docker Setup

- `backend/Dockerfile` — multi-stage Go build → minimal Alpine
- `frontend/Dockerfile` — multi-stage Node build → `nginx:alpine` serving static files
- `frontend/nginx.conf` — serves SPA with fallback, proxies `/api/` and `/ws` to the `backend` service
- `docker-compose.yml` — `redis` (internal), `backend` (internal), `frontend` (publishes `:80`); only the frontend's port 80 is exposed
- Go version: the backend `Dockerfile` must match `go.mod`'s `go` directive (currently 1.26)
