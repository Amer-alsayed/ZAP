# 🔒 Chatra - Anonymous Secure E2EE Messaging & WebRTC Platform

Chatra is a production-grade, zero-knowledge **End-to-End Encrypted (E2EE)** real-time messaging, voice/video calling, and media-sharing platform. Built with native Web Crypto API, WebSockets, WebRTC P2P streams, and dual-engine database support (SQLite / PostgreSQL).

Designed to run **100% free** on Render + Neon PostgreSQL.

---

## 🌟 Key Features

* **Zero-Knowledge E2EE**: Message payloads, voice notes, and media files are encrypted in the browser before transmission.
  - **Key Agreement**: ECDH (`P-256`) Diffie-Hellman.
  - **Payload Encryption**: AES-GCM (256-bit) with unique initialization vectors (IVs).
  - **Digital Signatures**: ECDSA (`P-256` with SHA-256) signature verification.
* **OWASP-Grade Password Protection**: Client-side **PBKDF2-SHA256 (600,000 iterations)** key derivation + server-side **Bcrypt (10 rounds)** password hashing.
* **Real-Time Voice & Video Calls**: Direct **WebRTC Peer-to-Peer (P2P)** media streams using Opus/VP8 codecs with multi-region free STUN servers.
* **Dual Database Adapter**: High-concurrency **SQLite (WAL mode)** locally, auto-switching to serverless **PostgreSQL (Neon)** in production.
* **Hardened Security**:
  - JWT Signature Lock (`HS256`).
  - Path traversal boundary checks (`path.resolve`).
  - Static file sandbox (`X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`).
  - Tiered rate limiters (Auth, API, Uploads) and WebSocket packet throttling (60 packets/sec).
  - Sliding-window message anti-spam (max 5 messages / 2 sec).
  - Automated 24-hour media file purge.

---

## 🚀 Quick Start (Local Development)

### 1. Installation
Clone the repository and install all dependencies:
```bash
git clone https://github.com/Amer-alsayed/Chatra.git
cd Chatra
npm run install:all
```

### 2. Run Development Server
Start backend server and React Vite frontend concurrently:
```bash
npm run dev
```

The application will launch at `http://localhost:5173`.

---

## 🛠️ Environment Variables

Set the following environment variables in production (e.g., Render Dashboard):

| Variable | Description | Example |
| :--- | :--- | :--- |
| `NODE_ENV` | Mode setting | `production` |
| `JWT_SECRET` | Secret key for signing JWTs | `your-super-secure-jwt-secret` |
| `DATABASE_URL` | Cloud PostgreSQL URL | `postgres://user:pass@ep-xxx.neon.tech/neondb` |
| `CLIENT_ORIGIN` | Allowed CORS origin | `https://chatra.onrender.com` |

---

## 📜 License

Distributed under the **MIT License**.
