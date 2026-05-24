# Chat In Peace

A self-hosted, end-to-end encrypted chat service for small private groups. Runs on a single VM with Docker, stores everything in Redis, and the server only ever sees ciphertext.

- **End-to-end encryption** for both DMs and rooms, via the Web Crypto API (ECDH P-256 + AES-256-GCM). Private keys are non-extractable, stored in IndexedDB; the server holds public keys and wrapped room keys, never plaintext.
- **Cross-device history recovery** with a password-wrapped private key, plus **self-serve password change** that re-wraps the recovery blob client-side so prior history stays decryptable.
- **Backend** in Go (`net/http` + `gorilla/websocket`, no framework).
- **Frontend** in React + TypeScript (Vite, Tailwind, Zustand), shipped as an installable PWA with a custom service worker.
- **Storage**: Redis only — messages live as TTL-pruned ZSETs, fetched in cursor-paginated pages so very long histories don't blow up first paint.
- **Real-time** over WebSocket; REST for auth, history, and admin.
- **Fluent Emoji picker** in the message input, with Microsoft's 3D emoji set served from a CDN (no asset bundling).
- **Optional Web Push** to offline recipients (Chrome, Firefox, and Safari/macOS/iOS).

---

## Quick start (Docker)

```bash
cp .env.example .env
# edit .env — set JWT_SECRET to a random 32+ char string

docker-compose up -d
docker-compose logs -f backend   # the first run prints the admin password
```

App is served on `http://localhost`. Log in as `admin` with the password from the logs, create a few users, then have each user log in once so their public key gets uploaded.

To stop:

```bash
docker-compose down
```

---

## Local development

```bash
docker-compose up -d redis              # Redis only
cd backend && go run ./cmd/server       # backend on :8080
cd frontend && npm run dev              # frontend on :5173 (proxies /api + /ws → :8080)
```

`backend/.env` needs `JWT_SECRET`. Push notifications stay disabled until VAPID env vars are set (see below).

---

## Web Push (optional)

Push to offline devices is disabled by default. To enable it:

1. Generate a VAPID keypair:

    ```bash
    npx web-push generate-vapid-keys
    ```

2. Add to `.env`:

    ```
    VAPID_PUBLIC=<base64url public key>
    VAPID_PRIVATE=<base64url private key>
    VAPID_SUBJECT=mailto:you@example.com
    ```

    `VAPID_SUBJECT` **must** start with `mailto:` or `https:` — the backend fatals at boot otherwise. Apple's web push service is strict enough to reject malformed `sub` claims (FCM and Mozilla are not), so the validation catches a class of bug that's otherwise only visible to Safari users.

3. Restart the backend. Users then opt in per-device from the sidebar bell icon.

Push payloads contain only the sender's name — never message contents — because the server has only ciphertext.

---

## Encryption model

- **DMs**: each side derives a shared key via ECDH(my private, peer public) → HKDF → AES-256-GCM. Symmetric, so both sides compute the same key.
- **Rooms**: the creator generates a random AES-256-GCM room key; for each member, the key is wrapped using ephemeral ECDH + AES-GCM and stored as an opaque blob the server can't decrypt. Adding a member means an existing member unwraps their own copy and re-wraps it for the invitee — the server never holds the unwrapped key.
- **Storage**: only ciphertext is persisted in Redis. Decrypted messages live in client memory and are discarded on reload.
- **TTL**: messages are pruned by age on every write according to `config:history_ttl_days` (admin-configurable; `0` = keep forever).

Pubkey gating: a user has no pubkey in Redis until they log in for the first time. Without a pubkey they cannot be added to encrypted rooms — the UI surfaces this in the "Add Member" modal as a pending-users panel.

### Cross-device history recovery

The first time a fresh keypair is generated for a user, the client wraps the PKCS#8 private key with an AES-GCM key derived from their **login password** (PBKDF2-SHA-256, 600 000 iterations, salt = username) and uploads the opaque blob to `user:{username}:wrapped_privkey`. The server can read neither the password nor the unwrapped key.

When the PWA is reinstalled on the same device — or installed fresh on a new device — login fetches that blob, derives the same wrapping key from the password, unwraps the private key, and stores it in IndexedDB. Because the recovered private key matches the original, every wrapped room key on the server still unwraps correctly and DM ciphertext still decrypts → **all message history is restored automatically.**

Caveats:

- **Login password = recovery passphrase.** Anyone with the password can recover the history; conversely, *losing* the password loses the history.
- **Self-serve password change preserves recovery; admin reset does not.** A user changing their own password (key icon in the sidebar) re-wraps the recovery blob locally with the new password — old history stays recoverable on other devices. An admin password reset (Admin → Users) only changes the hash; it can't re-wrap the blob because the admin doesn't know the user's plaintext password, so existing history won't be recoverable from a fresh install until the user logs in once and regenerates a recovery blob.
- **The feature is opportunistic and forward-looking.** Users whose IndexedDB held a non-extractable key from before this feature shipped are not migrated — their existing key can't be exported. They get recovery on the next fresh-storage login (and any history encrypted before that login is permanently lost).
- **Strength floor is the password.** A weak password makes an offline brute-force against the wrapped blob feasible for anyone who can read Redis. PBKDF2 600k iters raises the cost but doesn't eliminate it.

---

## Project layout

```
backend/                Go service
  cmd/server/main.go    HTTP routes + bootstrap
  internal/auth         JWT + bcrypt
  internal/redis        all Redis data access
  internal/chat/hub.go  WebSocket hub + per-connection goroutines
  internal/push         Web Push sender (no-op when VAPID env vars are unset)
  internal/admin        admin CRUD handlers

frontend/               React + TypeScript PWA
  src/crypto            Web Crypto API wrappers (single source of crypto truth)
  src/store             Zustand stores (auth, chat, unread tracking)
  src/hooks             useAuth, useCrypto, useWebSocket
  src/pages             LoginPage, ChatPage, AdminPage
  src/components        Sidebar, ChatArea, modals, UserAvatar
  src/sw.ts             custom service worker (push + notificationclick)
```

`CLAUDE.md` has the deeper contributor-facing details — Redis key schema, HTTP routes, auth model, and known gotchas.

---

## Admin

The first user is `admin`, created on first run with a random password printed to backend stdout. From the Admin page you can:

- Create / delete users, reset passwords, set per-user icon + color.
- Configure `history_ttl_days` (global message retention).
- Override room ownership (delete a room, force-remove a member).

Room rename and delete are normally restricted to the room's creator; admin override is a separate path.

### Lost the admin password?

The password is only printed on the **very first** backend boot, when no `user:admin` exists in Redis. On any subsequent `docker-compose up` it stays silent — the `redis_data` volume persists the admin account across restarts.

Check whether the admin already exists:

```bash
docker compose exec redis redis-cli EXISTS user:admin   # 1 = already created
```

If it does and you've lost the password, delete the admin user and restart the backend — bootstrap will recreate it and print a fresh password:

```bash
docker compose exec redis redis-cli DEL user:admin
docker compose exec redis redis-cli SREM users admin
docker compose restart backend
docker compose logs backend | grep "Password:"
```

---

## License

[MIT](LICENSE) © 2026 sonlm
