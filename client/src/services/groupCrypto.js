/**
 * E2EE Group Cryptography Service (Sender-Key model).
 *
 * Each group has a random 256-bit symmetric key with a monotonic version number.
 * The key is distributed to every member sealed inside a per-recipient envelope
 * encrypted with the existing pairwise ECDH channel, so the server never sees
 * any group key material. Membership changes rotate the key so late joiners
 * cannot read earlier history and removed members cannot read future messages.
 */

import { bufferToBase64, base64ToBuffer } from './crypto.js';

const stringToBuffer = (str) => new TextEncoder().encode(str || '');
const bufferToString = (buffer) => new TextDecoder().decode(buffer);

export const MAX_GROUP_MEMBERS = 256;

/**
 * Generate fresh raw group key material (32 random bytes).
 */
export const generateGroupKeyMaterial = () => {
  return window.crypto.getRandomValues(new Uint8Array(32));
};

/**
 * Import raw group key bytes into an AES-GCM CryptoKey for encrypt/decrypt.
 */
export const importGroupKey = async (rawKeyBuffer) => {
  return window.crypto.subtle.importKey(
    'raw',
    rawKeyBuffer,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

/**
 * Seal the raw group key for one recipient using the pairwise ECDH shared secret.
 */
export const sealGroupKeyEnvelope = async (rawKeyMaterial, pairwiseSecret) => {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    pairwiseSecret,
    rawKeyMaterial
  );
  return {
    ciphertext: bufferToBase64(ciphertextBuffer),
    iv: bufferToBase64(iv)
  };
};

/**
 * Open a received envelope back into raw key bytes using our pairwise secret
 * with the member who sealed it.
 */
export const openGroupKeyEnvelope = async (envelope, pairwiseSecret) => {
  if (!envelope || !envelope.ciphertext || !envelope.iv) {
    throw new Error('Malformed group key envelope.');
  }
  const ciphertextBuffer = base64ToBuffer(envelope.ciphertext);
  const ivBuffer = base64ToBuffer(envelope.iv);
  if (ciphertextBuffer.byteLength === 0 || ivBuffer.byteLength === 0) {
    throw new Error('Malformed group key envelope payload.');
  }
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    pairwiseSecret,
    ciphertextBuffer
  );
  return new Uint8Array(decrypted);
};

/**
 * Encrypt a JSON-serializable payload with a versioned group key.
 */
export const encryptGroupPayload = async (payloadObject, groupKey) => {
  const plaintextBuffer = stringToBuffer(JSON.stringify(payloadObject));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    groupKey,
    plaintextBuffer
  );
  return {
    ciphertext: bufferToBase64(ciphertextBuffer),
    iv: bufferToBase64(iv)
  };
};

/**
 * Decrypt a group payload with the matching versioned group key.
 */
export const decryptGroupPayload = async (ciphertextBase64, groupKey, ivBase64) => {
  const ciphertextBuffer = base64ToBuffer(ciphertextBase64);
  const ivBuffer = base64ToBuffer(ivBase64);
  if (ciphertextBuffer.byteLength === 0 || ivBuffer.byteLength === 0) {
    throw new Error('Invalid Base64 payload or IV for group decryption.');
  }
  const decryptedBuffer = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    groupKey,
    ciphertextBuffer
  );
  return JSON.parse(bufferToString(decryptedBuffer));
};
