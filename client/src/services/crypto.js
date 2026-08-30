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
      salt = stringToBuffer(`chatra-salt-${username.toLowerCase()}`);
    }
  } else {
    // Fallback for legacy accounts without a random salt
    salt = stringToBuffer(`chatra-salt-${username.toLowerCase()}`);
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

  // Import their public key from JWK format
  const theirPublicKey = await window.crypto.subtle.importKey(
    'jwk',
    theirPublicKeyJwk,
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
 */
export const decryptMessage = async (ciphertext, sharedKey, ivBase64, aadContext = null) => {
  const ciphertextBuffer = base64ToBuffer(ciphertext);
  const ivBuffer = base64ToBuffer(ivBase64);

  if (ciphertextBuffer.byteLength === 0 || ivBuffer.byteLength === 0) {
    throw new Error('Invalid Base64 payload or IV for message decryption.');
  }

  // 1. If AAD context is provided, attempt authenticated AAD decryption first
  if (aadContext) {
    try {
      const aadString = typeof aadContext === 'string' ? aadContext : JSON.stringify(aadContext);
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
      // Fallback for legacy messages that might not have been encrypted with AAD
    }
  }

  // 2. Fallback / Standard decryption without AAD
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

    // Import their public signing key from JWK format
    const theirPublicKey = await window.crypto.subtle.importKey(
      'jwk',
      theirPublicKeyJwk,
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
