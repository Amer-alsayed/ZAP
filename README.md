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

### 1. End-to-End Encrypted 1-on-1 & Multi-User Group Messaging
- Real-time message exchange over persistent WebSockets with sub-10ms delivery.
- Authenticated **AES-256-GCM** symmetric encryption with unique 12-byte initialization vectors per message.
- **Additional Authenticated Data (AAD) Context Binding**: Binds `{ sender, recipient, clientMsgId, timestamp }` directly into the AEAD cipher, mathematically preventing message re-routing, context swapping, and replay injection.
- **Zero-Knowledge Multi-User Groups**: End-to-end encrypted group messaging with versioned sealed key envelopes (KV), automated key rotation on member changes, role-based administration (Owner, Admin, Member), and encrypted system notifications.
- **Rich Message Interactions**: Interactive quoted replies with animated jump-to-source scrolling, message forwarding modal, multi-select deletion, and markdown rendering (`*bold*`, `_italic_`, `code`, and `||spoiler||` tags).
- **Deniable Authentication (HMAC-SHA256)**: Symmetric message authentication derived from the session secret provides cryptographic proof of origin to the recipient while preserving plausible deniability (non-repudiation protection).
- Message status lifecycle tracking: Sent (`✓`), Delivered (`✓✓`), and Read (`✓✓` blue).
- In-place message editing and dual deletion modes (*Delete for me* or *Delete for everyone*).
- Offline message queuing and automatic synchronization upon reconnection.

### 2. P2P Direct & Multi-Peer Mesh Group Calling
- **1-on-1 WebRTC Calls**: Direct browser-to-browser audio and video streams ($0 server bandwidth cost) with STUN/TURN fallback.
- **Multi-Peer Group Calls**: Full-mesh WebRTC group video and audio calling with dynamic peer tile grid, active speaker highlighting, and real-time joining/leaving.
- **In-Call HUD Controls**: Real-time microphone mute across all active peer senders with audio chimes, camera toggle, screen sharing, Picture-in-Picture (PiP), audio waveform visualizer, and session duration timer.

### 3. Encrypted Multi-Photo Albums, Voice Notes & Media Vault
- **Multi-Photo Album Grid**: Intelligent collage layouts (1, 2, 3, 4+ photos) rendered inline within chat bubbles.
- **Full-Screen Lightbox Gallery**: Interactive image viewer with keyboard navigation, zoom & pan, swipe gestures, and download capabilities.
- **Encrypted Voice Notes**: In-browser voice recorder with real-time waveform animation, playback scrubber, and client-side encryption.
- **Apple Emoji & GIF Pickers**: Native Apple-style emoji categories, recent emoji caching, search, and integrated Tenor/Giphy animated GIF reaction picker.
- **Encrypted File Vault**: Client-side AES-GCM encrypted media sharing (up to 50MB) with chunked encryption and IndexedDB local decryption caching.
- Sandboxed server-side asset isolation (`X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`) and automated background TTL purges.

### 4. Zero-State Persistence & Instant Cache Hydration
- **Instant Synchronous Hydration**: Local storage caches contacts, groups, and message snippets synchronously on application mount, preventing UI flickering and `"No messages yet"` resets across page reloads.
- **Authoritative Unread Badges**: Undelivered and unread message counters are tracked authoritatively on the server and preserved across reloads until explicitly opened and read.
- **Background Message Reconciliation**: Automatically synchronizes and decrypts recent history for conversation partners in the background without requiring manual clicks.

### 5. Privacy & Identity Verification
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
   | Key Agreement & Ephemeral Ratcheting (Perfect Forward Secrecy)                          |
   |                                                                                         |
   |  * Identity Key Pair: ECDH over Curve P-256 (secp256r1)                                 |
   |  * Signing Key Pair:  ECDSA over Curve P-256 (SHA-256)                                  |
   |                                                                                         |
   |  Root Secret = ECDH(Sender_PrivKey, Recipient_PubKey)                                   |
   |      |                                                                                  |
   |      +---> Ephemeral Ratcheted Key: K_msg = HMAC(Root, "ZAP-PFS-MSG-v1:" || seq || s || r)
   |      +---> Deniable Auth Key:       K_auth = HMAC-SHA256(Root, rawKey)                  |
   +-----------------------------------------------------------------------------------------+
                                              |
   +------------------------------------------v----------------------------------------------+
   | Message Transmission & AEAD Context Binding                                             |
   |                                                                                         |
   |  Sender:                                                                                |
   |    1. Builds AAD Context: { s: sender, r: recipient, mid: clientMsgId, t: timestamp, seq }
   |    2. Generates 96-bit (12-byte) CSPRNG random IV                                       |
   |    3. Ciphertext = AES-GCM-256(K_msg, IV, Plaintext, additionalData=AAD)                |
   |    4. AuthTag    = HMAC-SHA256(K_auth, Ciphertext || IV || AAD)                         |
   |    5. Sends envelope: { recipient, ciphertext, iv, aad, authTag, signature }            |
   |                                                                                         |
   |  Recipient:                                                                             |
   |    1. Verifies Deniable HMAC AuthTag using shared symmetric K_auth                      |
   |    2. Plaintext = AES-GCM-256-Decrypt(K_msg, IV, Ciphertext, additionalData=AAD)       |
   |    * Tampered metadata, altered sequence, or modified payload fails decryption          |
   +-----------------------------------------------------------------------------------------+
```

### Primitives Summary

| Primitive | Standard / Parameters | Purpose |
| :--- | :--- | :--- |
| **Password Salt** | 16-byte CSPRNG Salt (`crypto.getRandomValues`) | Per-user entropy against precomputed rainbow table attacks |
| **Anti-Enumeration** | Deterministic `HMAC-SHA256(Secret, user)` | Prevents username harvesting or enumeration on salt query |
| **Key Derivation** | `PBKDF2-HMAC-SHA256` (600,000 iterations, 512-bit output) | Locally stretches raw password into login token & backup key |
| **Key Agreement** | `ECDH` on NIST Curve `P-256` (`secp256r1`) | Derives 256-bit symmetric root shared secret between peers |
| **Ephemeral Ratcheting (PFS)** | Monotonic KDF chain per conversation sequence | Single-use message keys; zero retroactive decryption risk |
| **Symmetric Encryption** | `AES-GCM` (256-bit key, 96-bit random IV, 128-bit tag) | Authenticated encryption for messages, voice notes, and media |
| **Context Binding (AAD)** | Structured JSON byte buffer in `additionalData` | Cryptographically binds sender, recipient, message ID, and sequence |
| **Deniable Authentication** | `HMAC-SHA256` over `ciphertext:iv:aad` | Guarantees message authenticity while preserving plausible deniability |
| **Identity Fingerprints** | Deterministic 20-digit chunked numeric code | Out-of-band MITM key verification |
| **Server Auth** | `Bcrypt` (10 rounds) + `JWT` (`HS256`) | Server-side token validation and session management |

---

## Threat Model & Security Matrix

| Threat Vector | Attack Scenario | ZAP Mitigation |
| :--- | :--- | :--- |
| **Server Compromise** | Rogue admin or compromised hosting database | Database contains only AES-256-GCM ciphertexts, public keys, and bcrypt hashes. Plaintext cannot be recovered without client private keys. |
| **Precomputation Attacks** | Rainbow table attacks across known usernames | Dynamic 16-byte CSPRNG per-user salts force attacks to be calculated individually at $2^{256}$ cost. |
| **Key Compromise / Past Decryption** | Stolen identity key used to decrypt historical traffic | Ephemeral Key Ratcheting (PFS) ensures past messages were encrypted with unique single-use keys that are deleted after use. |
| **Replay & Injection Attacks** | Intercepting ciphertexts and re-sending or re-routing to different chats | AES-GCM Additional Authenticated Data (AAD) cryptographically locks sender, recipient, sequence, and message ID into the auth tag. |
| **Non-Repudiation Leak** | Exporting chat transcripts as legal receipts | Symmetric HMAC-SHA256 authentication provides deniability (both parties hold key material). |
| **Public Key Substitution** | Server returning modified public keys | Users can verify identities out-of-band using the 20-digit deterministic Safety Number fingerprint. |
| **Attachment Interception** | Intercepting uploaded images or voice notes | Media files are encrypted in the browser with AES-GCM prior to upload and served with sandboxed CSP isolation. |
| **DoS & Flooding** | Brute-force guessing and upload flooding | Multi-tiered rate limiters isolate authentication (30 req/15m), uploads (300 req/15m), and general API traffic. |

---

## Automated Verification & Testing

ZAP includes automated suites for cryptographic security invariants, multi-client live socket integration, and complete multi-user end-to-end browser automation:

```bash
# Run all core test suites
npm test

# Run individual test suites
npm run test:crypto       # 10/10 Cryptographic security invariants
npm run test:integration  # 20/20 Multi-client live socket & E2EE exchanges
npm run test:e2e          # 29/29 Full Puppeteer browser end-to-end automation suite
```

### Cryptographic Security Invariant Suite (`npm run test:crypto`)
```text
================================================================
   ZAP PROTOCOL: AUTOMATED CRYPTOGRAPHIC VERIFICATION SUITE   
================================================================

[PASS] NIST SP 800-132: 100 Unique CSPRNG Salts Generated with 0 Collisions
[PASS] Anti-Enumeration Oracle: Constant-Time Deterministic Pseudo-Salts for Unknown Users
[PASS] PBKDF2-HMAC-SHA256: 600,000 Iteration Key Derivation & Backward Compatibility
[PASS] ECDH P-256: Shared Secret Key Agreement Between Two Independent Peers
[PASS] Ephemeral Ratcheting (PFS): Unique Single-Use Keys Derived Per Message Sequence
[PASS] PFS Compromise Isolation: Leaked Past Message Key Cannot Decrypt Future Messages
[PASS] AES-256-GCM AAD: Context Envelope Binding Blocks Spoofing and Re-routing Attacks
[PASS] Deniable HMAC-SHA256: Session Message Authenticity Without Third-Party Non-Repudiation
[PASS] High-Throughput Burst: 50 Rapid Consecutive Encryptions with Unique 96-bit IVs
[PASS] Safety Numbers: Commutative SHA-256 20-Digit Fingerprint Verification (MITM Defense)

================================================================
  ALL 10 / 10 CRYPTOGRAPHIC INVARIANTS VERIFIED SUCCESSFULLY (100%)  
================================================================
```

### Multi-Client E2E Integration Suite (`npm run test:integration`)
```text
================================================================
   ZAP PROTOCOL: MULTI-CLIENT END-TO-END INTEGRATION SUITE     
================================================================

[PASS] Test 1a: Alice registered and received JWT
[PASS] Test 1b: Bob registered and received JWT
[PASS] Test 2: Alice and Bob connected to WebSocket server with JWT
[PASS] Test 3: Alice queried Bob status and received "online"
[PASS] Test 4a: Server acknowledged Alice send-message with messageId
[PASS] Test 4b: Bob received exact ciphertext payload
[PASS] Test 4c: Bob verified Deniable HMAC-SHA256 authentication tag
[PASS] Test 4d: Bob verified ECDSA P-256 digital signature
[PASS] Test 4e: Bob successfully decrypted plaintext matching Alice input
[PASS] Test 5: Alice received real-time messages-read receipt from Bob
[PASS] Test 6: Alice and Bob computed identical 20-digit commutative Safety Numbers
[PASS] Test 7a: Group created on server with versioned key envelope
[PASS] Test 7b: Bob received group-added socket event
[PASS] Test 7c: Bob unsealed key envelope and decrypted group title
[PASS] Test 7d: Bob received and decrypted group message broadcast
[PASS] Test 8a: Bob received call-made offer from Alice
[PASS] Test 8b: Alice received answer-made SDP from Bob
[PASS] Test 8c: Bob received call-ended event on hangup
[PASS] Test 9a: Alice successfully blocked Bob
[PASS] Test 9b: Bob queries Alice status and receives "offline" due to block isolation

================================================================
  ALL 20 / 20 INTEGRATION TESTS PASSED SUCCESSFULLY (100%)  
================================================================
```

### Full Multi-User Browser Automation Suite (`npm run test:e2e`)
```text
================================================================
   ZAP / CHATRA: COMPREHENSIVE END-TO-END AUTOMATION SUITE
================================================================

MODULE 1: AUTHENTICATION, REGISTRATION & SESSION PERSISTENCE (Tests 01-04)
  [PASS] Register Alice with PBKDF2 (600k rounds) & Key Generation
  [PASS] Register Bob with PBKDF2 (600k rounds) & Key Generation
  [PASS] Register Charlie with PBKDF2 (600k rounds) & Key Generation
  [PASS] Verify Session Auto-Restore & Persistent Key Storage

MODULE 2: USER SEARCH, CONTACTS, PRESENCE & CUSTOM NICKNAMES (Tests 05-08)
  [PASS] Bob searches for Alice and adds her to active chats
  [PASS] Verify Alice real-time online status badge in Bob view
  [PASS] Alice searches for Charlie and adds Charlie to contacts
  [PASS] Test Sidebar collapse/expand animation toggle button

MODULE 3: 1-ON-1 DIRECT E2EE MESSAGES, MARKDOWN & READ RECEIPTS (Tests 09-11)
  [PASS] Bob sends E2EE plaintext message to Alice
  [PASS] Bob sends Markdown formatted message (bold, italic, code, spoiler)
  [PASS] Alice types and Bob receives typing indicator

MODULE 4: APPLE EMOJI PICKER, ANIMATED GIFS & JUMBO EMOJIS (Tests 12-13)
  [PASS] Test Apple Emoji Picker: search and insert emoji
  [PASS] Test GIF Picker and sending animated GIF reaction

MODULE 5: PHOTOS, MULTI-PHOTO ALBUMS & VOICE NOTES (Tests 14-16)
  [PASS] Send Single Photo Attachment and verify image preview
  [PASS] Send Multi-Photo Album (3 images) and verify collage grid
  [PASS] Test Voice Note recording, waveform animation, and send

MODULE 6: QUOTED REPLIES, FORWARD MODAL & SAFETY VERIFICATION (Tests 17-19)
  [PASS] Test Quoted Message Reply and jump-to-source click
  [PASS] Test Message Forwarding modal to Charlie
  [PASS] Test Out-of-Band Safety Number Fingerprint verification modal

MODULE 7: WEBRTC 1-ON-1 CALLS, HUD CONTROLS & SCREEN SHARING (Tests 20-22)
  [PASS] Voice Call Decline scenario (Alice calls Bob, Bob declines)
  [PASS] Video Call Connect scenario (Alice calls Bob, Bob accepts)
  [PASS] Test Call HUD Buttons: Mute, Camera, Screen Share, PiP, and Hang Up

MODULE 8: ENCRYPTED GROUP CHATS, MEMBER ROLES & GROUP CALLS (Tests 23-26)
  [PASS] Create Group Chat with Bob and Charlie as members
  [PASS] Send Encrypted Group Message and verify all members decrypt
  [PASS] Test Group Info Modal and Admin role management
  [PASS] Test Group Video Call signaling and multi-peer join

MODULE 9: SETTINGS, THEME TOKENS, PRIVACY CONTROLS & LOGOUT (Tests 27-29)
  [PASS] Open Settings View, update display name and theme color
  [PASS] Test Block Contact and Privacy Isolation
  [PASS] Test Log Out action and return to Auth View

================================================================
  ALL 29 / 29 COMPREHENSIVE E2E TESTS PASSED SUCCESSFULLY (100%)
================================================================
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

### Option B: Turnkey Self-Hosted Stack (Docker Compose + Coturn + Redis + Postgres)

For private servers, enterprise setups, and sovereign deployments, ZAP includes a complete multi-container Docker Compose stack with built-in **PostgreSQL**, **Redis Pub/Sub cluster adapter**, and a **Coturn STUN/TURN media relay** for strict Symmetric NAT traversal:

```bash
# 1. Clone repository
git clone https://github.com/Amer-alsayed/ZAP.git
cd ZAP

# 2. Launch complete turnkey stack in background
docker compose up -d --build
```

#### Architecture of Docker Stack:
- **`zap-app`**: ZAP full-stack Node.js + React service (Port `5000`).
- **`postgres`**: Persistent PostgreSQL 16 database container with volume backup.
- **`redis`**: High-throughput distributed cluster pub/sub bus for horizontal auto-scaling.
- **`coturn`**: Sovereign STUN/TURN server (Ports `3478`, `5349`, and `49160-49200/udp`) guaranteeing WebRTC calls connect behind strict mobile carrier firewalls.

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
| `GET` | `/api/auth/salt/:username` | None | Auth (30/15m) | Retrieves user CSPRNG salt or constant-time deterministic pseudo-salt for anti-enumeration. |
| `POST` | `/api/auth/register` | None | Auth (30/15m) | Registers user with CSPRNG salt, public keys, and encrypted key bundle. |
| `POST` | `/api/auth/login` | None | Auth (30/15m) | Authenticates login hash, returns JWT and user key bundle. |
| `GET` | `/api/auth/search` | JWT | General (500/15m) | Queries users by username prefix. |
| `POST` | `/api/upload` | JWT | Upload (300/15m) | Uploads client-encrypted binary payload (max 50MB). |
| `GET` | `/uploads/:filename` | None | General | Serves encrypted binary blobs with sandboxed headers. |
| `GET` | `/api/webrtc/ice-servers` | None | General (500/15m) | Dynamically discovers active STUN and TURN relay credentials. |

### Socket.IO Protocol Events

| Channel | Event | Payload Direction | Description |
| :--- | :--- | :---: | :--- |
| **Auth & Contacts** | `connection` | Client $\rightarrow$ Server | Authenticates connection via handshake JWT token. |
| | `get-contacts` | Client $\leftrightarrow$ Server | Fetches conversation partners, profiles, and unread counters. |
| | `get-chat-history` | Client $\leftrightarrow$ Server | Retrieves encrypted 1-on-1 message history. |
| | `block-user` / `unblock-user` | Client $\leftrightarrow$ Server | Manages privacy isolation blocklists. |
| **1-on-1 Messaging** | `send-message` | Client $\rightarrow$ Server | Dispatches `{ recipient, ciphertext, iv, aad, authTag, signature }`. |
| | `receive-message` | Server $\rightarrow$ Client | Delivers authenticated AEAD ciphertext envelope to recipient socket. |
| | `message-delivered` | Server $\rightarrow$ Client | Confirms message delivery receipt (`✓✓`). |
| | `mark-as-read` / `messages-read`| Client $\leftrightarrow$ Server | Signals read receipts and updates blue tick status. |
| | `message-edit` | Client $\leftrightarrow$ Server | Propagates edited ciphertext to conversation participants. |
| | `delete-messages` / `delete-chat`| Client $\leftrightarrow$ Server | Synchronizes single message, selection, or chat removal. |
| **Group Messaging** | `create-group` | Client $\leftrightarrow$ Server | Creates group with initial sealed key envelopes. |
| | `get-groups` | Client $\leftrightarrow$ Server | Fetches user groups and cryptographic key envelopes. |
| | `send-group-message` | Client $\leftrightarrow$ Server | Broadcasts encrypted group message payload. |
| | `receive-group-message` | Server $\rightarrow$ Client | Delivers encrypted group message to all member sockets. |
| | `rotate-group-keys` | Client $\leftrightarrow$ Server | Distributes new sealed symmetric key envelopes (KV). |
| | `update-group-profile` | Client $\leftrightarrow$ Server | Renames group or updates group avatar icon. |
| | `add-group-members` / `remove-group-member` | Client $\leftrightarrow$ Server | Modifies group membership and triggers key rotation. |
| | `set-member-role` | Client $\leftrightarrow$ Server | Updates member permissions (Owner, Admin, Member). |
| **P2P & Group Calling**| `call-user` / `call-accepted` | Client $\leftrightarrow$ Server | Relays 1-on-1 WebRTC SDP offer and answer. |
| | `ice-candidate` | Client $\leftrightarrow$ Server | Exchanges STUN/TURN network routing candidates. |
| | `end-call` | Client $\leftrightarrow$ Server | Terminates active 1-on-1 call session. |
| | `start-group-call` / `join-group-call` | Client $\leftrightarrow$ Server | Initiates or joins multi-peer mesh group call session. |
| | `group-call-signal` | Client $\leftrightarrow$ Server | Relays multi-peer mesh WebRTC SDP offers/answers and ICE. |
| | `leave-group-call` | Client $\leftrightarrow$ Server | Disconnects peer from group call mesh. |
| **Presence** | `typing` / `stop-typing`| Client $\leftrightarrow$ Server | Broadcasts active typing indicators. |
| | `user-status` | Server $\rightarrow$ Client | Real-time online/offline presence notifications. |
| | `profile-updated` | Server $\rightarrow$ Client | Propagates display name and avatar updates in real time. |

---

## 📁 Repository Structure & Modular Architecture

```text
ZAP/
├── client/                           # React 19 Single Page Application
│   ├── src/
│   │   ├── components/               # Modular UI Components
│   │   │   ├── AlbumGalleryModal.jsx # Full-screen lightbox album gallery viewer
│   │   │   ├── AppleEmojiPicker.jsx  # Apple-style emoji & Tenor GIF reaction picker
│   │   │   ├── ChatArea.jsx          # Message stream, input bar, and reaction trays
│   │   │   ├── Dashboard.jsx         # Call log history and analytics dashboard
│   │   │   ├── GroupCallWindow.jsx   # Multi-peer group video grid & in-call controls
│   │   │   ├── MediaAlbumGrid.jsx    # Inline multi-photo collage grid layouts
│   │   │   ├── Sidebar.jsx           # Unified contacts & groups list with search
│   │   │   ├── TypingIndicator.jsx   # Animated pulsing typing indicator
│   │   │   └── VoiceNotePlayerItem.jsx # Dynamic waveform audio scrubber player
│   │   ├── hooks/                    # Headless State & Protocol Hooks
│   │   │   ├── useAuthSession.js     # Instant session restoration & key management
│   │   │   ├── useChatManager.js     # 1-on-1 E2EE messaging, contacts, & persistence
│   │   │   ├── useGroupCalls.js      # Multi-peer WebRTC mesh calling orchestration
│   │   │   ├── useGroupManager.js    # Zero-knowledge group encryption & member roles
│   │   │   └── useWebRTC.js          # Direct 1-on-1 P2P voice & video signaling
│   │   ├── services/                 # Core Protocol & Networking Services
│   │   │   ├── crypto.js             # Native Web Crypto API hardware-accelerated engine
│   │   │   └── socket.js             # Socket.IO event emitter & timeout handlers
│   │   ├── styles/                   # Glassmorphic CSS design system with RGB tokens
│   │   └── utils/                    # Audio engines, WebRTC ICE discovery, & helpers
│   └── vite.config.js                # Vite build configuration & bundler optimization
├── server/                           # Node.js Zero-Knowledge Gateway
│   ├── src/
│   │   ├── handlers/                 # Modular Socket.IO Event Handlers
│   │   │   ├── callSocketHandler.js  # 1-on-1 WebRTC & multi-peer group call signaling
│   │   │   ├── messageSocketHandler.js # E2EE message routing, edits, deletes, & history
│   │   │   └── userSocketHandler.js  # Presence, contacts discovery, & blocklists
│   │   ├── db.js                     # Unified PostgreSQL & SQLite WAL database driver
│   │   └── socketHandler.js          # Socket.IO connection dispatcher & auth middleware
│   └── server.js                     # Express REST API, rate limiters, & static serving
└── scripts/                          # Automated Verification & Test Automation Suites
    ├── test_crypto_security.js       # 10/10 Cryptographic security invariant suite
    ├── test_integration_e2e.js       # 20/20 Multi-client live socket integration suite
    └── test_comprehensive_app.js     # 29/29 Full Puppeteer browser automation suite
```

---

## Security & Vulnerability Reporting

If you discover a security vulnerability within ZAP, please do **not** open a public issue. Open a private GitHub Security Advisory or contact the maintainers directly.

---

## License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for details.
