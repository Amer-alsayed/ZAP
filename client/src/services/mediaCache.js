/**
 * IndexedDB Media Cache Service for Chatra
 * Caches decrypted media blobs (images, voice notes, videos, attachments) locally
 * on the client device so they remain accessible indefinitely across server restarts & file purges.
 */

const DB_NAME = 'chatra_media_db';
const DB_VERSION = 1;
const STORE_NAME = 'media_blobs';

let dbPromise = null;

/**
 * Initialize / open IndexedDB connection
 */
function getDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        return reject(new Error('IndexedDB not supported in this browser environment'));
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'url' });
        }
      };

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };
    });
  }
  return dbPromise;
}

/**
 * Helper: Convert base64 string to Uint8Array Buffer
 */
function base64ToBuffer(base64) {
  const binaryString = window.atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Get a cached media Blob from IndexedDB by file URL
 * @param {string} url 
 * @returns {Promise<Blob|null>}
 */
export async function getCachedMedia(url) {
  if (!url) return null;
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(url);

      request.onsuccess = () => {
        if (request.result && request.result.blob) {
          resolve(request.result.blob);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => {
        resolve(null);
      };
    });
  } catch (err) {
    console.warn('IndexedDB read warning:', err);
    return null;
  }
}

/**
 * Save a decrypted media Blob into IndexedDB
 * @param {string} url 
 * @param {Blob} blob 
 * @param {string} mimeType 
 */
export async function setCachedMedia(url, blob, mimeType = '') {
  if (!url || !blob) return;
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const item = {
        url,
        blob,
        mimeType: mimeType || blob.type,
        timestamp: Date.now()
      };
      const request = store.put(item);

      request.onsuccess = () => resolve(true);
      request.onerror = (e) => {
        console.warn('IndexedDB write warning:', e.target.error);
        resolve(false);
      };
    });
  } catch (err) {
    console.warn('IndexedDB save exception:', err);
  }
}

/**
 * Load or fetch and decrypt media.
 * Checks IndexedDB first. If missing, fetches from server, decrypts, saves to IndexedDB, and returns Blob.
 * @param {Object} fileMetadata { url, keyJwk, iv, mimeType }
 * @returns {Promise<Blob>}
 */
export async function loadOrFetchDecryptedMedia(fileMetadata) {
  const { url, keyJwk, iv, mimeType } = fileMetadata;
  if (!url) throw new Error('Invalid file metadata: missing URL');

  // 1. Check local IndexedDB cache first
  const cachedBlob = await getCachedMedia(url);
  if (cachedBlob) {
    return cachedBlob;
  }

  // 2. Not cached locally — fetch encrypted buffer from server
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Media file expired on server and was not cached locally');
    }
    throw new Error(`Failed to fetch media (${response.status})`);
  }

  const encryptedBuffer = await response.arrayBuffer();

  // 3. Import AES-GCM decryption key
  const fileSessionKey = await window.crypto.subtle.importKey(
    'jwk',
    keyJwk,
    { name: 'AES-GCM', length: 256 },
    true,
    ['decrypt']
  );

  // 4. Decrypt payload
  const ivBuffer = base64ToBuffer(iv);
  const decryptedBuffer = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    fileSessionKey,
    encryptedBuffer
  );

  // 5. Build decrypted blob and store in IndexedDB for future instant offline access
  const targetMime = mimeType || 'application/octet-stream';
  const blob = new Blob([decryptedBuffer], { type: targetMime });

  // Async save into IndexedDB without blocking return
  setCachedMedia(url, blob, targetMime).catch((e) => console.warn('Cache store error:', e));

  return blob;
}

/**
 * Clear all cached media (e.g. on logout or user request)
 */
export async function clearMediaCache() {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    });
  } catch (err) {
    console.warn('Failed to clear media cache:', err);
  }
}
