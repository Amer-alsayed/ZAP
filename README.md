# ZAP

**Zero-knowledge, end-to-end encrypted real-time communications platform.**  
Built on the native Web Crypto API, WebRTC, Node.js, and React 19.

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933.svg?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19.x-61DAFB.svg?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![Web Crypto API](https://img.shields.io/badge/Cryptography-Web_Crypto_API-8A2BE2.svg?style=flat-square)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
[![WebRTC](https://img.shields.io/badge/Signaling-WebRTC_P2P-333333.svg?style=flat-square&logo=webrtc&logoColor=white)](https://webrtc.org)
[![PostgreSQL / SQLite](https://img.shields.io/badge/Database-PostgreSQL_%7C_SQLite-4169E1.svg?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org)

---

## Design Philosophy

Most "secure" web messengers either rely on closed-source third-party servers, bloated non-standard JavaScript cryptography bundles, or store private keys insecurely. 

ZAP was built around three fundamental architectural decisions:

1. **Zero-Knowledge by Design**: The backend is an untrusted relay. It never receives plaintext messages, unencrypted attachments, or raw user passwords. It has no mechanism to decrypt stored or in-transit payloads.
2. **Native Standard Cryptography**: All cryptographic primitives run directly inside the browser's hardware-accelerated `window.crypto.subtle` (Web Crypto API) engine—eliminating unvetted third-party crypto dependencies and side-channel vulnerabilities.
3. **Self-Contained & Deployable Anywhere**: Dual-engine storage (zero-configuration SQLite WAL for local development; managed PostgreSQL with pooling for production) allows deployment on a single VPS, Docker container, or cloud PaaS in minutes.

---

## Threat Model & Security Guarantees

| Attack Surface | Threat Vector | Mitigation Strategy |
| :--- | :--- | :--- |
| **Compromised Server / Rogue Admin** | Reading message history or eavesdropping calls | The server stores only AES-256-GCM ciphertexts, public keys, and bcrypt hashes of client-derived tokens. It has no access to private keys. |
| **Credential Interception / Sniffing** | Capturing raw passwords in transit | Passwords are key-stretched client-side via **PBKDF2-SHA256 (600,000 iterations)**. Only a cryptographic derivation hash is transmitted, which is subsequently hashed with Bcrypt (10 rounds) before storage. |
| **Man-in-the-Middle (MITM)** | Tampering with in-transit messages | Every payload is signed with the sender's **ECDSA P-256** private key. The recipient validates the signature against the sender's public key before decrypting. |
| **Identity Impersonation** | Modifying public keys on the server | Out-of-band **Safety Numbers** (deterministic 20-digit cryptographic fingerprints) allow peers to verify public key consistency. |
| **File Storage Exposure** | Leaking uploaded attachments | Media files and voice notes are encrypted locally with AES-256-GCM prior to upload. Uploaded files are served with sandboxed CSP headers and automatically purged by an hourly TTL background worker. |
| **Brute-Force & Denial of Service** | Flooding auth, uploads, or sockets | Multi-tier rate limiting (Express Rate Limit) isolates authentication attempts (30/15m), uploads (300/15m), and general API traffic. |

---

## Cryptographic Protocol Specification

```
                                KEY DERIVATION & ENCRYPTION PIPELINE
                                
   +-----------------------------------------------------------------------------------------+
   | Client-Side Master Key Derivation                                                       |
   |                                                                                         |
   |  Password + Salt("zap-salt-{username}")                                                 |
   |      |                                                                                  |
   |      v [ PBKDF2-HMAC-SHA256 (600,000 rounds) ]                                          |
   |      |                                                                                  |
   |      +---> 256-bit Login Hash  ---------> Sent to Server (Stored as Bcrypt Hash)        |
   |      |                                                                                  |
   |      +---> 256-bit Master Key (AES-GCM) -> Encrypts exported private key backup bundle  |
   +-----------------------------------------------------------------------------------------+
                                              |
   +------------------------------------------v----------------------------------------------+
   | Key Pair Generation (Web Crypto API)                                                    |
   |                                                                                         |
   |  * Identity Key Pair: ECDH over Curve P-256 (secp256r1)                                 |
   |  * Signing Key Pair:  ECDSA over Curve P-256 (SHA-256)                                  |
   |                                                                                         |
   |  Private keys are encrypted with the Master Key and backed up to the server.            |
   |  Public keys (JWK format) are published to the public registry.                         |
   +-----------------------------------------------------------------------------------------+
                                              |
   +------------------------------------------v----------------------------------------------+
   | Message Transmission & Verification                                                     |
   |                                                                                         |
   |  Sender:                                                                                |
   |    1. Derives shared secret: ECDH(Sender_PrivKey, Recipient_PubKey)                     |
   |    2. Generates 96-bit (12-byte) CSPRNG random IV                                       |
   |    3. Ciphertext = AES-GCM-256(SharedKey, IV, Plaintext)                                |
   |    4. Signature  = ECDSA-SHA256(Sender_SigningPrivKey, Ciphertext)                      |
   |    5. Sends envelope: { recipient, ciphertext, iv, signature }                          |
   |                                                                                         |
   |  Recipient:                                                                             |
   |    1. Verifies Signature using Sender's Public ECDSA Key                                 |
   |    2. Derives matching shared secret: ECDH(Recipient_PrivKey, Sender_PubKey)            |
   |    3. Plaintext = AES-GCM-256-Decrypt(SharedKey, IV, Ciphertext)                        |
   +-----------------------------------------------------------------------------------------+
```

### Primitives Summary

- **Key Derivation Function**: PBKDF2-HMAC-SHA256 with 600,000 iterations and 512-bit output.
- **Key Agreement**: Diffie-Hellman over Elliptic Curves (ECDH) on NIST Curve P-256 (`secp256r1`).
- **Symmetric Cipher**: AES-GCM (256-bit key length, 96-bit random IV, 128-bit authentication tag).
- **Asymmetric Signatures**: ECDSA with SHA-256 over NIST Curve P-256.
- **Safety Number / Fingerprint**: Deterministic hash of sorted public key identity pairs, formatted into 4 blocks of 5 digits: `XXXXX XXXXX XXXXX XXXXX`.

---

## System Architecture

```mermaid
flowchart LR
    subgraph Client["Browser Client (React 19)"]
        CryptoEngine["Web Crypto API<br/>(SubtleCrypto)"]
        MediaCache["IndexedDB Media Cache"]
        SocketClient["Socket.IO Client"]
        WebRTC["WebRTC P2P Peer"]
    end

    subgraph Server["Node.js Application Gateway"]
        AuthMiddleware["JWT & Rate Limiting"]
        SocketRelay["Socket.IO Event Relay & Signaling"]
        UploadHandler["Sandboxed Static Vault"]
        CleanupTask["Background Media TTL Purge"]
    end

    subgraph Storage["Database Layer"]
        DB[("PostgreSQL (Production)<br/>or SQLite WAL (Development)")]
    end

    subgraph PeerClient["Recipient Browser"]
        PeerWebCrypto["Web Crypto API"]
        PeerP2P["WebRTC P2P Peer"]
    end

    Client <-->|Encrypted Payloads & Signaling| SocketRelay
    Client -->|Encrypted Binary Uploads| UploadHandler
    SocketRelay <--> DB
    UploadHandler --> CleanupTask
    WebRTC <===>|Direct P2P Encrypted Audio / Video| PeerP2P
    SocketClient <-->|Real-time Routing| SocketRelay
```

---

## Features

- **End-to-End Encrypted Text Messaging**: Sub-10ms delivery over persistent WebSockets with offline message synchronization.
- **WebRTC P2P Voice & Video Calls**: Direct peer-to-peer media streams with ICE/STUN fallback, live audio waveform visualizer, camera flipping, and call timer.
- **Voice Notes Studio**: Live in-browser audio recording, interactive waveform visualization, and client-side encryption before storage.
- **Encrypted Media & Document Sharing**: Client-side AES-GCM file chunking and encryption (up to 50MB) with in-memory decryption and IndexedDB caching.
- **Message Lifecycle Controls**: Real-time message edits, dual deletion modes (*Delete for me* or *Delete for everyone*), and delivery/read receipts (`✓`, `✓✓`, blue `✓✓`).
- **Emoji Reactions & Apple Emoji Tray**: Instant reaction syncing with integrated emoji picker.
- **Bi-Directional Gesture Physics**: Native-feeling swipe-to-reply with logarithmic spring damping, micro-haptics, and auto-focusing input bar.
- **Adaptive Viewport Engine**: Dynamic viewport handling (`dvh` + `interactive-widget=resizes-visual`) preventing virtual keyboard layout shifting on iOS Safari and Android Chrome.
- **Privacy Controls**: Contact search, user blocking/unblocking with total presence isolation, safety number verification, and auto-purging media files.
- **Theming & Micro-Interactions**: Dark, Light, and True OLED Black palettes with custom RGB accent picking and synthesized audio cues.

---

## Project Structure

```text
zap/
├── client/                     # Frontend Application (React 19 + Vite)
│   ├── public/                 # Favicon and static SVGs
│   ├── src/
│   │   ├── components/         # UI Modules (ChatArea, Sidebar, CallWindow, etc.)
│   │   ├── services/           # Crypto engine, Socket.IO client, API wrappers
│   │   ├── styles/             # Application CSS and design tokens
│   │   ├── utils/              # Theme management and helper functions
│   │   ├── App.jsx             # Root state controller
│   │   └── main.jsx            # React entry point
│   ├── package.json
│   └── vite.config.js
│
├── server/                     # Backend Application (Node.js + Express)
│   ├── src/
│   │   ├── middleware/         # Rate limiting and JWT verification
│   │   ├── authController.js   # Auth endpoints and user query handlers
│   │   ├── socketHandler.js    # Socket.IO message routing and WebRTC signaling
│   │   ├── db.js               # Database abstraction (SQLite WAL & PostgreSQL)
│   │   ├── config.js           # Environment parser and validator
│   │   └── logger.js           # Structured logging utility
│   ├── package.json
│   └── server.js               # Server bootstrap and graceful shutdown
│
├── render.yaml                 # 1-Click Render Blueprint
├── package.json                # Root monorepo workspace scripts
└── LICENSE                     # MIT License
```

---

## Getting Started

### Prerequisites
- **Node.js**: `v18.0.0` or higher
- **npm**: `v9.0.0` or higher

### 1. Installation

```bash
# Clone the repository
git clone https://github.com/Amer-alsayed/Chatra.git zap
cd zap

# Install dependencies for both server and client
npm run install:all
```

### 2. Development Mode

Starts the backend API on port `5000` and Vite HMR frontend on port `5173`:

```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

### 3. Production Build & Run

```bash
# Build the client bundle
npm run build

# Start the Node.js production server
npm start
```

---

## Configuration

Server environment variables can be configured via a `.env` file in `server/` or through your hosting provider:

| Variable | Type | Default | Description |
| :--- | :---: | :---: | :--- |
| `NODE_ENV` | `string` | `development` | Runtime environment (`development` or `production`). |
| `PORT` | `number` | `5000` | HTTP and WebSocket listener port. |
| `JWT_SECRET` | `string` | — | **Required in production.** Secret key used for signing JWT session tokens. |
| `JWT_EXPIRES_IN` | `string` | `7d` | Session expiration timeframe (e.g., `24h`, `7d`). |
| `DATABASE_URL` | `string` | `null` | PostgreSQL connection URI (e.g. Neon, Supabase, AWS RDS). Defaults to SQLite when omitted. |
| `DATABASE_PATH` | `string` | `../../zap.db` | SQLite database file location when running locally. |
| `CLIENT_ORIGIN` | `string` | `null` | Allowed CORS origins for standalone client deployments (comma-separated). |
| `MEDIA_TTL_HOURS` | `number` | `168` | Lifetime of encrypted media files on disk before automated deletion (default: 7 days). |

---

## API & Signaling Protocol

### REST Endpoints

| Method | Route | Auth | Rate Limit | Purpose |
| :--- | :--- | :---: | :---: | :--- |
| `GET` | `/health` | None | General (500/15m) | Liveness probe and database connectivity status. |
| `POST` | `/api/auth/register` | None | Auth (30/15m) | Registers user, stores public keys and encrypted private key bundle. |
| `POST` | `/api/auth/login` | None | Auth (30/15m) | Authenticates login hash, returns JWT and user key bundle. |
| `GET` | `/api/auth/search` | JWT | General (500/15m) | Look up users by username prefix. |
| `POST` | `/api/upload` | JWT | Upload (300/15m) | Uploads client-encrypted binary payload (max 50MB). |
| `GET` | `/uploads/:filename` | None | General | Serves encrypted binary blobs with sandboxed headers. |

### Socket.IO Protocol Events

| Channel | Event | Payload Direction | Description |
| :--- | :--- | :---: | :--- |
| **Auth** | `connection` | Client $\rightarrow$ Server | Authenticates connection via handshake JWT token. |
| **Messaging** | `send-message` | Client $\rightarrow$ Server | Dispatches `{ recipient, ciphertext, iv, signature }`. |
| | `receive-message` | Server $\rightarrow$ Client | Delivers ciphertext envelope to recipient socket. |
| | `message-delivered` | Server $\rightarrow$ Client | Updates message delivery status (`✓✓`). |
| | `message-read` | Client $\leftrightarrow$ Server | Signals read receipts and updates blue tick status. |
| | `message-edit` | Client $\leftrightarrow$ Server | Propagates edited ciphertext to conversation participants. |
| | `delete-messages` | Client $\leftrightarrow$ Server | Synchronizes single or bidirectional message removal. |
| **Signaling** | `call-user` | Client $\leftrightarrow$ Server | Relays WebRTC SDP offer to recipient. |
| | `call-accepted` | Client $\leftrightarrow$ Server | Relays WebRTC SDP answer to caller. |
| | `ice-candidate` | Client $\leftrightarrow$ Server | Exchanges STUN/TURN network routing candidates. |
| | `end-call` | Client $\leftrightarrow$ Server | Terminates active call session and resets state. |
| **Presence** | `typing` / `stop-typing`| Client $\leftrightarrow$ Server | Broadcasts active typing indicators. |
| | `user-status` | Server $\rightarrow$ Client | Real-time online/offline presence notifications. |

---

## Deployment

### 1. One-Click Deploy to Render

This project includes a native [`render.yaml`](render.yaml) blueprint:

1. Fork this repository on GitHub.
2. In the [Render Dashboard](https://dashboard.render.com), click **New +** $\rightarrow$ **Blueprint**.
3. Connect your repository.
4. Supply your `JWT_SECRET` in the environment settings and deploy.

### 2. Docker Deployment

```dockerfile
FROM node:20-alpine
WORKDIR /app

# Copy dependency manifests
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/

# Install all workspace dependencies
RUN npm run install:all

# Copy source and build static frontend
COPY . .
RUN npm run build

EXPOSE 5000
ENV NODE_ENV=production
CMD ["npm", "start"]
```

Build and run:
```bash
docker build -t zap .
docker run -p 5000:5000 -e JWT_SECRET="your-secure-secret" -e NODE_ENV=production zap
```

### 3. VPS Deployment (Nginx + PM2)

```nginx
server {
    listen 80;
    server_name chat.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Contributing

1. Fork the project.
2. Create your feature branch (`git checkout -b feature/crypto-improvement`).
3. Commit your changes (`git commit -m 'feat: optimize key agreement caching'`).
4. Push to the branch (`git push origin feature/crypto-improvement`).
5. Open a Pull Request.

---

## Security & Vulnerability Reporting

If you discover a security vulnerability within ZAP, please do **not** open a public issue. Open a private GitHub Security Advisory or contact the maintainers directly.

---

## License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for details.
