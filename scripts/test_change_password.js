import { webcrypto } from 'node:crypto';
if (!globalThis.window) {
  globalThis.window = {
    crypto: webcrypto,
    btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary')
  };
}

import http from 'http';
import jwt from '../server/node_modules/jsonwebtoken/index.js';
import express from '../server/node_modules/express/index.js';
import config from '../server/src/config.js';
import { initDb } from '../server/src/db.js';
import { register, login, getAuthSalt, changePassword, refresh, logout, upgradeLegacySession } from '../server/src/authController.js';
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
  app.post('/api/auth/refresh', refresh);
  app.post('/api/auth/logout', logout);
  app.post('/api/auth/session', upgradeLegacySession);
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
    assert(regRes.status === 201 && regData.token && regData.refreshToken, 'Test 1: User registered with initial credentials and persistent refresh token');
    const userToken = regData.token;
    const primaryRefreshToken = regData.refreshToken;

    // Step 1b: Log in from a second device to verify multi-device session isolation on password change
    const secondLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: testUsername, loginHash: originalLoginHash })
    });
    const secondLoginData = await secondLoginRes.json();
    assert(secondLoginRes.status === 200 && secondLoginData.refreshToken, 'Test 1b: Second device logged in and received independent refresh session');
    const secondaryRefreshToken = secondLoginData.refreshToken;

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

    // Step 9: Verify password change preserved the primary device session while revoking the second device
    const primaryRefreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: primaryRefreshToken })
    });
    const primaryRefreshData = await primaryRefreshRes.json();
    assert(primaryRefreshRes.status === 200 && primaryRefreshData.token && primaryRefreshData.refreshToken, 'Test 9a: Primary device session remains active after changing password');

    const secondaryRefreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: secondaryRefreshToken })
    });
    assert(secondaryRefreshRes.status === 401, 'Test 9b: Other device sessions are automatically revoked on password change');

    // Step 10: Verify rotate-on-confirm resilience (lost response retry, confirmation promotion, and reuse detection)
    const retryLostResponseRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: primaryRefreshToken })
    });
    const retryLostResponseData = await retryLostResponseRes.json();
    assert(retryLostResponseRes.status === 200 && retryLostResponseData.refreshToken, 'Test 10a: Retrying unconfirmed current refresh token succeeds (dropped response resilience)');

    const confirmRotatedRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: retryLostResponseData.refreshToken })
    });
    const confirmRotatedData = await confirmRotatedRes.json();
    assert(confirmRotatedRes.status === 200 && confirmRotatedData.refreshToken, 'Test 10b: Presenting pending refresh token promotes it and issues next token');

    const replaySupersededRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: primaryRefreshToken })
    });
    assert(replaySupersededRes.status === 401, 'Test 10c: Replaying a superseded refresh token triggers reuse detection');

    const afterReuseRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: confirmRotatedData.refreshToken })
    });
    assert(afterReuseRes.status === 401, 'Test 10d: Compromised session is revoked after refresh token reuse');

    // Step 11: Verify legacy JWT (without sid, even after its 7d exp elapsed) upgrades cleanly into a persistent session, and explicit logout revokes it
    const decodedNew = jwt.decode(newLoginData.token);
    const legacyJwt = jwt.sign({ id: decodedNew.id, username: testUsername }, config.jwtSecret, { algorithm: 'HS256', expiresIn: '-1s' });
    const upgradeRes = await fetch(`${baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${legacyJwt}` }
    });
    const upgradeData = await upgradeRes.json();
    assert(upgradeRes.status === 200 && upgradeData.token && upgradeData.refreshToken, 'Test 11a: Legacy 7-day JWT (even expired) upgrades seamlessly to persistent refresh session');

    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: upgradeData.refreshToken })
    });
    assert(logoutRes.status === 204, 'Test 11b: Explicit logout endpoint returns 204 No Content');

    const refreshAfterLogoutRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: upgradeData.refreshToken })
    });
    assert(refreshAfterLogoutRes.status === 401, 'Test 11c: Refresh token is rejected after explicit logout');

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
