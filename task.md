# Task List: Anonymous E2EE Chat App

## Phase 1: Project Setup & Core Server
- [x] Initialize project directory and create clean folder structure (`/server` and `/client`)
- [x] Create root `package.json` with scripts to run backend and frontend concurrently
- [x] Initialize server with `express`, `socket.io`, `sqlite3`, `jsonwebtoken`, `bcryptjs`
- [x] Set up basic Express app and server health endpoint

## Phase 2: Database & Auth Backend
- [x] Initialize SQLite database schema (`users`, `messages`, `public_keys`, `sessions`)
- [x] Implement authentication APIs (`/api/auth/register`, `/api/auth/login`)
- [x] Implement JWT verify middleware
- [x] Set up Socket.io middleware to verify JWT tokens

## Phase 3: Client Application (Vite + React)
- [x] Create client Vite project using React + Vanilla CSS
- [x] Build the UI Layout (Auth Page, Sidebar with Contacts, Chat Area)
- [x] Implement Client-Side API services (`api.js` for fetches, `socket.js` for WebSockets)
- [x] Implement client-side key derivation (PBKDF2) and registration/login client code

## Phase 4: Real-time Plaintext Messaging
- [x] Connect WebSocket client on successful login
- [x] Implement Socket.io handlers on server for message routing
- [x] Implement client messaging (sending and receiving real-time texts)
- [x] Implement offline message delivery (fetching history from server on load)

## Phase 5: End-to-End Encryption (E2EE)
- [x] Implement Web Crypto API helpers for ECDH/ECDSA key pair generation
- [x] Encrypt private keys locally with derived master password key before backing up to server
- [x] Implement key exchange (fetching recipient public ECDH/ECDSA keys from server)
- [x] Encrypt messages (AES-GCM) and sign them (ECDSA) before sending
- [x] Decrypt and verify incoming messages on client side

## Phase 6: Media sharing & Voice / Video calls
- [x] Implement client-side file encryption & server-side `/api/upload` endpoint
- [x] Implement voice notes recording & playback (E2EE)
- [x] Implement WebRTC P2P voice/video call setup
