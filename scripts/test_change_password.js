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
import { initDb } from '../server/src/db.js';
import { register, login, getAuthSalt, changePassword } from '../server/src/authController.js';
import { authenticateToken } from '../server/src/middleware/authMiddleware.js';
import {
  deriveKeysFromPassword,
  generateKeyPairs,
  encryptAndBackupPrivateKeys,
  decryptRestoredPrivateKeys,
  generateRandomSalt,
  signData,
  verifyDataSignature
} from '../client/src/services/crypto.js';

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

async function runPasswordTests() {
  console.log('================================================================');
  console.log('   ZAP PROTOCOL: ZERO-KNOWLEDGE PASSWORD CHANGE VERIFICATION   ');
  console.log('================================================================\n');

  await initDb();

  const app = express();
  app.use(express.json());
  app.get('/api/auth/salt/:username', getAuthSalt);
  app.post('/api/auth/register', register);
  app.post('/api/auth/login', login);
  app.post('/api/auth/change-password', authenticateToken, changePassword);

  const server = http.createServer(app);
  await new Promise((res) => server.listen(0, res));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`[INIT] Ephemeral test server running at ${baseUrl}`);

  try {
    const testUsername = `user_${Math.random().toString(36).slice(2, 7)}`;
    const originalPassword = 'InitialSecurePassword123!';
    const newPassword = 'UpdatedSuperSecurePassword456!';

    // Step 1: Register initial user
    const originalSalt = generateRandomSalt();
    const { loginHash: originalLoginHash, encryptionKey: originalEncKey } = await deriveKeysFromPassword(
      originalPassword,
      testUsername,
      originalSalt
    );

    const { identityKeyPair, signingKeyPair } = await generateKeyPairs();
    const originalBackup = await encryptAndBackupPrivateKeys(
      identityKeyPair.privateKey,
      signingKeyPair.privateKey,
      originalEncKey
    );

    const publicIdentityKey = await window.crypto.subtle.exportKey('jwk', identityKeyPair.publicKey);
    const publicSigningKey = await window.crypto.subtle.exportKey('jwk', signingKeyPair.publicKey);

    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername,
        loginHash: originalLoginHash,
        publicIdentityKey,
        publicSigningKey,
        encryptedPrivateKeys: originalBackup,
        authSalt: originalSalt
      })
    });

    const regData = await regRes.json();
    assert(regRes.status === 201 && regData.token, 'Test 1: User registered with initial credentials');
    const userToken = regData.token;

    // Step 2: Attempt change password with WRONG current password
    const wrongSalt = generateRandomSalt();
    const { loginHash: wrongLoginHash } = await deriveKeysFromPassword(
      'CompletelyWrongPassword!',
      testUsername,
      wrongSalt
    );

    const failRes = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`
      },
      body: JSON.stringify({
        currentLoginHash: wrongLoginHash,
        newLoginHash: originalLoginHash,
        encryptedPrivateKeys: originalBackup,
        authSalt: originalSalt
      })
    });
    assert(failRes.status === 400, 'Test 2: Rejection of password change when current password is wrong');

    // Step 3: Attempt change password to SAME password
    const sameRes = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`
      },
      body: JSON.stringify({
        currentLoginHash: originalLoginHash,
        newLoginHash: originalLoginHash,
        encryptedPrivateKeys: originalBackup,
        authSalt: originalSalt
      })
    });
    assert(sameRes.status === 400, 'Test 3: Rejection of password change when new password is identical');

    // Step 4: Perform legitimate password change with re-wrapped keys
    const newSalt = generateRandomSalt();
    const { loginHash: newLoginHash, encryptionKey: newEncKey } = await deriveKeysFromPassword(
      newPassword,
      testUsername,
      newSalt
    );

    const reWrappedBackup = await encryptAndBackupPrivateKeys(
      identityKeyPair.privateKey,
      signingKeyPair.privateKey,
      newEncKey
    );

    const changeRes = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`
      },
      body: JSON.stringify({
        currentLoginHash: originalLoginHash,
        newLoginHash: newLoginHash,
        encryptedPrivateKeys: reWrappedBackup,
        authSalt: newSalt
      })
    });
    const changeData = await changeRes.json();
    assert(changeRes.status === 200 && changeData.message.includes('successfully'), 'Test 4: Password changed successfully with re-wrapped private keys');

    // Step 5: Verify login with OLD password fails
    const oldLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername,
        loginHash: originalLoginHash
      })
    });
    assert(oldLoginRes.status === 400, 'Test 5: Login with old password is now rejected');

    // Step 6: Verify login with NEW password succeeds
    const newLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername,
        loginHash: newLoginHash
      })
    });
    const newLoginData = await newLoginRes.json();
    assert(newLoginRes.status === 200 && newLoginData.token, 'Test 6: Login with new password succeeds and returns fresh token');

    // Step 7: Decrypt the re-wrapped private keys using the new password key
    const restoredKeys = await decryptRestoredPrivateKeys(
      newLoginData.user.encryptedPrivateKeys,
      newEncKey
    );
    assert(restoredKeys && restoredKeys.identityPrivateKey && restoredKeys.signingPrivateKey, 'Test 7: Decrypted restored keys successfully with new password key');

    // Step 8: Verify restored signing key can produce a signature verifiable by the original public key
    const testPayload = 'VerificationPayload_2026';
    const signature = await signData(testPayload, restoredKeys.signingPrivateKey);
    const isSignatureValid = await verifyDataSignature(testPayload, signature, publicSigningKey);
    assert(isSignatureValid === true, 'Test 8: Cryptographic signature verified using restored private key and public key');

    console.log('\n================================================================');
    console.log(`  ALL ${passed} / ${passed + failed} PASSWORD CHANGE TESTS PASSED SUCCESSFULLY (100%)  `);
    console.log('================================================================\n');
  } finally {
    server.close();
  }
}

runPasswordTests().catch((err) => {
  console.error('Password change test failed:', err);
  process.exit(1);
});
