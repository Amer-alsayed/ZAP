# ZAP

**Open-source, zero-knowledge, end-to-end encrypted real-time communications platform.**  
Featuring encrypted messaging, WebRTC P2P voice/video calling, voice notes, and media sharing.

[![CI](https://github.com/Amer-alsayed/ZAP/actions/workflows/ci.yml/badge.svg?style=flat-square)](https://github.com/Amer-alsayed/ZAP/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg?style=flat-square)](LICENSE)
[![Free Tier: $0/mo](https://img.shields.io/badge/Hosting-100%25_Free_Tier-success.svg?style=flat-square)](#-deployment)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933.svg?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19.x-61DAFB.svg?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![Web Crypto API](https://img.shields.io/badge/Cryptography-Web_Crypto_API-8A2BE2.svg?style=flat-square)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
[![WebRTC](https://img.shields.io/badge/Voice_&_Video-WebRTC_P2P-333333.svg?style=flat-square&logo=webrtc&logoColor=white)](https://webrtc.org)
[![PostgreSQL / SQLite](https://img.shields.io/badge/Database-PostgreSQL_%7C_SQLite-4169E1.svg?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org)

<br />

<div align="center">
  <img src="docs/zap-showcase.gif" alt="ZAP Real-Time Product Tour" width="100%" style="border-radius: 12px;" />
  <br />
  <sub><b>Interactive Showcase: Zero-Knowledge E2EE Messaging, Animated GIF Sharing, Elastic Sidebar Transitions, Dynamic RGB Theming, & Safety Verification</b></sub>
</div>

<br />

<div align="center">
  <table>
    <tr>
      <td width="50%" align="center">
        <img src="docs/screenshots/02-chat-interface.png" alt="ZAP Encrypted Chat Interface" />
        <br />
        <sub><b>OLED Glassmorphic Chat Interface</b></sub>
      </td>
      <td width="50%" align="center">
        <img src="docs/screenshots/03-safety-number.png" alt="E2EE Safety Number Verification" />
        <br />
        <sub><b>E2EE Safety Number Verification (MITM Protection)</b></sub>
      </td>
    </tr>
    <tr>
      <td width="50%" align="center">
        <img src="docs/screenshots/04-settings-themes.png" alt="Settings & Theming Engine" />
        <br />
        <sub><b>Custom RGB Accent Theming & Audio Quality</b></sub>
      </td>
      <td width="50%" align="center">
        <img src="docs/screenshots/05-call-hud.png" alt="WebRTC P2P Calling" />
        <br />
        <sub><b>WebRTC Direct P2P Calling ($0 Server Cost)</b></sub>
      </td>
    </tr>
  </table>
</div>

---

## Why ZAP?

ZAP was designed from the ground up to solve two major problems in modern communication software: **data surveillance** and **expensive server infrastructure**.

Most messaging platforms require personal identifiers (phone numbers, emails), log metadata on centralized servers, or require expensive cloud servers to relay media streams.

ZAP provides a complete, hardened communications suite that is **100% free to host forever**—with **zero compromises on cryptographic security**:

- **Zero Surveillance**: No phone numbers, no email addresses, no third-party trackers, and no telemetry. Registration requires only a username and password.
- **True Zero-Knowledge Server**: The backend acts as a blind routing gateway. It holds no private keys, cannot decrypt message payloads, cannot view media files, and cannot see user passwords.
- **Cost-Free P2P Voice & Video**: Calls stream directly between peers over WebRTC. Because audio and video do not route through centralized media relays, high-quality calls cost **$0 in server bandwidth**.
- **100% Free Cloud Deployment ($0/month)**: Can be deployed in minutes on free cloud tiers (Render + Neon + Keep-Alive) with permanent database storage and zero cold-starts, or self-hosted on any private VPS/Docker instance.

---

## Core Capabilities

### 1. End-to-End Encrypted Messaging
- Real-time message exchange over persistent WebSockets with sub-10ms delivery.
- Authenticated **AES-256-GCM** symmetric encryption with unique 12-byte initialization vectors per message.
- **Additional Authenticated Data (AAD) Context Binding**: Binds `{ sender, recipient, clientMsgId, timestamp }` directly into the AEAD cipher, mathematically preventing message re-routing, context swapping, and replay injection.
- **Deniable Authentication (HMAC-SHA256)**: Symmetric message authentication derived from the session secret provides cryptographic proof of origin to the recipient while preserving plausible deniability (non-repudiation protection).
- Message status lifecycle tracking: Sent (`✓`), Delivered (`✓✓`), and Read (`✓✓` blue).
- In-place message editing and dual deletion modes (*Delete for me* or *Delete for everyone*).
- Offline message queuing and automatic synchronization upon reconnection.

### 2. P2P Voice & Video Calling
- Direct browser-to-browser WebRTC media streams with STUN/TURN fallback.
- In-call HUD with camera toggles, microphone mute, live audio visualizer, and session duration counter.
- Stateful offer/answer signaling and automated session cleanup on network disconnection.

### 3. Encrypted Voice Notes & Media Vault
- In-browser voice note recorder with dynamic waveform generation and client-side encryption before transmission.
- Encrypted file and image sharing (up to 50MB) with chunked client-side AES-GCM encryption.
- Encrypted media caching (IndexedDB) for fast local decryption and playback without repeated server fetching.
- Sandboxed server-side asset isolation (`X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`).
- Automated background worker that purges expired media uploads to prevent server disk bloat.

### 4. Privacy & Identity Verification
- **Out-of-Band Safety Numbers**: 20-digit deterministic cryptographic fingerprints (`XXXXX XXXXX XXXXX XXXXX`) allow peers to visually verify identity keys and prevent Man-in-the-Middle (MITM) attacks.
- **Client-Side Key Stretching (NIST SP 800-132)**: Passwords are key-stretched in the browser using **PBKDF2-SHA256 with 600,000 rounds** and **dynamic 16-byte CSPRNG per-user salts** before transmission. Raw passwords never touch the wire or database.
- **Anti-Enumeration Oracle Protection**: Constant-time deterministic HMAC pseudo-salts prevent username harvesting attacks.
- **Full Presence & Blocklist Isolation**: Blocked users are completely isolated—they cannot observe typing status, presence, or deliver messages.

---

## Cryptographic Protocol Specification

```
                                KEY DERIVATION & ENCRYPTION PIPELINE
                                
   +-----------------------------------------------------------------------------------------+
   | Client-Side Master Key Derivation (NIST SP 800-132)                                     |
   |                                                                                         |
   |  Password + 16-byte CSPRNG Salt (Stored in DB users.auth_salt)                          |
   |      |                                                                                  |
   |      v [ PBKDF2-HMAC-SHA256 (600,000 rounds) ]                                          |
   |      |                                                                                  |
   |      +---> 256-bit Login Hash  ---------> Sent to Server (Stored as Bcrypt Hash)        |
   |      |                                                                                  |
   |      +---> 256-bit Master Key (AES-GCM) -> Encrypts exported private key backup bundle  |
   +-----------------------------------------------------------------------------------------+
                                              |
   +------------------------------------------v----------------------------------------------+
   | Key Agreement & Dual-Subkey Derivation                                                  |
   |                                                                                         |
   |  * Identity Key Pair: ECDH over Curve P-256 (secp256r1)                                 |
   |  * Signing Key Pair:  ECDSA over Curve P-256 (SHA-256)                                  |
   |                                                                                         |
   |  Shared Secret = ECDH(Sender_PrivKey, Recipient_PubKey)                                 |
   |      |                                                                                  |
   |      +---> AES-GCM-256 Encryption Key                                                   |
   |      +---> HMAC-SHA256 Deniable Authentication Key                                      |
   +-----------------------------------------------------------------------------------------+
                                              |
   +------------------------------------------v----------------------------------------------+
   | Message Transmission & AEAD Context Binding                                             |
   |                                                                                         |
   |  Sender:                                                                                |
   |    1. Builds AAD Context: { s: sender, r: recipient, mid: clientMsgId, t: timestamp }   |
   |    2. Generates 96-bit (12-byte) CSPRNG random IV                                       |
   |    3. Ciphertext = AES-GCM-256(SharedKey, IV, Plaintext, additionalData=AAD)            |
   |    4. AuthTag    = HMAC-SHA256(AuthKey, Ciphertext || IV || AAD)                        |
   |    5. Sends envelope: { recipient, ciphertext, iv, aad, authTag, signature }            |
   |                                                                                         |
   |  Recipient:                                                                             |
   |    1. Verifies Deniable HMAC AuthTag using shared symmetric AuthKey                     |
   |    2. Plaintext = AES-GCM-256-Decrypt(SharedKey, IV, Ciphertext, additionalData=AAD)    |
   |    * Tampered metadata, altered sender/recipient, or modified payload fails decryption  |
   +-----------------------------------------------------------------------------------------+
```

### Primitives Summary

| Primitive | Standard / Parameters | Purpose |
| :--- | :--- | :--- |
| **Password Salt** | 16-byte CSPRNG Salt (`crypto.getRandomValues`) | Per-user entropy against precomputed rainbow table attacks |
| **Anti-Enumeration** | Deterministic `HMAC-SHA256(Secret, user)` | Prevents username harvesting or enumeration on salt query |
| **Key Derivation** | `PBKDF2-HMAC-SHA256` (600,000 iterations, 512-bit output) | Locally stretches raw password into login token & backup key |
| **Key Agreement** | `ECDH` on NIST Curve `P-256` (`secp256r1`) | Derives 256-bit symmetric shared secret between peers |
| **Symmetric Encryption** | `AES-GCM` (256-bit key, 96-bit random IV, 128-bit tag) | Authenticated encryption for messages, voice notes, and media |
| **Context Binding (AAD)** | Structured JSON byte buffer in `additionalData` | Cryptographically binds sender, recipient, and message ID |
| **Deniable Authentication** | `HMAC-SHA256` over `ciphertext:iv:aad` | Guarantees message authenticity while preserving plausible deniability |
| **Identity Fingerprints** | Deterministic 20-digit chunked numeric code | Out-of-band MITM key verification |
| **Server Auth** | `Bcrypt` (10 rounds) + `JWT` (`HS256`) | Server-side token validation and session management |

---

## Threat Model & Security Matrix

| Threat Vector | Attack Scenario | ZAP Mitigation |
| :--- | :--- | :--- |
| **Server Compromise** | Rogue admin or compromised hosting database | Database contains only AES-256-GCM ciphertexts, public keys, and bcrypt hashes. Plaintext cannot be recovered without client private keys. |
| **Precomputation Attacks** | Rainbow table attacks across known usernames | Dynamic 16-byte CSPRNG per-user salts force attacks to be calculated individually at $2^{256}$ cost. |
| **Replay & Injection Attacks** | Intercepting ciphertexts and re-sending or re-routing to different chats | AES-GCM Additional Authenticated Data (AAD) cryptographically locks sender, recipient, and message ID into the auth tag. |
| **Non-Repudiation Leak** | Exporting chat transcripts as legal receipts | Symmetric HMAC-SHA256 authentication provides deniability (both parties hold key material). |
| **Public Key Substitution** | Server returning modified public keys | Users can verify identities out-of-band using the 20-digit deterministic Safety Number fingerprint. |
| **Attachment Interception** | Intercepting uploaded images or voice notes | Media files are encrypted in the browser with AES-GCM prior to upload and served with sandboxed CSP isolation. |
| **DoS & Flooding** | Brute-force guessing and upload flooding | Multi-tiered rate limiters isolate authentication (30 req/15m), uploads (300 req/15m), and general API traffic. |

---

## Automated Verification & Testing

ZAP includes a standalone cryptographic verification test suite that executes all key derivation, AAD anti-tampering, deniable authentication, and backward compatibility tests locally using the native Web Crypto API:

```bash
# Run the automated cryptographic test suite
npm run test:crypto
```

Output:
```text
1. Testing Random Salt Generation & PBKDF2 Isolation...
✓ PASS: Random salts isolate hashes; legacy accounts remain backward-compatible.

2. Testing ECDH Key Exchange...
✓ PASS: ECDH P-256 shared secret derivation validated.

3. Testing AES-GCM AAD Context Binding & Anti-Tampering...
✓ PASS: AAD context binding mathematically prevents context tampering and re-routing attacks.

4. Testing Deniable Authentication with HMAC-SHA256...
✓ PASS: Deniable HMAC authentication verified with anti-tampering protection.

5. Testing Legacy Message Fallback (Messages without AAD)...
✓ PASS: Legacy messages without AAD decrypt smoothly with zero breaking changes.
```

---

## System Architecture

```mermaid
flowchart LR
    subgraph Client["Browser Client (React 19)"]
        CryptoEngine["Native Web Crypto API<br/>(Hardware Accelerated)"]
        MediaCache["IndexedDB Media Cache"]
        SocketClient["Socket.IO Client"]
        WebRTC["WebRTC P2P Peer"]
    end

    subgraph Server["Node.js Gateway"]
        AuthMiddleware["JWT Auth & Rate Limiting"]
        SocketRelay["Socket.IO Relay & WebRTC Signaling"]
        UploadVault["Sandboxed Media Storage"]
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
    Client -->|Encrypted Binary Blobs| UploadVault
    SocketRelay <--> DB
    UploadVault --> CleanupTask
    WebRTC <===>|Direct P2P Encrypted Audio / Video| PeerP2P
    SocketClient <-->|Real-time Routing| SocketRelay
```

---

## 🚀 Deployment

You can run ZAP **100% free of charge** using cloud free tiers, or self-host it on your own private server / VPS.

---

### Option A: Free 24/7 Cloud Stack ($0/Month Forever)

This setup uses **Neon** (free serverless PostgreSQL), **Render** (free web service hosting), and **cron-job.org** (free keep-alive pings) to run a persistent, zero-cost production instance.

```
[ Neon.tech (PostgreSQL) ] <---> [ Render.com (Web Service) ] <--- [ cron-job.org (Keep-Alive Ping) ]
       (Persistence)                 (Node + WebSockets)                    (No Cold Starts)
```

#### 1. Create Free Database on Neon
1. Go to **[Neon.tech](https://neon.tech)** and create a free project.
2. Select your closest region (e.g. `Europe (Frankfurt) / eu-central-1`).
3. Copy your PostgreSQL connection URI from the dashboard:
   ```text
   postgresql://user:password@ep-xyz.region.aws.neon.tech/neondb?sslmode=require
   ```

#### 2. Deploy Web Service to Render
1. Fork or push this repository to your GitHub account.
2. In the **[Render Dashboard](https://dashboard.render.com)**, click **New +** $\rightarrow$ **Blueprint** (or **Web Service**).
3. Select your repository (**`ZAP`**).
4. Render will detect the included [`render.yaml`](render.yaml) automatically.
5. In the **Environment Variables** section, ensure the following are configured:
   - `NODE_ENV`: `production`
   - `JWT_SECRET`: *(A secure 32+ character random string)*
   - `DATABASE_URL`: *(Paste your Neon PostgreSQL connection string)*
6. Click **Apply / Deploy**. Render will automatically build the client bundle, connect to Neon, and run database migrations.

#### 3. Prevent Cold Starts with cron-job.org
Render free-tier web services sleep after 15 minutes of inactivity. To keep your server warm and eliminate wake-up delays:
1. Create a free account on **[cron-job.org](https://cron-job.org)**.
2. Click **Create Cronjob**:
   - **Title**: `Keep ZAP Awake`
   - **URL**: `https://<your-render-service>.onrender.com/health`
   - **Schedule**: `Every 10 minutes` (or `Every 5 minutes`)
   - **Request Method**: `GET`
3. Click **Create**. `cron-job.org` will periodically ping the lightweight `/health` probe, ensuring your app responds instantly 24/7.

---

### Option B: Self-Hosted on Private VPS (Docker & Nginx)

#### Docker Deployment

```dockerfile
FROM node:20-alpine
WORKDIR /app

# Copy dependency manifests
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/

# Install dependencies
RUN npm run install:all

# Build static React frontend
COPY . .
RUN npm run build

EXPOSE 5000
ENV NODE_ENV=production
CMD ["npm", "start"]
```

Build and run:
```bash
docker build -t zap .
docker run -d -p 5000:5000 \
  -e JWT_SECRET="your-secure-random-secret-key" \
  -e NODE_ENV=production \
  --name zap-app zap
```

#### Nginx Reverse Proxy Configuration

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

### Option C: Local Development

```bash
# Clone the repository
git clone https://github.com/Amer-alsayed/ZAP.git
cd ZAP

# Install dependencies for both server and client
npm run install:all

# Start backend (port 5000) and frontend (port 5173) concurrently
npm run dev
```

---

## Configuration Reference

| Variable | Type | Default | Description |
| :--- | :---: | :---: | :--- |
| `NODE_ENV` | `string` | `development` | Runtime environment (`development` or `production`). |
| `PORT` | `number` | `5000` | HTTP and WebSocket listener port. |
| `JWT_SECRET` | `string` | — | **Required in production.** Secret key used for signing JWT session tokens. |
| `JWT_EXPIRES_IN` | `string` | `7d` | Session expiration duration (e.g. `24h`, `7d`). |
| `DATABASE_URL` | `string` | `null` | PostgreSQL connection URI (e.g. Neon, Supabase). Enables PostgreSQL mode with connection pooling. Defaults to SQLite when omitted. |
| `DATABASE_PATH` | `string` | `../../zap.db` | SQLite database file location when running locally. |
| `CLIENT_ORIGIN` | `string` | `null` | Allowed CORS origins for standalone client deployments (comma-separated). |
| `MEDIA_TTL_HOURS` | `number` | `168` | Lifetime of encrypted media files on disk before automated background purge (default: 7 days). |

---

## API & Signaling Reference

### REST Endpoints

| Method | Route | Auth | Rate Limit | Purpose |
| :--- | :--- | :---: | :---: | :--- |
| `GET` | `/health` | None | General (500/15m) | Liveness probe and database connectivity verification. |
| `POST` | `/api/auth/register` | None | Auth (30/15m) | Registers user with public keys and encrypted key bundle. |
| `POST` | `/api/auth/login` | None | Auth (30/15m) | Authenticates login hash, returns JWT and user key bundle. |
| `GET` | `/api/auth/search` | JWT | General (500/15m) | Queries users by username prefix. |
| `POST` | `/api/upload` | JWT | Upload (300/15m) | Uploads client-encrypted binary payload (max 50MB). |
| `GET` | `/uploads/:filename` | None | General | Serves encrypted binary blobs with sandboxed headers. |

### Socket.IO Protocol Events

| Channel | Event | Payload Direction | Description |
| :--- | :--- | :---: | :--- |
| **Auth** | `connection` | Client $\rightarrow$ Server | Authenticates connection via handshake JWT token. |
| **Messaging** | `send-message` | Client $\rightarrow$ Server | Dispatches `{ recipient, ciphertext, iv, signature }`. |
| | `receive-message` | Server $\rightarrow$ Client | Delivers ciphertext envelope to recipient socket. |
| | `message-delivered` | Server $\rightarrow$ Client | Confirms message delivery receipt (`✓✓`). |
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

## Security & Vulnerability Reporting

If you discover a security vulnerability within ZAP, please do **not** open a public issue. Open a private GitHub Security Advisory or contact the maintainers directly.

---

## License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for details.
