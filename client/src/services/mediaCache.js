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

// In-memory instant media cache (URL -> { blob, fullUrl, thumbUrl })
const memoryBlobCache = new Map();

/**
 * Get instant memory media URL if available (0ms synchronous lookup)
 */
export function getMemoryMediaUrl(url, isFullRes = false) {
  if (!url || !memoryBlobCache.has(url)) return null;
  const entry = memoryBlobCache.get(url);
  return isFullRes ? entry.fullUrl : (entry.thumbUrl || entry.fullUrl);
}

/**
 * Set memory media entry
 */
export function setMemoryMedia(url, fullUrl, thumbUrl = null, blob = null, thumbBlob = null) {
  if (!url) return;
  memoryBlobCache.set(url, {
    blob,
    thumbBlob: thumbBlob || blob,
    fullUrl,
    thumbUrl: thumbUrl || fullUrl
  });
}

/**
 * Get a cached media Blob from IndexedDB by file URL
 * @param {string} url 
 * @returns {Promise<Blob|null>}
 */
export async function getCachedMedia(url) {
  if (!url) return null;
  if (memoryBlobCache.has(url) && memoryBlobCache.get(url).blob) {
    return memoryBlobCache.get(url).blob;
  }
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(url);

      request.onsuccess = () => {
        if (request.result && request.result.blob) {
          const blob = request.result.blob;
          const thumbBlob = request.result.thumbBlob || blob;
          const fullUrl = URL.createObjectURL(blob);
          const thumbUrl = (thumbBlob === blob) ? fullUrl : URL.createObjectURL(thumbBlob);
          setMemoryMedia(url, fullUrl, thumbUrl, blob, thumbBlob);
          resolve(blob);
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
 * Save a decrypted media Blob into IndexedDB and memory cache
 * @param {string} url 
 * @param {Blob} blob 
 * @param {string} mimeType 
 * @param {Blob} thumbBlob
 */
export async function setCachedMedia(url, blob, mimeType = '', thumbBlob = null) {
  if (!url || !blob) return;
  
  // Instantly cache in memory with created ObjectURL
  if (!memoryBlobCache.has(url)) {
    const fullUrl = URL.createObjectURL(blob);
    const thumbUrl = thumbBlob ? URL.createObjectURL(thumbBlob) : fullUrl;
    setMemoryMedia(url, fullUrl, thumbUrl, blob, thumbBlob);
  }

  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const item = {
        url,
        blob,
        thumbBlob: thumbBlob || blob,
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
 * Robust MIME type inference helper
 */
export function inferMimeType(filename = '', providedMime = '') {
  if (providedMime && providedMime !== 'application/octet-stream' && providedMime.trim() !== '') {
    return providedMime;
  }
  const ext = filename ? filename.split('.').pop().toLowerCase() : '';
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    heic: 'image/heic',
    heif: 'image/heif',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    pdf: 'application/pdf'
  };
  return map[ext] || providedMime || 'application/octet-stream';
}

/**
 * Load or fetch and decrypt media.
 * Checks Memory first, then IndexedDB. If missing, fetches from server, decrypts, saves to IndexedDB & Memory, and returns Blob.
 * @param {Object} fileMetadata { url, keyJwk, iv, mimeType, name }
 * @returns {Promise<Blob>}
 */
export async function loadOrFetchDecryptedMedia(fileMetadata) {
  const { url, keyJwk, iv, mimeType, name } = fileMetadata;
  if (!url) throw new Error('Invalid file metadata: missing URL');

  // 1. Check in-memory instant cache (0ms)
  if (memoryBlobCache.has(url) && memoryBlobCache.get(url).blob) {
    return memoryBlobCache.get(url).blob;
  }

  // 2. Check local IndexedDB cache
  const cachedBlob = await getCachedMedia(url);
  if (cachedBlob) {
    return cachedBlob;
  }

  // 3. Not cached locally — fetch encrypted buffer from server
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Media file expired on server and was not cached locally');
    }
    throw new Error(`Failed to fetch media (${response.status})`);
  }

  const encryptedBuffer = await response.arrayBuffer();

  // 4. Import AES-GCM decryption key
  const fileSessionKey = await window.crypto.subtle.importKey(
    'jwk',
    keyJwk,
    { name: 'AES-GCM', length: 256 },
    true,
    ['decrypt']
  );

  // 5. Decrypt payload
  const ivBuffer = base64ToBuffer(iv);
  const decryptedBuffer = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    fileSessionKey,
    encryptedBuffer
  );

  // 6. Build decrypted blob and store in memory & IndexedDB for instant future access
  const targetMime = inferMimeType(name, mimeType);
  const blob = new Blob([decryptedBuffer], { type: targetMime });
  const fullUrl = URL.createObjectURL(blob);
  setMemoryMedia(url, fullUrl, fullUrl, blob);

  // Async save into IndexedDB without blocking return
  setCachedMedia(url, blob, targetMime).catch((e) => console.warn('Cache store error:', e));

  return blob;
}

/**
 * Preload and warm up all media attachments for a conversation in background
 */
export async function warmupMediaCache(messages) {
  if (!messages || !messages.length) return;
  const mediaList = messages
    .filter(m => m.mediaType === 'file' && m.fileMetadata?.url && !memoryBlobCache.has(m.fileMetadata.url))
    .map(m => m.fileMetadata);

  if (!mediaList.length) return;
  Promise.all(mediaList.map(file => loadOrFetchDecryptedMedia(file).catch(() => {}))).catch(() => {});
}

/**
 * Clear all cached media (e.g. on logout or user request)
 */
export async function clearMediaCache() {
  memoryBlobCache.clear();
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
