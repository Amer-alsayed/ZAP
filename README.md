# ZAP

An anonymous, end-to-end encrypted (E2EE) real-time messaging and WebRTC voice/video application. Built with Node.js, Express, Socket.IO, and React (Vite).

---

## Architecture & Security Model

ZAP uses a **zero-knowledge server model**. The server routes encrypted payloads and manages peer signaling, but holds no private keys, passwords, or plaintext message data.

### 1. End-to-End Encryption (E2EE)
* **Key Agreement**: Diffie-Hellman key exchange over ECDH (`P-256`) curve via the browser's native Web Crypto API (`window.crypto.subtle`).
* **Symmetric Encryption**: Messages, voice notes, and media payloads are encrypted client-side using `AES-GCM` (256-bit) with unique 12-byte initialization vectors (IVs).
* **Message Signing**: Every encrypted payload is signed using `ECDSA` (`P-256` with SHA-256) to ensure message integrity and sender authenticity.

### 2. Authentication & Key Stretching
* **Client-Side Key Derivation**: Passwords are key-stretched locally using `PBKDF2-SHA256` with **600,000 iterations** to generate a master encryption key and login hash.
* **Server Hashing**: The incoming login hash is salted and hashed with `Bcrypt` (10 rounds) before database storage.
* **JWT Validation**: JsonWebTokens enforce strict algorithm verification (`HS256`).

### 3. Server Defense & Protection
* **SQL Injection Prevention**: 100% of queries use parameterized bindings for both SQLite and PostgreSQL.
* **Path Traversal Isolation**: File upload routes use `path.resolve` boundary verification against the storage directory.
* **Static Asset Sandboxing**: Uploaded media is served with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`.
* **Rate Limiting**:
  - Auth routes: 10 attempts / 15 min per IP.
  - Upload routes: 20 files / hour per IP.
  - WebSocket packets: 60 packets / second per socket.
  - Real-time messages: Sliding window rate limit (max 5 messages / 2 sec).
* **Automated Cleanup**: An hourly background task purges media uploads older than 24 hours to prevent storage growth.

### 4. Database Flexibility
* **SQLite (Development)**: Configured with Write-Ahead Logging (`PRAGMA journal_mode = WAL;`) and busy timeouts for concurrent I/O.
* **PostgreSQL (Production)**: Auto-detects `DATABASE_URL` (e.g. Neon PostgreSQL) and converts positional parameters dynamically.

---

## Project Structure

```text
Chatra/
├── client/                 # React (Vite) Frontend
│   ├── src/
│   │   ├── components/     # UI Components (ChatArea, Sidebar, CallWindow, etc.)
│   │   ├── services/       # Crypto, Socket.IO, and Fetch API modules
│   │   └── App.jsx         # Core state controller
│   └── vite.config.js
├── server/                 # Node.js Express & Socket.IO Backend
│   ├── src/
│   │   ├── middleware/     # Rate limiters and JWT auth middleware
│   │   ├── authController.js
│   │   ├── socketHandler.js # WebSockets & WebRTC signaling
│   │   ├── db.js          # SQLite & PostgreSQL abstraction layer
│   │   ├── config.js       # Environment configuration
│   │   └── logger.js       # Logging utility
│   └── server.js           # Server entry point
├── package.json            # Root script runner
├── LICENSE                 # MIT License
└── README.md
```

---

## Getting Started

### Prerequisites
* Node.js v18.0.0 or higher
* npm v9.0.0 or higher

### Local Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Amer-alsayed/Chatra.git
   cd Chatra
   ```

2. Install dependencies for both server and client:
   ```bash
   npm run install:all
   ```

3. Run the development server (starts Express server on port 5000 and Vite dev client on port 5173):
   ```bash
   npm run dev
   ```

---

## Environment Variables

Configure the following variables in production (e.g. Render Dashboard):

| Variable | Description | Example |
| :--- | :--- | :--- |
| `NODE_ENV` | Environment mode (`development` or `production`) | `production` |
| `PORT` | Server HTTP port | `5000` |
| `JWT_SECRET` | Secret key for signing authentication tokens | `your-secure-random-jwt-secret` |
| `DATABASE_URL` | PostgreSQL connection URL (enables Postgres mode) | `postgres://user:pass@ep-host.region.aws.neon.tech/neondb` |
---

## Mobile Features
- **Bi-Directional Swipe-to-Reply**: Low-latency non-passive gesture tracking with logarithmic spring physics, micro-haptics, and instant keyboard focus.
- **Dynamic Viewport Fit**: Native keyboard handling without layout shifting or broken zooms.

---

## License

This project is licensed under the [MIT License](LICENSE).
