/**
 * E2EE Cryptography Service using native Web Crypto API.
 * Provides client-side key derivation, key generation, encryption, decryption, signing, and verification.
 */

// Helper: Convert ArrayBuffer to Base64 string
export const bufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
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
 * Derive a Master Key and subkeys from a password and username (as salt).
 * @param {string} password 
 * @param {string} username 
 * @returns {Promise<{ loginHash: string, encryptionKey: CryptoKey }>}
 */
export const deriveKeysFromPassword = async (password, username) => {
  const salt = stringToBuffer(`chatra-salt-${username.toLowerCase()}`);
  const passwordBuffer = stringToBuffer(password);

  // Import raw password as key material
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  // Derive master bits using PBKDF2
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
export const decryptRestoredPrivateKeys = async (encryptedBackup, backupKey) => {
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
 * Encrypt data using an AES-GCM shared key.
 */
export const encryptMessage = async (plaintext, sharedKey) => {
  const plaintextBuffer = stringToBuffer(plaintext);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    sharedKey,
    plaintextBuffer
  );

  return {
    ciphertext: bufferToBase64(ciphertextBuffer),
    iv: bufferToBase64(iv)
  };
};

/**
 * Decrypt data using an AES-GCM shared key.
 */
export const decryptMessage = async (ciphertext, sharedKey, ivBase64) => {
  const ciphertextBuffer = base64ToBuffer(ciphertext);
  const ivBuffer = base64ToBuffer(ivBase64);

  if (ciphertextBuffer.byteLength === 0 || ivBuffer.byteLength === 0) {
    throw new Error('Invalid Base64 payload or IV for message decryption.');
  }

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
export const verifyDataSignature = async (dataString, signatureBase64, theirPublicKeyJwk) => {
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

    return await window.crypto.subtle.verify(
      {
        name: 'ECDSA',
        hash: { name: 'SHA-256' }
      },
      theirPublicKey,
      signatureBuffer,
      dataBuffer
    );
  } catch (e) {
    console.error('Signature verification error:', e);
    return false;
  }
};
