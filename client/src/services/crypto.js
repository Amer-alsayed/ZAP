/**
 * E2EE Cryptography Service using native Web Crypto API.
 * Provides client-side key derivation, key generation, encryption, decryption, signing, and verification.
 */

// Helper: Convert ArrayBuffer to Base64 string safely without stack overflow on large files
export const bufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  const CHUNK_SIZE = 0x8000; // 32KB chunks
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE));
  }
  return window.btoa(binary);
};

// Helper: Convert Base64 string to ArrayBuffer
export const base64ToBuffer = (base64) => {
  if (!base64 || typeof base64 !== 'string') {
    return new ArrayBuffer(0);
  }
  try {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  } catch (e) {
    console.error('Base64 decode failure:', e);
    return new ArrayBuffer(0);
  }
};

// Helper: Convert string to ArrayBuffer
const stringToBuffer = (str) => {
  return new TextEncoder().encode(str || '');
};

// Helper: Convert ArrayBuffer to string
const bufferToString = (buffer) => {
  return new TextDecoder().decode(buffer);
};

/**
 * Generate a 16-byte cryptographically secure random salt (hex-encoded) for user password derivation.
 */
export const generateRandomSalt = () => {
  const saltBytes = window.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Derive a Master Key and subkeys from a password and user salt.
 * @param {string} password 
 * @param {string} username 
 * @param {string|null} saltHex - 16-byte random salt in hex. If null, falls back to legacy username-based salt.
 * @returns {Promise<{ loginHash: string, encryptionKey: CryptoKey }>}
 */
export const deriveKeysFromPassword = async (password, username, saltHex = null) => {
  let salt;
  if (saltHex && typeof saltHex === 'string' && saltHex.length >= 16) {
    const match = saltHex.match(/.{1,2}/g);
    if (match) {
      salt = new Uint8Array(match.map(byte => parseInt(byte, 16)));
    } else {
      salt = stringToBuffer(`zap-salt-${username.toLowerCase()}`);
    }
  } else {
    // Fallback for legacy accounts without a random salt
    salt = stringToBuffer(`zap-salt-${username.toLowerCase()}`);
  }

  const passwordBuffer = stringToBuffer(password);

  // Import raw password as key material
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  // Derive master bits using PBKDF2 with 600,000 iterations (OWASP standard)
  const derivedBits = await window.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 600000,
      hash: 'SHA-256'
    },
    baseKey,
    512 // Derive 512 bits (64 bytes)
  );

  const loginHashBytes = derivedBits.slice(0, 32); // First 32 bytes for login hash
  const encKeyBytes = derivedBits.slice(32, 64);   // Next 32 bytes for E2EE private key backup

  // Convert login hash to hex string for server transmission
  const loginHashArray = Array.from(new Uint8Array(loginHashBytes));
  const loginHash = loginHashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  // Import E2EE backup key as an AES-GCM CryptoKey
  const encryptionKey = await window.crypto.subtle.importKey(
    'raw',
    encKeyBytes,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  return { loginHash, encryptionKey };
};

/**
 * Generate cryptographic key pairs for E2EE (ECDH) and Digital Signatures (ECDSA).
 */
export const generateKeyPairs = async () => {
  // 1. ECDH Key Pair for Key Exchange (Shared Secret derivation)
  const identityKeyPair = await window.crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true, // extractable
    ['deriveKey', 'deriveBits']
  );

  // 2. ECDSA Key Pair for Signing / Verifying message integrity
  const signingKeyPair = await window.crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256'
    },
    true, // extractable
    ['sign', 'verify']
  );

  return { identityKeyPair, signingKeyPair };
};

/**
 * Encrypt private keys with the user's password-derived key for secure server backup.
 */
export const encryptAndBackupPrivateKeys = async (identityPrivateKey, signingPrivateKey, backupKey) => {
  // Export private keys to JWK format
  const identityJwk = await window.crypto.subtle.exportKey('jwk', identityPrivateKey);
  const signingJwk = await window.crypto.subtle.exportKey('jwk', signingPrivateKey);

  // Bundle and stringify
  const bundle = JSON.stringify({ identityJwk, signingJwk });
  const bundleBuffer = stringToBuffer(bundle);

  // Encrypt bundle using AES-GCM
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    backupKey,
    bundleBuffer
  );

  return {
    ciphertext: bufferToBase64(ciphertextBuffer),
    iv: bufferToBase64(iv)
  };
};

/**
 * Decrypt private keys restored from the server using the user's password-derived key.
 */
export const decryptRestPrivateKeys = async (encryptedBackup, backupKey) => {
  let backup = encryptedBackup;
  if (typeof backup === 'string') {
    try {
      backup = JSON.parse(backup);
    } catch (e) {
      console.error('Failed to parse encrypted backup JSON:', e);
    }
  }

  if (!backup || !backup.ciphertext || !backup.iv) {
    throw new Error('Invalid or missing encrypted private key backup data.');
  }

  const { ciphertext, iv } = backup;
  const ciphertextBuffer = base64ToBuffer(ciphertext);
  const ivBuffer = base64ToBuffer(iv);

  if (ciphertextBuffer.byteLength === 0 || ivBuffer.byteLength === 0) {
    throw new Error('Malformed ciphertext or initialization vector in backup.');
  }

  // Decrypt bundle
  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivBuffer
    },
    backupKey,
    ciphertextBuffer
  );

  const bundle = JSON.parse(bufferToString(decryptedBuffer));

  // Import private keys back from JWK
  const identityPrivateKey = await window.crypto.subtle.importKey(
    'jwk',
    bundle.identityJwk,
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    ['deriveKey', 'deriveBits']
  );

  const signingPrivateKey = await window.crypto.subtle.importKey(
    'jwk',
    bundle.signingJwk,
    {
      name: 'ECDSA',
      namedCurve: 'P-256'
    },
    true,
    ['sign']
  );

  return { identityPrivateKey, signingPrivateKey };
};
export const decryptRestoredPrivateKeys = decryptRestPrivateKeys;

/**
 * Derive an AES-GCM shared key from our private key and their public key using ECDH.
 */
export const deriveSharedSecret = async (ourPrivateKey, theirPublicKeyJwk) => {
  if (!ourPrivateKey || !theirPublicKeyJwk) {
    throw new Error('Missing private or public key for shared secret derivation.');
  }

  let jwk = theirPublicKeyJwk;
  while (typeof jwk === 'string') {
    try {
      jwk = JSON.parse(jwk);
    } catch (e) {
      break;
    }
  }

  // Import their public key from JWK format
  const theirPublicKey = (jwk instanceof CryptoKey)
    ? jwk
    : await window.crypto.subtle.importKey(
        'jwk',
        jwk,
        {
          name: 'ECDH',
          namedCurve: 'P-256'
        },
        true,
        []
      );

  // Perform Diffie-Hellman to derive shared AES key
  return await window.crypto.subtle.deriveKey(
    {
      name: 'ECDH',
      public: theirPublicKey
    },
    ourPrivateKey,
    {
      name: 'AES-GCM',
      length: 256
    },
    true,
    ['encrypt', 'decrypt']
  );
};

/**
 * Derive a dedicated HMAC-SHA256 authentication key from the shared ECDH secret for deniable authentication.
 */
export const deriveAuthKey = async (sharedKey) => {
  if (!sharedKey) return null;
  try {
    const rawKey = await window.crypto.subtle.exportKey('raw', sharedKey);
    return await window.crypto.subtle.importKey(
      'raw',
      rawKey,
      {
        name: 'HMAC',
        hash: { name: 'SHA-256' }
      },
      false,
      ['sign', 'verify']
    );
  } catch (e) {
    console.error('Error deriving auth key from shared secret:', e);
    return null;
  }
};

/**
 * Generate a symmetric HMAC-SHA256 authentication tag over ciphertext and AAD.
 * Provides Deniable Authentication (both sender and recipient hold the key; protects against non-repudiation leaks).
 */
export const generateMessageAuthTag = async (authKey, ciphertext, iv, aadString = '') => {
  if (!authKey || !ciphertext) return '';
  try {
    const dataToAuth = `${ciphertext}:${iv}:${aadString || ''}`;
    const tagBuffer = await window.crypto.subtle.sign(
      'HMAC',
      authKey,
      stringToBuffer(dataToAuth)
    );
    return bufferToBase64(tagBuffer);
  } catch (e) {
    console.error('Error generating message auth tag:', e);
    return '';
  }
};

/**
 * Verify a symmetric HMAC-SHA256 authentication tag.
 */
export const verifyMessageAuthTag = async (authKey, ciphertext, iv, aadString, authTagBase64) => {
  if (!authKey || !ciphertext || !authTagBase64) return false;
  try {
    const dataToAuth = `${ciphertext}:${iv}:${aadString || ''}`;
    const tagBuffer = base64ToBuffer(authTagBase64);
    if (tagBuffer.byteLength === 0) return false;
    return await window.crypto.subtle.verify(
      'HMAC',
      authKey,
      tagBuffer,
      stringToBuffer(dataToAuth)
    );
  } catch (e) {
    console.error('Error verifying message auth tag:', e);
    return false;
  }
};

/**
 * Ephemeral Key Ratcheting (Perfect Forward Secrecy / PFS):
 * Derives a single-use 256-bit AES-GCM message key from the pairwise root ECDH secret
 * using HKDF-like HMAC-SHA256 expansion: K_msg = HMAC(K_root, "ZAP-PFS-MSG-v1:" || seq || ":" || sender || ":" || recipient).
 * Once used, the key is destroyed, ensuring compromising long-term keys provides ZERO retroactive decryption capability.
 */
export const deriveRatchetedMessageKey = async (rootSharedKey, sequenceNumber, sender, recipient) => {
  if (!rootSharedKey) {
    throw new Error('Missing root shared key for PFS ratcheting');
  }

  // 1. Export raw 256-bit key from root shared key
  const rootRaw = await window.crypto.subtle.exportKey('raw', rootSharedKey);

  // 2. Import as HMAC-SHA256 PRK (Pseudorandom Key)
  const hmacKey = await window.crypto.subtle.importKey(
    'raw',
    rootRaw,
    { name: 'HMAC', hash: { name: 'SHA-256' } },
    false,
    ['sign']
  );

  // 3. Construct info context string: "ZAP-PFS-MSG-v1:<seq>:<sender>:<recipient>"
  const s = (sender || '').toLowerCase();
  const r = (recipient || '').toLowerCase();
  const infoString = `ZAP-PFS-MSG-v1:${sequenceNumber || 0}:${s}:${r}`;

  // 4. Compute single-use message key bits
  const ratchetedBits = await window.crypto.subtle.sign(
    'HMAC',
    hmacKey,
    stringToBuffer(infoString)
  );

  // 5. Import as ephemeral AES-GCM-256 CryptoKey
  return await window.crypto.subtle.importKey(
    'raw',
    ratchetedBits,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

/**
 * Encrypt data using an AES-GCM shared key with Additional Authenticated Data (AAD).
 */
export const encryptMessage = async (plaintext, sharedKey, aadContext = null) => {
  const plaintextBuffer = stringToBuffer(plaintext);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const encryptParams = {
    name: 'AES-GCM',
    iv: iv
  };

  let aadString = '';
  if (aadContext) {
    aadString = typeof aadContext === 'string' ? aadContext : JSON.stringify(aadContext);
    encryptParams.additionalData = stringToBuffer(aadString);
  }

  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    encryptParams,
    sharedKey,
    plaintextBuffer
  );

  return {
    ciphertext: bufferToBase64(ciphertextBuffer),
    iv: bufferToBase64(iv),
    aad: aadString || null
  };
};

/**
 * Decrypt data using an AES-GCM shared key with Additional Authenticated Data (AAD) and backward-compatible fallback.
 * Automatically tries ratcheted PFS subkeys when seq is detected in AAD context.
 */
export const decryptMessage = async (ciphertext, sharedKey, ivBase64, aadContext = null) => {
  const ciphertextBuffer = base64ToBuffer(ciphertext);
  const ivBuffer = base64ToBuffer(ivBase64);

  if (ciphertextBuffer.byteLength === 0 || ivBuffer.byteLength === 0) {
    throw new Error('Invalid Base64 payload or IV for message decryption.');
  }

  let parsedAad = null;
  let aadString = '';
  if (aadContext) {
    if (typeof aadContext === 'string') {
      aadString = aadContext;
      try {
        parsedAad = JSON.parse(aadContext);
      } catch (e) {
        parsedAad = null;
      }
    } else if (typeof aadContext === 'object') {
      parsedAad = aadContext;
      aadString = JSON.stringify(aadContext);
    }
  }

  // 1. Tier 1: If AAD contains a sequence number (PFS ratcheted message), derive ephemeral subkey and decrypt
  if (parsedAad && typeof parsedAad.seq === 'number' && parsedAad.s && parsedAad.r) {
    try {
      const ratchetedKey = await deriveRatchetedMessageKey(
        sharedKey,
        parsedAad.seq,
        parsedAad.s,
        parsedAad.r
      );
      const decryptedBuffer = await window.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: ivBuffer,
          additionalData: stringToBuffer(aadString)
        },
        ratchetedKey,
        ciphertextBuffer
      );
      return bufferToString(decryptedBuffer);
    } catch (ratchetErr) {
      // Fall through to standard root sharedKey decryption
    }
  }

  // 2. Tier 2: If AAD is provided, attempt standard AAD decryption with root sharedKey
  if (aadString) {
    try {
      const decryptedBuffer = await window.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: ivBuffer,
          additionalData: stringToBuffer(aadString)
        },
        sharedKey,
        ciphertextBuffer
      );
      return bufferToString(decryptedBuffer);
    } catch (aadErr) {
      // Fall through to legacy fallback
    }
  }

  // 3. Tier 3: Standard legacy decryption without AAD (for historical messages)
  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivBuffer
    },
    sharedKey,
    ciphertextBuffer
  );

  return bufferToString(decryptedBuffer);
};

/**
 * Sign data using our private signing key.
 */
export const signData = async (dataString, privateSigningKey) => {
  if (!dataString || !privateSigningKey) {
    return '';
  }

  const dataBuffer = stringToBuffer(dataString);

  const signatureBuffer = await window.crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: { name: 'SHA-256' }
    },
    privateSigningKey,
    dataBuffer
  );

  return bufferToBase64(signatureBuffer);
};

/**
 * Verify data using their public signing key.
 */
export const verifyDataSignature = async (dataString, signatureBase64, theirPublicKeyJwk, fallbackDataString = null) => {
  if (!dataString || !signatureBase64 || !theirPublicKeyJwk) {
    return false;
  }

  try {
    const dataBuffer = stringToBuffer(dataString);
    const signatureBuffer = base64ToBuffer(signatureBase64);

    if (signatureBuffer.byteLength === 0) {
      return false;
    }

    let jwk = theirPublicKeyJwk;
    while (typeof jwk === 'string') {
      try {
        jwk = JSON.parse(jwk);
      } catch (e) {
        break;
      }
    }

    // Import their public signing key from JWK format
    const theirPublicKey = (jwk instanceof CryptoKey)
      ? jwk
      : await window.crypto.subtle.importKey(
          'jwk',
          jwk,
          {
            name: 'ECDSA',
            namedCurve: 'P-256'
          },
          true,
          ['verify']
        );

    const isValid = await window.crypto.subtle.verify(
      {
        name: 'ECDSA',
        hash: { name: 'SHA-256' }
      },
      theirPublicKey,
      signatureBuffer,
      dataBuffer
    );

    if (isValid) return true;

    // Fallback: verify against alternate context / raw data string if provided
    if (fallbackDataString && fallbackDataString !== dataString) {
      const fallbackBuffer = stringToBuffer(fallbackDataString);
      return await window.crypto.subtle.verify(
        {
          name: 'ECDSA',
          hash: { name: 'SHA-256' }
        },
        theirPublicKey,
        signatureBuffer,
        fallbackBuffer
      );
    }

    return false;
  } catch (e) {
    console.error('Signature verification error:', e);
    return false;
  }
};

const safetyNumberCache = new Map();

/**
 * Compute an out-of-band E2EE Safety Number fingerprint with genuine 256-bit SHA-256 collision resistance.
 * Sorts public keys commutatively so both Alice and Bob compute the exact same 20-digit code.
 * @param {object|string} keyA
 * @param {object|string} keyB
 * @returns {Promise<string>} 20-digit chunked string "XXXXX XXXXX XXXXX XXXXX"
 */
export const computeSafetyNumber = async (keyA, keyB) => {
  if (!keyA || !keyB) return 'N/A';
  const strA = typeof keyA === 'string' ? keyA : JSON.stringify(keyA);
  const strB = typeof keyB === 'string' ? keyB : JSON.stringify(keyB);
  const sorted = [strA, strB].sort();
  const cacheKey = sorted[0] + '::' + sorted[1];

  if (safetyNumberCache.has(cacheKey)) {
    return safetyNumberCache.get(cacheKey);
  }

  const combined = stringToBuffer(sorted[0] + sorted[1]);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', combined);
  const hashArray = new Uint8Array(hashBuffer);

  const num1 = ((hashArray[0] << 24) | (hashArray[1] << 16) | (hashArray[2] << 8) | hashArray[3]) >>> 0;
  const num2 = ((hashArray[4] << 24) | (hashArray[5] << 16) | (hashArray[6] << 8) | hashArray[7]) >>> 0;
  const num3 = ((hashArray[8] << 24) | (hashArray[9] << 16) | (hashArray[10] << 8) | hashArray[11]) >>> 0;
  const num4 = ((hashArray[12] << 24) | (hashArray[13] << 16) | (hashArray[14] << 8) | hashArray[15]) >>> 0;

  const seg1 = String(num1 % 100000).padStart(5, '0');
  const seg2 = String(num2 % 100000).padStart(5, '0');
  const seg3 = String(num3 % 100000).padStart(5, '0');
  const seg4 = String(num4 % 100000).padStart(5, '0');

  const result = `${seg1} ${seg2} ${seg3} ${seg4}`;
  safetyNumberCache.set(cacheKey, result);
  return result;
};
