import { webcrypto } from 'node:crypto';
if (!globalThis.window) {
  globalThis.window = {
    crypto: webcrypto,
    btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary')
  };
}

import http from 'http';
import express from '../server/node_modules/express/index.js';
import { Server } from '../server/node_modules/socket.io/dist/index.js';
import { io as ioClient } from '../client/node_modules/socket.io-client/build/esm/index.js';
import { initDb, dbRun, dbGet, dbAll } from '../server/src/db.js';
import config from '../server/src/config.js';
import { socketHandler } from '../server/src/socketHandler.js';
import { register, login, searchUser, getAuthSalt } from '../server/src/authController.js';
import { authenticateToken } from '../server/src/middleware/authMiddleware.js';
import {
  generateKeyPairs,
  deriveSharedSecret,
  deriveRatchetedMessageKey,
  deriveAuthKey,
  generateMessageAuthTag,
  verifyMessageAuthTag,
  encryptMessage,
  decryptMessage,
  signData,
  verifyDataSignature,
  computeSafetyNumber,
  bufferToBase64,
  base64ToBuffer
} from '../client/src/services/crypto.js';
import {
  generateGroupKeyMaterial,
  importGroupKey,
  sealGroupKeyEnvelope,
  openGroupKeyEnvelope,
  encryptGroupPayload,
  decryptGroupPayload
} from '../client/src/services/groupCrypto.js';

let passed = 0;
let failed = 0;

function assert(condition, description) {
  if (condition) {
    console.log(`[PASS] ${description}`);
    passed++;
  } else {
    console.error(`[FAIL] ${description}`);
    failed++;
    throw new Error(`Assertion failed: ${description}`);
  }
}

async function runE2ETests() {
  console.log('================================================================');
  console.log('   ZAP PROTOCOL: MULTI-CLIENT END-TO-END INTEGRATION SUITE     ');
  console.log('================================================================\n');

  // 1. Initialize SQLite database
  await initDb();

  // 2. Setup Test Server on dynamic port
  const app = express();
  app.use(express.json());
  app.get('/api/auth/salt/:username', getAuthSalt);
  app.get('/api/auth/salt', getAuthSalt);
  app.post('/api/auth/register', register);
  app.post('/api/auth/login', login);
  app.get('/api/auth/search', authenticateToken, searchUser);

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });
  socketHandler(io);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const serverUrl = `http://localhost:${port}`;
  console.log(`[INIT] Ephemeral test server running at ${serverUrl}`);

  // Test fixtures: Alice and Bob
  const aliceRaw = await generateKeyPairs();
  const aliceKeys = {
    identityPrivateKey: aliceRaw.identityKeyPair.privateKey,
    identityPublicKeyJwk: await webcrypto.subtle.exportKey('jwk', aliceRaw.identityKeyPair.publicKey),
    signingPrivateKey: aliceRaw.signingKeyPair.privateKey,
    signingPublicKeyJwk: await webcrypto.subtle.exportKey('jwk', aliceRaw.signingKeyPair.publicKey)
  };

  const bobRaw = await generateKeyPairs();
  const bobKeys = {
    identityPrivateKey: bobRaw.identityKeyPair.privateKey,
    identityPublicKeyJwk: await webcrypto.subtle.exportKey('jwk', bobRaw.identityKeyPair.publicKey),
    signingPrivateKey: bobRaw.signingKeyPair.privateKey,
    signingPublicKeyJwk: await webcrypto.subtle.exportKey('jwk', bobRaw.signingKeyPair.publicKey)
  };

  const randSuffix = Math.random().toString(36).substring(2, 7);
  const aliceUsername = `alice_${randSuffix}`;
  const bobUsername = `bob_${randSuffix}`;

  // Clean up any potential stale test accounts
  await dbRun('DELETE FROM users WHERE LOWER(username) IN (?, ?)', [aliceUsername.toLowerCase(), bobUsername.toLowerCase()]);

  let aliceToken = null;
  let bobToken = null;

  try {
    // -------------------------------------------------------------
    // Test 1: User Registration & Salt Discovery
    // -------------------------------------------------------------
    const regAliceRes = await fetch(`${serverUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: aliceUsername,
        loginHash: 'dummy_login_hash_alice_123',
        authSalt: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
        publicIdentityKey: aliceKeys.identityPublicKeyJwk,
        publicSigningKey: aliceKeys.signingPublicKeyJwk,
        encryptedPrivateKeys: { ciphertext: 'dummy_enc_alice', iv: 'dummy_iv_alice' }
      })
    });
    const regAliceData = await regAliceRes.json();
    assert(regAliceRes.ok && regAliceData.token, 'Test 1a: Alice registered and received JWT');
    aliceToken = regAliceData.token;

    const regBobRes = await fetch(`${serverUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: bobUsername,
        loginHash: 'dummy_login_hash_bob_123',
        authSalt: 'b1c2d3e4f5a60718293b4c5d6e7f8a90',
        publicIdentityKey: bobKeys.identityPublicKeyJwk,
        publicSigningKey: bobKeys.signingPublicKeyJwk,
        encryptedPrivateKeys: { ciphertext: 'dummy_enc_bob', iv: 'dummy_iv_bob' }
      })
    });
    const regBobData = await regBobRes.json();
    assert(regBobRes.ok && regBobData.token, 'Test 1b: Bob registered and received JWT');
    bobToken = regBobData.token;

    // -------------------------------------------------------------
    // Test 2: Live Socket.IO JWT Authentication Handshake
    // -------------------------------------------------------------
    const aliceSocket = ioClient(serverUrl, { auth: { token: aliceToken }, reconnection: false });
    const bobSocket = ioClient(serverUrl, { auth: { token: bobToken }, reconnection: false });

    await Promise.all([
      new Promise(res => aliceSocket.on('connect', res)),
      new Promise(res => bobSocket.on('connect', res))
    ]);
    assert(aliceSocket.connected && bobSocket.connected, 'Test 2: Alice and Bob connected to WebSocket server with JWT');

    // -------------------------------------------------------------
    // Test 3: Real-Time User Presence & Status Query
    // -------------------------------------------------------------
    const bobStatus = await new Promise(res => {
      aliceSocket.emit('get-user-status', bobUsername, res);
    });
    assert(bobStatus.status === 'online', 'Test 3: Alice queried Bob status and received "online"');

    // -------------------------------------------------------------
    // Test 4: Live Ephemeral E2EE Direct Messaging (Alice -> Bob)
    // -------------------------------------------------------------
    const aliceSharedSecret = await deriveSharedSecret(aliceKeys.identityPrivateKey, bobKeys.identityPublicKeyJwk);
    const bobSharedSecret = await deriveSharedSecret(bobKeys.identityPrivateKey, aliceKeys.identityPublicKeyJwk);

    const clientMsgId = 'msg_' + Date.now();
    const timestamp = Date.now();
    const seq = 1;
    const aadContext = { s: aliceUsername, r: bobUsername, mid: clientMsgId, t: timestamp, seq };

    const aliceEphemeralKey = await deriveRatchetedMessageKey(aliceSharedSecret, seq, aliceUsername, bobUsername);
    const plaintextMessage = { text: 'Hello Bob! This is an authenticated zero-knowledge message.' };
    const { ciphertext, iv, aad } = await encryptMessage(JSON.stringify(plaintextMessage), aliceEphemeralKey, aadContext);

    const aliceAuthKey = await deriveAuthKey(aliceSharedSecret);
    const authTag = await generateMessageAuthTag(aliceAuthKey, ciphertext, iv, aad);
    const signature = await signData(ciphertext, aliceKeys.signingPrivateKey);

    const messagePromise = new Promise((resolve) => {
      bobSocket.on('receive-message', resolve);
    });

    const sendAck = await new Promise((resolve) => {
      aliceSocket.emit('send-message', {
        recipient: bobUsername,
        ciphertext,
        iv,
        signature,
        aad,
        authTag
      }, resolve);
    });
    assert(sendAck.success && sendAck.messageId, 'Test 4a: Server acknowledged Alice send-message with messageId');

    const receivedMsg = await messagePromise;
    assert(receivedMsg.ciphertext === ciphertext, 'Test 4b: Bob received exact ciphertext payload');

    // Bob verifies HMAC Auth Tag
    const bobAuthKey = await deriveAuthKey(bobSharedSecret);
    const isAuthValid = await verifyMessageAuthTag(bobAuthKey, receivedMsg.ciphertext, receivedMsg.iv, receivedMsg.aad, receivedMsg.authTag);
    assert(isAuthValid === true, 'Test 4c: Bob verified Deniable HMAC-SHA256 authentication tag');

    // Bob verifies Digital Signature
    const isSigValid = await verifyDataSignature(receivedMsg.ciphertext, receivedMsg.signature, aliceKeys.signingPublicKeyJwk);
    assert(isSigValid === true, 'Test 4d: Bob verified ECDSA P-256 digital signature');

    // Bob decrypts payload
    const decryptedJson = await decryptMessage(receivedMsg.ciphertext, bobSharedSecret, receivedMsg.iv, receivedMsg.aad);
    const decryptedPayload = JSON.parse(decryptedJson);
    assert(decryptedPayload.text === plaintextMessage.text, 'Test 4e: Bob successfully decrypted plaintext matching Alice input');

    // -------------------------------------------------------------
    // Test 5: Real-Time Read Receipts (Bob -> Alice)
    // -------------------------------------------------------------
    const readPromise = new Promise((resolve) => {
      aliceSocket.on('messages-read', resolve);
    });
    bobSocket.emit('mark-as-read', { sender: aliceUsername });
    const readReceipt = await readPromise;
    assert(readReceipt.reader.toLowerCase() === bobUsername.toLowerCase(), 'Test 5: Alice received real-time messages-read receipt from Bob');

    // -------------------------------------------------------------
    // Test 6: Out-of-Band MITM Safety Numbers Matching
    // -------------------------------------------------------------
    const aliceFingerprint = await computeSafetyNumber(aliceKeys.identityPublicKeyJwk, bobKeys.identityPublicKeyJwk);
    const bobFingerprint = await computeSafetyNumber(bobKeys.identityPublicKeyJwk, aliceKeys.identityPublicKeyJwk);
    assert(
      aliceFingerprint === bobFingerprint && /^\d{5} \d{5} \d{5} \d{5}$/.test(aliceFingerprint),
      'Test 6: Alice and Bob computed identical 20-digit commutative Safety Numbers'
    );

    // -------------------------------------------------------------
    // Test 7: Multi-User Zero-Knowledge Group Chat
    // -------------------------------------------------------------
    const groupKeyMaterial = generateGroupKeyMaterial();
    const aliceGroupKey = await importGroupKey(groupKeyMaterial);
    const bobPairwiseSecret = await deriveSharedSecret(aliceKeys.identityPrivateKey, bobKeys.identityPublicKeyJwk);
    const bobEnvelope = await sealGroupKeyEnvelope(groupKeyMaterial, bobPairwiseSecret);
    const aliceSelfSecret = await deriveSharedSecret(aliceKeys.identityPrivateKey, aliceKeys.identityPublicKeyJwk);
    const aliceSelfEnvelope = await sealGroupKeyEnvelope(groupKeyMaterial, aliceSelfSecret);

    const groupMeta = await encryptGroupPayload({ n: 'Top Secret Research' }, aliceGroupKey);

    const groupAddedPromise = new Promise(res => bobSocket.on('group-added', res));

    const createGroupAck = await new Promise(res => {
      aliceSocket.emit('create-group', {
        nameCiphertext: groupMeta.ciphertext,
        nameIv: groupMeta.iv,
        members: [{ username: bobUsername }],
        envelopes: {
          [aliceUsername.toLowerCase()]: aliceSelfEnvelope,
          [bobUsername.toLowerCase()]: bobEnvelope
        }
      }, res);
    });

    assert(createGroupAck.success && createGroupAck.groupId, 'Test 7a: Group created on server with versioned key envelope');
    const groupId = createGroupAck.groupId;

    const groupAddedEvent = await groupAddedPromise;
    assert(groupAddedEvent.id === groupId, 'Test 7b: Bob received group-added socket event');

    // Bob unseals group envelope
    const bobUnsealedRaw = await openGroupKeyEnvelope(bobEnvelope, bobSharedSecret);
    const bobGroupKey = await importGroupKey(bobUnsealedRaw);
    const bobDecryptedName = await decryptGroupPayload(groupAddedEvent.nameCiphertext, bobGroupKey, groupAddedEvent.nameIv);
    assert(bobDecryptedName.n === 'Top Secret Research', 'Test 7c: Bob unsealed key envelope and decrypted group title');

    // Alice sends encrypted message into group
    const groupMsgPromise = new Promise(res => bobSocket.on('receive-group-message', res));
    const groupMsgPayload = { text: 'Welcome to the encrypted group channel!' };
    const { ciphertext: groupCiphertext, iv: groupIv } = await encryptGroupPayload(groupMsgPayload, aliceGroupKey);
    const groupSig = await signData(groupCiphertext, aliceKeys.signingPrivateKey);

    aliceSocket.emit('send-group-message', {
      groupId,
      ciphertext: groupCiphertext,
      iv: groupIv,
      signature: groupSig
    });

    const receivedGroupMsg = await groupMsgPromise;
    const decryptedGroupMsg = await decryptGroupPayload(receivedGroupMsg.ciphertext, bobGroupKey, receivedGroupMsg.iv);
    assert(decryptedGroupMsg.text === groupMsgPayload.text, 'Test 7d: Bob received and decrypted group message broadcast');

    // -------------------------------------------------------------
    // Test 8: WebRTC 1-on-1 Signaling Relay (Alice -> Bob)
    // -------------------------------------------------------------
    const dummyOffer = { type: 'offer', sdp: 'v=0\r\no=- 123456 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' };
    const dummyAnswer = { type: 'answer', sdp: 'v=0\r\no=- 654321 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' };

    const callMadePromise = new Promise(res => bobSocket.on('call-made', res));
    aliceSocket.emit('call-user', { to: bobUsername, offer: dummyOffer, mediaType: 'video' });
    const incomingCall = await callMadePromise;
    assert(incomingCall.from.toLowerCase() === aliceUsername.toLowerCase(), 'Test 8a: Bob received call-made offer from Alice');

    const answerMadePromise = new Promise(res => aliceSocket.on('answer-made', res));
    bobSocket.emit('make-answer', { to: aliceUsername, answer: dummyAnswer });
    const answeredCall = await answerMadePromise;
    assert(answeredCall.answer.sdp === dummyAnswer.sdp, 'Test 8b: Alice received answer-made SDP from Bob');

    const hangupPromise = new Promise(res => bobSocket.on('call-ended', res));
    aliceSocket.emit('hang-up', { to: bobUsername, reason: 'completed' });
    const callEnded = await hangupPromise;
    assert(callEnded.from.toLowerCase() === aliceUsername.toLowerCase(), 'Test 8c: Bob received call-ended event on hangup');

    // -------------------------------------------------------------
    // Test 9: Privacy & User Blocking Isolation
    // -------------------------------------------------------------
    const blockAck = await new Promise(res => {
      aliceSocket.emit('block-user', { targetUsername: bobUsername }, res);
    });
    assert(blockAck.success === true, 'Test 9a: Alice successfully blocked Bob');

    const bobQueryAlice = await new Promise(res => {
      bobSocket.emit('get-user-status', aliceUsername, res);
    });
    assert(bobQueryAlice.status === 'offline', 'Test 9b: Bob queries Alice status and receives "offline" due to block isolation');

    // -------------------------------------------------------------
    // Teardown
    // -------------------------------------------------------------
    aliceSocket.disconnect();
    bobSocket.disconnect();
    await new Promise(res => server.close(res));

    console.log('\n================================================================');
    console.log(`  ALL ${passed} / ${passed} INTEGRATION TESTS PASSED SUCCESSFULLY (100%)  `);
    console.log('================================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ INTEGRATION TEST FAILED:', err);
    process.exit(1);
  }
}

runE2ETests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
