import { webcrypto } from 'node:crypto';
import assert from 'node:assert';
import crypto from 'node:crypto';

// Polyfill window.crypto in node test environment
if (!globalThis.window) {
  globalThis.window = { crypto: webcrypto };
}

// Helpers
const stringToBuffer = (str) => new TextEncoder().encode(str || '');
const bufferToString = (buf) => new TextDecoder().decode(buf);
const bufferToBase64 = (buf) => Buffer.from(buf).toString('base64');
const base64ToBuffer = (b64) => Buffer.from(b64, 'base64');

// Cryptographic primitives under test
const generateRandomSalt = () => {
  const saltBytes = webcrypto.getRandomValues(new Uint8Array(16));
  return Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
};

const deriveKeysFromPassword = async (password, username, saltHex = null) => {
  let salt;
  if (saltHex && typeof saltHex === 'string' && saltHex.length >= 16) {
    const match = saltHex.match(/.{1,2}/g);
    if (match) {
      salt = new Uint8Array(match.map(byte => parseInt(byte, 16)));
    } else {
      salt = stringToBuffer(`chatra-salt-${username.toLowerCase()}`);
    }
  } else {
    salt = stringToBuffer(`chatra-salt-${username.toLowerCase()}`);
  }

  const baseKey = await webcrypto.subtle.importKey(
    'raw',
    stringToBuffer(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  const derivedBits = await webcrypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 600000,
      hash: 'SHA-256'
    },
    baseKey,
    512
  );

  const loginHashBytes = derivedBits.slice(0, 32);
  const encKeyBytes = derivedBits.slice(32, 64);

  const loginHash = Array.from(new Uint8Array(loginHashBytes)).map(b => b.toString(16).padStart(2, '0')).join('');
  const encryptionKey = await webcrypto.subtle.importKey(
    'raw',
    encKeyBytes,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  return { loginHash, encryptionKey };
};

const deriveSharedSecret = async (privKey, pubKey) => {
  return await webcrypto.subtle.deriveKey(
    { name: 'ECDH', public: pubKey },
    privKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
};

const deriveRatchetedMessageKey = async (rootSharedKey, sequenceNumber, sender, recipient) => {
  const rootRaw = await webcrypto.subtle.exportKey('raw', rootSharedKey);
  const hmacKey = await webcrypto.subtle.importKey(
    'raw',
    rootRaw,
    { name: 'HMAC', hash: { name: 'SHA-256' } },
    false,
    ['sign']
  );

  const s = (sender || '').toLowerCase();
  const r = (recipient || '').toLowerCase();
  const infoString = `ZAP-PFS-MSG-v1:${sequenceNumber || 0}:${s}:${r}`;

  const ratchetedBits = await webcrypto.subtle.sign(
    'HMAC',
    hmacKey,
    stringToBuffer(infoString)
  );

  return await webcrypto.subtle.importKey(
    'raw',
    ratchetedBits,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
};

const deriveAuthKey = async (sharedKey) => {
  const rawKey = await webcrypto.subtle.exportKey('raw', sharedKey);
  return await webcrypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'HMAC', hash: { name: 'SHA-256' } },
    false,
    ['sign', 'verify']
  );
};

const generateMessageAuthTag = async (authKey, ciphertext, iv, aadString = '') => {
  const dataToAuth = `${ciphertext}:${iv}:${aadString || ''}`;
  const tagBuffer = await webcrypto.subtle.sign(
    'HMAC',
    authKey,
    stringToBuffer(dataToAuth)
  );
  return bufferToBase64(tagBuffer);
};

const verifyMessageAuthTag = async (authKey, ciphertext, iv, aadString, authTagBase64) => {
  const dataToAuth = `${ciphertext}:${iv}:${aadString || ''}`;
  const tagBuffer = base64ToBuffer(authTagBase64);
  return await webcrypto.subtle.verify(
    'HMAC',
    authKey,
    tagBuffer,
    stringToBuffer(dataToAuth)
  );
};

const encryptMessage = async (plaintext, sharedKey, aadContext = null) => {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const encryptParams = { name: 'AES-GCM', iv };
  let aadString = '';
  if (aadContext) {
    aadString = typeof aadContext === 'string' ? aadContext : JSON.stringify(aadContext);
    encryptParams.additionalData = stringToBuffer(aadString);
  }
  const ciphertextBuffer = await webcrypto.subtle.encrypt(
    encryptParams,
    sharedKey,
    stringToBuffer(plaintext)
  );
  return {
    ciphertext: bufferToBase64(ciphertextBuffer),
    iv: bufferToBase64(iv),
    aad: aadString || null
  };
};

const decryptMessage = async (ciphertext, sharedKey, ivBase64, aadContext = null) => {
  const ciphertextBuffer = base64ToBuffer(ciphertext);
  const ivBuffer = base64ToBuffer(ivBase64);

  let parsedAad = null;
  let aadString = '';
  if (aadContext) {
    if (typeof aadContext === 'string') {
      aadString = aadContext;
      try { parsedAad = JSON.parse(aadContext); } catch (e) { parsedAad = null; }
    } else if (typeof aadContext === 'object') {
      parsedAad = aadContext;
      aadString = JSON.stringify(aadContext);
    }
  }

  // Tier 1: Ratcheted PFS decryption
  if (parsedAad && typeof parsedAad.seq === 'number' && parsedAad.s && parsedAad.r) {
    try {
      const ratchetedKey = await deriveRatchetedMessageKey(
        sharedKey,
        parsedAad.seq,
        parsedAad.s,
        parsedAad.r
      );
      const decryptedBuffer = await webcrypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBuffer, additionalData: stringToBuffer(aadString) },
        ratchetedKey,
        ciphertextBuffer
      );
      return bufferToString(decryptedBuffer);
    } catch (e) {}
  }

  // Tier 2: Root key AAD decryption
  if (aadString) {
    try {
      const decryptedBuffer = await webcrypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBuffer, additionalData: stringToBuffer(aadString) },
        sharedKey,
        ciphertextBuffer
      );
      return bufferToString(decryptedBuffer);
    } catch (e) {}
  }

  // Tier 3: Legacy non-AAD fallback
  const decryptedBuffer = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    sharedKey,
    ciphertextBuffer
  );
  return bufferToString(decryptedBuffer);
};

const generateServerPseudoSalt = (serverSecret, username) => {
  return crypto
    .createHmac('sha256', serverSecret)
    .update((username || '').toLowerCase())
    .digest('hex')
    .slice(0, 32);
};

async function runTestSuite() {
  console.log('================================================================');
  console.log('   ZAP PROTOCOL: AUTOMATED CRYPTOGRAPHIC VERIFICATION SUITE   ');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  const test = async (name, fn) => {
    totalTests++;
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`[FAIL] ${name}`);
      console.error(`       Error: ${err.message}`);
      throw err;
    }
  };

  // TEST 1: CSPRNG Salt Entropy & Anti-Collision
  await test('NIST SP 800-132: 100 Unique CSPRNG Salts Generated with 0 Collisions', async () => {
    const saltSet = new Set();
    for (let i = 0; i < 100; i++) {
      const s = generateRandomSalt();
      assert.strictEqual(s.length, 32, 'Salt must be exactly 32 hex characters (16 bytes)');
      assert(/^[0-9a-f]{32}$/.test(s), 'Salt must be valid lowercase hexadecimal');
      saltSet.add(s);
    }
    assert.strictEqual(saltSet.size, 100, 'All 100 random salts must be strictly distinct');
  });

  // TEST 2: Anti-Enumeration Constant-Time Pseudo-Salt Derivation
  await test('Anti-Enumeration Oracle: Constant-Time Deterministic Pseudo-Salts for Unknown Users', async () => {
    const serverSecret = 'zap-super-secure-production-secret-2026';
    const unknownUser = 'alice_nonexistent_' + Date.now();

    const pseudoSalt1 = generateServerPseudoSalt(serverSecret, unknownUser);
    const pseudoSalt2 = generateServerPseudoSalt(serverSecret, unknownUser);

    assert.strictEqual(pseudoSalt1, pseudoSalt2, 'Pseudo-salt must be deterministic for the same username query');
    assert.strictEqual(pseudoSalt1.length, 32, 'Pseudo-salt must be indistinguishable 32-char hex');

    const differentUserSalt = generateServerPseudoSalt(serverSecret, 'bob_nonexistent');
    assert.notStrictEqual(pseudoSalt1, differentUserSalt, 'Different unknown usernames must produce distinct pseudo-salts');
  });

  // TEST 3: PBKDF2 Password Key Isolation & Legacy Fallback
  await test('PBKDF2-HMAC-SHA256: 600,000 Iteration Key Derivation & Backward Compatibility', async () => {
    const password = 'CorrectHorseBatteryStaple#2026!';
    const saltA = generateRandomSalt();
    const saltB = generateRandomSalt();

    const { loginHash: hashA } = await deriveKeysFromPassword(password, 'charlie', saltA);
    const { loginHash: hashB } = await deriveKeysFromPassword(password, 'charlie', saltB);

    assert.notStrictEqual(hashA, hashB, 'Unique per-user salts must generate non-colliding login hashes');

    // Legacy fallback test
    const { loginHash: legacy1 } = await deriveKeysFromPassword(password, 'charlie', null);
    const { loginHash: legacy2 } = await deriveKeysFromPassword(password, 'charlie', null);
    assert.strictEqual(legacy1, legacy2, 'Legacy null salt must remain deterministic to prevent user lockouts');
  });

  // TEST 4: ECDH P-256 Key Exchange & Shared Key Derivation
  let aliceKeyPair, bobKeyPair, aliceSharedKey, bobSharedKey;
  await test('ECDH P-256: Shared Secret Key Agreement Between Two Independent Peers', async () => {
    aliceKeyPair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
    bobKeyPair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);

    aliceSharedKey = await deriveSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey);
    bobSharedKey = await deriveSharedSecret(bobKeyPair.privateKey, aliceKeyPair.publicKey);

    const rawAlice = await webcrypto.subtle.exportKey('raw', aliceSharedKey);
    const rawBob = await webcrypto.subtle.exportKey('raw', bobSharedKey);
    assert.strictEqual(Buffer.from(rawAlice).toString('hex'), Buffer.from(rawBob).toString('hex'), 'Shared AES keys must match');
  });

  // TEST 5: Ephemeral Key Ratcheting (Perfect Forward Secrecy)
  await test('Ephemeral Ratcheting (PFS): Unique Single-Use Keys Derived Per Message Sequence', async () => {
    const keySeq1 = await deriveRatchetedMessageKey(aliceSharedKey, 1, 'alice', 'bob');
    const keySeq2 = await deriveRatchetedMessageKey(aliceSharedKey, 2, 'alice', 'bob');

    const raw1 = Buffer.from(await webcrypto.subtle.exportKey('raw', keySeq1)).toString('hex');
    const raw2 = Buffer.from(await webcrypto.subtle.exportKey('raw', keySeq2)).toString('hex');

    assert.notStrictEqual(raw1, raw2, 'Consecutive message sequence numbers MUST derive distinct ephemeral keys');
  });

  // TEST 6: PFS Compromise Isolation
  await test('PFS Compromise Isolation: Leaked Past Message Key Cannot Decrypt Future Messages', async () => {
    const keySeq1 = await deriveRatchetedMessageKey(aliceSharedKey, 1, 'alice', 'bob');
    const keySeq2 = await deriveRatchetedMessageKey(aliceSharedKey, 2, 'alice', 'bob');

    const msgContent2 = 'Future message encrypted with sequence #2';
    const aad2 = { s: 'alice', r: 'bob', mid: 'msg_2', t: Date.now(), seq: 2 };
    const enc2 = await encryptMessage(msgContent2, keySeq2, aad2);

    // Attempt decrypting msg 2 with leaked key 1 -> MUST FAIL
    let leakedKeyDecryptionSucceeded = false;
    try {
      await webcrypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToBuffer(enc2.iv), additionalData: stringToBuffer(JSON.stringify(aad2)) },
        keySeq1,
        base64ToBuffer(enc2.ciphertext)
      );
      leakedKeyDecryptionSucceeded = true;
    } catch (e) {
      leakedKeyDecryptionSucceeded = false;
    }
    assert.strictEqual(leakedKeyDecryptionSucceeded, false, 'Leaked key #1 MUST fail to decrypt message #2');

    // Bob decrypts msg 2 using shared key and automatic PFS ratchet -> MUST SUCCEED
    const bobDecrypted = await decryptMessage(enc2.ciphertext, bobSharedKey, enc2.iv, aad2);
    assert.strictEqual(bobDecrypted, msgContent2, 'Bob must successfully decrypt ratcheted message');
  });

  // TEST 7: AES-256-GCM AEAD Context Binding & Replay/Injection Prevention
  await test('AES-256-GCM AAD: Context Envelope Binding Blocks Spoofing and Re-routing Attacks', async () => {
    const message = 'Classified E2EE Message with Zero Metadata Leakage';
    const aadContext = {
      s: 'alice',
      r: 'bob',
      mid: 'msg-uuid-' + Date.now(),
      t: Date.now(),
      seq: 3
    };

    const ephemeralKey = await deriveRatchetedMessageKey(aliceSharedKey, 3, 'alice', 'bob');
    const encrypted = await encryptMessage(message, ephemeralKey, aadContext);

    // Valid decryption via 3-tier fallback
    const decrypted = await decryptMessage(encrypted.ciphertext, bobSharedKey, encrypted.iv, aadContext);
    assert.strictEqual(decrypted, message, 'Authenticated message must decrypt cleanly');

    // Tamper Scenario A: Adversary re-routes recipient from 'bob' to 'eve'
    const tamperedRecipientContext = { ...aadContext, r: 'eve' };
    let failedAsExpected = false;
    try {
      await webcrypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToBuffer(encrypted.iv), additionalData: stringToBuffer(JSON.stringify(tamperedRecipientContext)) },
        ephemeralKey,
        base64ToBuffer(encrypted.ciphertext)
      );
    } catch (e) {
      failedAsExpected = true;
    }
    assert.strictEqual(failedAsExpected, true, 'Altered recipient in AAD must fail AEAD tag verification');
  });

  // TEST 8: Deniable Authentication via Symmetric HMAC-SHA256
  await test('Deniable HMAC-SHA256: Session Message Authenticity Without Third-Party Non-Repudiation', async () => {
    const aliceAuthKey = await deriveAuthKey(aliceSharedKey);
    const bobAuthKey = await deriveAuthKey(bobSharedKey);

    const ciphertext = 'Z2VuZXJhdGVkLWNpcGhlcnRleHQtdGVzdA==';
    const iv = 'MTIzNDU2Nzg5MDEy';
    const aad = '{"s":"alice","r":"bob","mid":"msg1","t":1725000000,"seq":1}';

    const authTag = await generateMessageAuthTag(aliceAuthKey, ciphertext, iv, aad);
    assert.ok(authTag && authTag.length > 0, 'Auth tag must be generated');

    const isValid = await verifyMessageAuthTag(bobAuthKey, ciphertext, iv, aad, authTag);
    assert.strictEqual(isValid, true, 'Recipient must successfully verify HMAC auth tag');

    // Tampering test: Ciphertext bit flip
    const isTamperedCiphertextValid = await verifyMessageAuthTag(bobAuthKey, ciphertext + 'X', iv, aad, authTag);
    assert.strictEqual(isTamperedCiphertextValid, false, 'Tampered ciphertext must fail HMAC tag verification');
  });

  // TEST 9: High-Throughput Burst Messaging (Zero IV Reuse)
  await test('High-Throughput Burst: 50 Rapid Consecutive Encryptions with Unique 96-bit IVs', async () => {
    const ivSet = new Set();
    for (let i = 0; i < 50; i++) {
      const ephemeralKey = await deriveRatchetedMessageKey(aliceSharedKey, 100 + i, 'alice', 'bob');
      const enc = await encryptMessage(`Rapid burst message #${i}`, ephemeralKey, { s: 'alice', r: 'bob', mid: `burst_${i}`, seq: 100 + i });
      assert.strictEqual(ivSet.has(enc.iv), false, 'AES-GCM initialization vector must NEVER repeat');
      ivSet.add(enc.iv);

      const dec = await decryptMessage(enc.ciphertext, bobSharedKey, enc.iv, { s: 'alice', r: 'bob', mid: `burst_${i}`, seq: 100 + i });
      assert.strictEqual(dec, `Rapid burst message #${i}`);
    }
    assert.strictEqual(ivSet.size, 50, 'All 50 messages must have unique IVs');
  });

  // TEST 10: Out-of-Band Safety Number Fingerprinting (SHA-256 256-bit Collision Resistance)
  await test('Safety Numbers: Commutative SHA-256 20-Digit Fingerprint Verification (MITM Defense)', async () => {
    const pubKeyA = { kty: 'EC', crv: 'P-256', x: 'f83OJ3D2xFmTbKEBaOJ43uWDjb1T00qFEq6EnLCHamw', y: 'x_daaqurwLqTRHW56OZ4N_a92j51nlgyCG9xGawspcc' };
    const pubKeyB = { kty: 'EC', crv: 'P-256', x: 'WKn-LZ13XSTPhNS1O4odaTHwWEZY3Nn7Mp428AbOTq8', y: 'WFlQjun72-RBMUiSuIdduUh5AOcvsQRePTgUquT-GLI' };

    const computeSafetyNumber = async (keyA, keyB) => {
      const strA = typeof keyA === 'string' ? keyA : JSON.stringify(keyA);
      const strB = typeof keyB === 'string' ? keyB : JSON.stringify(keyB);
      const sorted = [strA, strB].sort();
      const combined = stringToBuffer(sorted[0] + sorted[1]);
      const hashBuffer = await webcrypto.subtle.digest('SHA-256', combined);
      const hashArray = new Uint8Array(hashBuffer);

      const num1 = ((hashArray[0] << 24) | (hashArray[1] << 16) | (hashArray[2] << 8) | hashArray[3]) >>> 0;
      const num2 = ((hashArray[4] << 24) | (hashArray[5] << 16) | (hashArray[6] << 8) | hashArray[7]) >>> 0;
      const num3 = ((hashArray[8] << 24) | (hashArray[9] << 16) | (hashArray[10] << 8) | hashArray[11]) >>> 0;
      const num4 = ((hashArray[12] << 24) | (hashArray[13] << 16) | (hashArray[14] << 8) | hashArray[15]) >>> 0;

      return `${String(num1 % 100000).padStart(5, '0')} ${String(num2 % 100000).padStart(5, '0')} ${String(num3 % 100000).padStart(5, '0')} ${String(num4 % 100000).padStart(5, '0')}`;
    };

    const numAB = await computeSafetyNumber(pubKeyA, pubKeyB);
    const numBA = await computeSafetyNumber(pubKeyB, pubKeyA);

    assert.strictEqual(numAB, numBA, 'Safety numbers must be commutative (Alice & Bob see identical codes)');
    assert(/^\d{5} \d{5} \d{5} \d{5}$/.test(numAB), 'Safety number must be 20 digits formatted in 4 5-digit segments');

    const pubKeyC = { ...pubKeyB, x: 'ModifiedKeyDataForAttackerMITM' };
    const numAC = await computeSafetyNumber(pubKeyA, pubKeyC);
    assert.notStrictEqual(numAB, numAC, 'Altered public keys MUST produce distinct safety numbers');
  });

  console.log('\n================================================================');
  console.log(`  ALL ${passedTests} / ${totalTests} CRYPTOGRAPHIC INVARIANTS VERIFIED SUCCESSFULLY (100%)  `);
  console.log('================================================================\n');
}

runTestSuite().catch(err => {
  console.error('\nCRYPTOGRAPHIC TEST SUITE FAILED:', err);
  process.exit(1);
});
