import React, { useState, useEffect } from 'react';
import { inferMimeType, loadOrFetchDecryptedMedia, setCachedMedia, getMemoryMediaUrl } from '../services/mediaCache';
import { bufferToBase64 } from '../services/crypto';

// ==========================================
// Group Chat Sender Attribution Helpers
// ==========================================

export const GROUP_SENDER_COLORS = [
  '#64b5f6', '#81c784', '#ffb74d', '#ba68c8',
  '#4dd0e1', '#f06292', '#aed581', '#ff8a65'
];

export const getMemberColor = (username = '') => {
  let h = 0;
  for (let i = 0; i < username.length; i++) {
    h = ((h * 31) + username.charCodeAt(i)) >>> 0;
  }
  return GROUP_SENDER_COLORS[h % GROUP_SENDER_COLORS.length];
};

// ==========================================
// Date & Time Formatting Helpers
// ==========================================

export const formatMessageTime = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const shouldShowDateSeparator = (messages, index) => {
  if (index === 0) return true;
  const prevDate = new Date(messages[index - 1].timestamp);
  const currDate = new Date(messages[index].timestamp);
  return prevDate.toDateString() !== currDate.toDateString();
};

export const formatSeparatorDate = (timestamp) => {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  } else {
    return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
};

// Cached grapheme segmenter
let _cachedSegmenter = null;
export function getGraphemeSegmenter() {
  if (_cachedSegmenter) return _cachedSegmenter;
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try { _cachedSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' }); } catch {}
  }
  return _cachedSegmenter;
}

export const EMOJI_REGEX_CACHED = /^(\p{Extended_Pictographic}|\p{Emoji}|\u200D|\uFE0E|\uFE0F|\p{Emoji_Component}|\p{Emoji_Modifier}|\p{Emoji_Modifier_Base}|\p{Emoji_Presentation})+$/u;

export const isOnlyEmoji = (text) => {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (/[a-zA-Z]/.test(trimmed)) {
    return false;
  }
  if (/[0-9]/.test(trimmed) && !/^[0-9]\uFE0F?\u20E3$/.test(trimmed)) {
    return false;
  }

  const segmenter = getGraphemeSegmenter();
  const segments = segmenter 
    ? Array.from(segmenter.segment(trimmed)).map(s => s.segment.trim()).filter(Boolean) 
    : Array.from(trimmed).filter(c => c.trim().length > 0);
  
  if (segments.length === 0 || segments.length > 3) return false;
  
  return segments.every(s => EMOJI_REGEX_CACHED.test(s));
};

export const getEmojiCount = (text) => {
  if (!text || typeof text !== 'string') return 0;
  const trimmed = text.trim();
  const segmenter = getGraphemeSegmenter();
  const segments = segmenter 
    ? Array.from(segmenter.segment(trimmed)).map(s => s.segment.trim()).filter(Boolean) 
    : Array.from(trimmed).filter(c => c.trim().length > 0);
  return segments.length;
};

// Audio Progress Event Bus to isolate audio scrubber updates
export class AudioProgressManager {
  constructor() {
    this.listeners = new Map();
    this.currentProgress = new Map();
  }
  subscribe(msgId, callback) {
    if (!this.listeners.has(msgId)) {
      this.listeners.set(msgId, new Set());
    }
    this.listeners.get(msgId).add(callback);
    if (this.currentProgress.has(msgId)) {
      const { progress, currentTime } = this.currentProgress.get(msgId);
      callback(progress, currentTime);
    }
    return () => {
      const set = this.listeners.get(msgId);
      if (set) {
        set.delete(callback);
        if (set.size === 0) this.listeners.delete(msgId);
      }
    };
  }
  emit(msgId, progress, currentTime) {
    this.currentProgress.set(msgId, { progress, currentTime });
    const set = this.listeners.get(msgId);
    if (set) {
      set.forEach(cb => cb(progress, currentTime));
    }
  }
  getProgress(msgId) {
    return this.currentProgress.get(msgId)?.progress || 0;
  }
  clear(msgId) {
    this.currentProgress.delete(msgId);
    const set = this.listeners.get(msgId);
    if (set) {
      set.forEach(cb => cb(0, 0));
    }
  }
}

export const audioProgressManager = new AudioProgressManager();

// Lazy in-view hook — defers heavy media decryption until element nears viewport
export function useLazyInView(ref, rootMargin = '700px') {
  const [isInView, setIsInView] = useState(false);
  useEffect(() => {
    if (isInView) return;
    if (typeof window === 'undefined' || typeof window.IntersectionObserver === 'undefined') {
      setIsInView(true);
      return;
    }
    let observer = null;
    let fallbackTimer = null;
    let rafId = null;

    const setupObserver = () => {
      const el = ref.current;
      if (!el) {
        if (!fallbackTimer) {
          fallbackTimer = setTimeout(() => setIsInView(true), 900);
        }
        rafId = requestAnimationFrame(setupObserver);
        return;
      }
      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setIsInView(true);
            if (observer) observer.disconnect();
            if (fallbackTimer) clearTimeout(fallbackTimer);
          }
        },
        { root: null, rootMargin, threshold: 0.01 }
      );
      observer.observe(el);
      fallbackTimer = setTimeout(() => {
        setIsInView(true);
      }, 1200);
    };

    setupObserver();

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (observer) observer.disconnect();
    };
  }, [ref, isInView, rootMargin]);
  return isInView;
}

export const renderFormattedText = (text) => {
  if (!text || typeof text !== 'string') return text;

  const FORMAT_REGEX = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s]|www\.[^\s<]+[^<.,:;"')\]\s])|(`[^`\n]+`)|(\|\|[^|\n]+\|\|)|(\*\*[^*]+?\*\*|\*[^*\n]+?\*)|(_[^_\n]+?_)|(~[^~\n]+?~)/gi;

  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = FORMAT_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }

    const fullMatch = match[0];
    const key = `fmt-${match.index}-${lastIndex}`;

    if (match[1]) {
      // URL Link
      const rawUrl = match[1];
      const href = rawUrl.startsWith('http://') || rawUrl.startsWith('https://') 
        ? rawUrl 
        : `https://${rawUrl}`;

      parts.push(
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="chat-text-link"
          onClick={(e) => {
            if (window.__isZapSelectionMode || window.__isChatraSelectionMode) {
              e.preventDefault();
            } else {
              e.stopPropagation();
            }
          }}
        >
          {rawUrl}
        </a>
      );
    } else if (match[2]) {
      // Inline Code: `code`
      const codeContent = fullMatch.slice(1, -1);
      parts.push(<code key={key} className="chat-inline-code">{codeContent}</code>);
    } else if (match[3]) {
      // Spoiler: ||spoiler||
      const spoilerContent = fullMatch.slice(2, -2);
      parts.push(
        <span
          key={key}
          className="spoiler-text chat-spoiler-text"
          onClick={(e) => {
            e.stopPropagation();
            e.currentTarget.classList.toggle('revealed');
          }}
          title="Click to reveal spoiler"
        >
          {spoilerContent}
        </span>
      );
    } else if (match[4]) {
      // Bold: *bold* or **bold**
      const boldContent = fullMatch.startsWith('**') ? fullMatch.slice(2, -2) : fullMatch.slice(1, -1);
      parts.push(<strong key={key}>{boldContent}</strong>);
    } else if (match[5]) {
      // Italic: _italic_
      const italicContent = fullMatch.slice(1, -1);
      parts.push(<em key={key}>{italicContent}</em>);
    } else if (match[6]) {
      // Strikethrough: ~strike~
      const strikeContent = fullMatch.slice(1, -1);
      parts.push(<del key={key}>{strikeContent}</del>);
    }

    lastIndex = FORMAT_REGEX.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
};

// Group consecutive media into albums & cards
export const groupMessagesWithAlbums = (rawMessages) => {
  if (!rawMessages || !rawMessages.length) return [];
  
  const result = [];
  let currentAlbum = [];
  let currentFileGroup = [];
  let currentCallGroup = [];

  const flushAlbum = () => {
    if (!currentAlbum.length) return;
    if (currentAlbum.length === 1) {
      result.push(currentAlbum[0]);
    } else {
      const first = currentAlbum[0];
      const last = currentAlbum[currentAlbum.length - 1];
      const allIds = currentAlbum.map(m => m.id);
      const captionMsg = currentAlbum.find(m => m.text && m.text.trim());
      
      result.push({
        ...first,
        id: `album-${allIds.join('-')}`,
        isAlbum: true,
        albumItems: [...currentAlbum],
        allIds,
        timestamp: last.timestamp,
        status: Math.min(...currentAlbum.map(m => m.status ?? 0)),
        text: captionMsg ? captionMsg.text : null,
        isNew: currentAlbum.some(m => m.isNew),
        isDeleting: currentAlbum.some(m => m.isDeleting)
      });
    }
    currentAlbum = [];
  };

  const flushFileGroup = () => {
    if (!currentFileGroup.length) return;
    if (currentFileGroup.length === 1) {
      result.push(currentFileGroup[0]);
    } else {
      const first = currentFileGroup[0];
      const last = currentFileGroup[currentFileGroup.length - 1];
      const allIds = currentFileGroup.map(m => m.id);
      const captionMsg = currentFileGroup.find(m => m.text && m.text.trim());

      result.push({
        ...first,
        id: `files-${allIds.join('-')}`,
        isMultiFile: true,
        fileItems: [...currentFileGroup],
        allIds,
        timestamp: last.timestamp,
        status: Math.min(...currentFileGroup.map(m => m.status ?? 0)),
        text: captionMsg ? captionMsg.text : null,
        isNew: currentFileGroup.some(m => m.isNew),
        isDeleting: currentFileGroup.some(m => m.isDeleting)
      });
    }
    currentFileGroup = [];
  };

  const flushCallGroup = () => {
    if (!currentCallGroup.length) return;
    if (currentCallGroup.length === 1) {
      result.push(currentCallGroup[0]);
    } else {
      const last = currentCallGroup[currentCallGroup.length - 1];
      const allIds = currentCallGroup.map(m => m.id);
      result.push({
        ...last,
        id: `call-group-${allIds.join('-')}`,
        callCount: currentCallGroup.length,
        allIds
      });
    }
    currentCallGroup = [];
  };

  for (let i = 0; i < rawMessages.length; i++) {
    const msg = rawMessages[i];
    const isImageOrVideo = msg.mediaType === 'file' && msg.fileMetadata && (
      msg.fileMetadata.mimeType?.startsWith('image/') ||
      msg.fileMetadata.mimeType?.startsWith('video/')
    );
    const isDocFile = msg.mediaType === 'file' && msg.fileMetadata && !isImageOrVideo;
    const isCall = msg.mediaType === 'call';

    if (isImageOrVideo) {
      flushFileGroup();
      flushCallGroup();
      if (currentAlbum.length === 0) {
        currentAlbum.push(msg);
      } else {
        const prev = currentAlbum[currentAlbum.length - 1];
        const sameSender = prev.sender === msg.sender;
        const timeDiff = Math.abs(new Date(msg.timestamp) - new Date(prev.timestamp));
        const withinTime = isNaN(timeDiff) || timeDiff < 120000;
        const noSeparateReply = !msg.replyTo || (prev.replyTo && msg.replyTo.id === prev.replyTo.id);

        if (sameSender && withinTime && noSeparateReply) {
          currentAlbum.push(msg);
        } else {
          flushAlbum();
          currentAlbum.push(msg);
        }
      }
    } else if (isDocFile) {
      flushAlbum();
      flushCallGroup();
      if (currentFileGroup.length === 0) {
        currentFileGroup.push(msg);
      } else {
        const prev = currentFileGroup[currentFileGroup.length - 1];
        const sameSender = prev.sender === msg.sender;
        const timeDiff = Math.abs(new Date(msg.timestamp) - new Date(prev.timestamp));
        const withinTime = isNaN(timeDiff) || timeDiff < 120000;
        const noSeparateReply = !msg.replyTo || (prev.replyTo && msg.replyTo.id === prev.replyTo.id);

        if (sameSender && withinTime && noSeparateReply) {
          currentFileGroup.push(msg);
        } else {
          flushFileGroup();
          currentFileGroup.push(msg);
        }
      }
    } else if (isCall) {
      flushAlbum();
      flushFileGroup();
      if (currentCallGroup.length === 0) {
        currentCallGroup.push(msg);
      } else {
        const prev = currentCallGroup[currentCallGroup.length - 1];
        const sameSender = prev.sender?.toLowerCase() === msg.sender?.toLowerCase();
        
        let sameStatus = false;
        try {
          const p = typeof prev.text === 'string' ? JSON.parse(prev.text) : prev.text;
          const c = typeof msg.text === 'string' ? JSON.parse(msg.text) : msg.text;
          sameStatus = (p.status === c.status) || (['cancelled', 'declined', 'missed'].includes(p.status) && ['cancelled', 'declined', 'missed'].includes(c.status));
        } catch (e) {
          sameStatus = prev.text === msg.text;
        }

        const timeDiff = Math.abs(new Date(msg.timestamp) - new Date(prev.timestamp));
        const withinTime = isNaN(timeDiff) || timeDiff < 180000;

        if (sameSender && sameStatus && withinTime) {
          currentCallGroup.push(msg);
        } else {
          flushCallGroup();
          currentCallGroup.push(msg);
        }
      }
    } else {
      flushAlbum();
      flushFileGroup();
      flushCallGroup();
      result.push(msg);
    }
  }

  flushAlbum();
  flushFileGroup();
  flushCallGroup();
  return result;
};

// Resilient buffer reader for cross-platform and scoped Android storage
export const readBlobBufferSafely = async (blob) => {
  if (!blob) return null;
  if (blob._preloadedBuffer && blob._preloadedBuffer.byteLength > 0) {
    return blob._preloadedBuffer;
  }

  // Tier 1: Direct blob.arrayBuffer()
  if (typeof blob.arrayBuffer === 'function') {
    try {
      const buf = await blob.arrayBuffer();
      if (buf && buf.byteLength > 0) return buf;
    } catch (e) {}
  }

  // Tier 2: Stream reading (resilient against Android Scoped Storage fragmentation & large files)
  if (typeof blob.stream === 'function') {
    try {
      const reader = blob.stream().getReader();
      const chunks = [];
      let totalLength = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          chunks.push(value);
          totalLength += value.byteLength;
        }
      }
      if (totalLength > 0) {
        const fullBuf = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          fullBuf.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return fullBuf.buffer;
      }
    } catch (e) {}
  }

  // Tier 3: blob.slice().arrayBuffer()
  try {
    const sliced = blob.slice(0, blob.size, blob.type);
    if (typeof sliced.arrayBuffer === 'function') {
      const buf = await sliced.arrayBuffer();
      if (buf && buf.byteLength > 0) return buf;
    }
  } catch (e) {}

  // Tier 4: Response(blob).arrayBuffer()
  try {
    const res = new Response(blob);
    const buf = await res.arrayBuffer();
    if (buf && buf.byteLength > 0) return buf;
  } catch (e) {}

  // Tier 5: FileReader.readAsArrayBuffer
  const frBuf = await new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result && reader.result.byteLength > 0) {
          resolve(reader.result);
        } else {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsArrayBuffer(blob);
    } catch (e) {
      resolve(null);
    }
  });
  if (frBuf && frBuf.byteLength > 0) return frBuf;

  // Tier 6: FileReader.readAsDataURL (Resilient on Android WebViews)
  const dataUrlBuf = await new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const res = String(reader.result || '');
          const commaIdx = res.indexOf(',');
          if (commaIdx !== -1) {
            const b64 = res.substring(commaIdx + 1);
            const binary = atob(b64);
            const len = binary.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            resolve(bytes.buffer);
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    } catch (e) {
      resolve(null);
    }
  });
  if (dataUrlBuf && dataUrlBuf.byteLength > 0) return dataUrlBuf;

  // Tier 7: Native window.createImageBitmap (hardware-accelerated, clamps dimensions safely)
  const mime = inferMimeType(blob.name || '', blob.type || '');
  if (mime.startsWith('image/') && typeof window !== 'undefined' && typeof window.createImageBitmap === 'function') {
    try {
      const bitmap = await window.createImageBitmap(blob);
      let { width: w, height: h } = bitmap;
      const maxDim = 2560;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
        else { w = Math.round((w * maxDim) / h); h = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close();
        const b = await new Promise(res => canvas.toBlob(res, mime === 'image/png' ? 'image/png' : 'image/jpeg', 0.90));
        if (b) {
          const ab = await b.arrayBuffer();
          if (ab && ab.byteLength > 0) return ab;
        }
      } else {
        bitmap.close();
      }
    } catch (e) {}
  }

  // Tier 8: Image Canvas Re-encode for photos on Android (clamped to max 2560 to prevent canvas OOM)
  if (mime.startsWith('image/')) {
    const canvasBuf = await new Promise((resolve) => {
      let objUrl = null;
      try {
        objUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          try {
            const maxDim = 2560;
            let w = img.naturalWidth || img.width;
            let h = img.naturalHeight || img.height;
            if (w > maxDim || h > maxDim) {
              if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
              else { w = Math.round((w * maxDim) / h); h = maxDim; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              if (objUrl) URL.revokeObjectURL(objUrl);
              return resolve(null);
            }
            ctx.drawImage(img, 0, 0, w, h);
            if (objUrl) URL.revokeObjectURL(objUrl);
            objUrl = null;
            canvas.toBlob(async (b) => {
              if (b) {
                try {
                  const ab = await b.arrayBuffer();
                  resolve(ab);
                } catch (e) {
                  resolve(null);
                }
              } else {
                resolve(null);
              }
            }, mime === 'image/png' ? 'image/png' : 'image/jpeg', 0.90);
          } catch (e) {
            if (objUrl) URL.revokeObjectURL(objUrl);
            resolve(null);
          }
        };
        img.onerror = () => {
          if (objUrl) URL.revokeObjectURL(objUrl);
          resolve(null);
        };
        img.src = objUrl;
      } catch (e) {
        if (objUrl) URL.revokeObjectURL(objUrl);
        resolve(null);
      }
    });
    if (canvasBuf && canvasBuf.byteLength > 0) return canvasBuf;
  }

  return null;
};

// Image optimization for transmission
export const optimizeImageForSending = async (fileOrBlob, preloadedBuffer = null) => {
  if (!fileOrBlob) return fileOrBlob;
  const inferredMime = inferMimeType(fileOrBlob.name || '', fileOrBlob.type || '');
  if (!inferredMime.startsWith('image/') || inferredMime === 'image/gif') {
    return fileOrBlob;
  }

  return new Promise((resolve) => {
    let objectUrl = null;
    try {
      const sourceBlob = (preloadedBuffer && preloadedBuffer.byteLength > 0)
        ? new Blob([preloadedBuffer], { type: inferredMime })
        : fileOrBlob;
      objectUrl = URL.createObjectURL(sourceBlob);
      const img = new window.Image();

      img.onload = () => {
        try {
          const maxDim = 2560;
          let { naturalWidth: width, naturalHeight: height } = img;

          if (!width || !height) {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            return resolve(fileOrBlob);
          }

          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            return resolve(fileOrBlob);
          }

          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              if (objectUrl) URL.revokeObjectURL(objectUrl);
              if (blob && blob.size > 0 && (blob.size < fileOrBlob.size || fileOrBlob.size > 2 * 1024 * 1024)) {
                const cleanName = (fileOrBlob.name || 'photo.jpg').replace(/\.[^/.]+$/, '') + '.jpg';
                const optimizedFile = new File([blob], cleanName, {
                  type: 'image/jpeg',
                  lastModified: Date.now()
                });
                resolve(optimizedFile);
              } else {
                resolve(fileOrBlob);
              }
            },
            'image/jpeg',
            0.88
          );
        } catch (err) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          resolve(fileOrBlob);
        }
      };

      img.onerror = () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        resolve(fileOrBlob);
      };

      img.src = objectUrl;
    } catch (e) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      resolve(fileOrBlob);
    }
  });
};

// Prepare file for sending: pre-reads, normalizes, and pre-encrypts
export const prepareFileForSending = async (rawFile) => {
  let rawBuffer = rawFile._preloadedBuffer || null;
  if (!rawBuffer || rawBuffer.byteLength === 0) {
    for (let attempt = 0; attempt < 4 && (!rawBuffer || rawBuffer.byteLength === 0); attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 150 * attempt));
      rawBuffer = await readBlobBufferSafely(rawFile);
      if (!rawBuffer || rawBuffer.byteLength === 0) {
        try { rawBuffer = await new Response(rawFile).arrayBuffer(); } catch (e) {}
      }
      if (!rawBuffer || rawBuffer.byteLength === 0) {
        try {
          const objUrl = URL.createObjectURL(rawFile);
          try {
            const resp = await fetch(objUrl);
            const buf = await resp.arrayBuffer();
            if (buf && buf.byteLength > 0) rawBuffer = buf;
          } finally {
            URL.revokeObjectURL(objUrl);
          }
        } catch (e) {}
      }
      if ((!rawBuffer || rawBuffer.byteLength === 0) && typeof FileReader !== 'undefined') {
        rawBuffer = await new Promise((resolve) => {
          try {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result || null);
            reader.onerror = () => resolve(null);
            reader.readAsArrayBuffer(rawFile);
          } catch (err) {
            resolve(null);
          }
        });
      }
    }
  }

  let canvasFallbackFile = null;
  let canvasFallbackBuffer = null;
  if (!rawBuffer || rawBuffer.byteLength === 0) {
    const maybeImage = inferMimeType(rawFile.name || '', rawFile.type || '');
    if (maybeImage.startsWith('image/') && maybeImage !== 'image/gif') {
      try {
        const reencoded = await new Promise((resolve) => {
          let objUrl = null;
          try {
            objUrl = URL.createObjectURL(rawFile);
            const img = new window.Image();
            img.onload = () => {
              try {
                const maxDim = 2560;
                let { naturalWidth: w, naturalHeight: h } = img;
                if (!w || !h) { if (objUrl) URL.revokeObjectURL(objUrl); return resolve(null); }
                if (w > maxDim || h > maxDim) {
                  if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
                  else { w = Math.round((w * maxDim) / h); h = maxDim; }
                }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                if (!ctx) { if (objUrl) URL.revokeObjectURL(objUrl); return resolve(null); }
                ctx.drawImage(img, 0, 0, w, h);
                URL.revokeObjectURL(objUrl); objUrl = null;
                canvas.toBlob((blob) => {
                  if (blob && blob.size > 0) {
                    const name = (rawFile.name || 'photo.jpg').replace(/\.[^/.]+$/, '') + '.jpg';
                    const f = new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
                    resolve(f);
                  } else resolve(null);
                }, 'image/jpeg', 0.88);
              } catch (e) { if (objUrl) URL.revokeObjectURL(objUrl); resolve(null); }
            };
            img.onerror = () => { if (objUrl) URL.revokeObjectURL(objUrl); resolve(null); };
            img.src = objUrl;
          } catch (e) { if (objUrl) URL.revokeObjectURL(objUrl); resolve(null); }
        });
        if (reencoded) {
          try {
            const buf = await reencoded.arrayBuffer();
            if (buf && buf.byteLength > 0) {
              canvasFallbackFile = reencoded;
              canvasFallbackBuffer = buf;
              rawBuffer = buf;
            }
          } catch (e) {}
          if (!canvasFallbackBuffer) {
            try {
              const url2 = URL.createObjectURL(reencoded);
              try {
                const r2 = await fetch(url2);
                const b2 = await r2.arrayBuffer();
                if (b2 && b2.byteLength > 0) {
                  canvasFallbackFile = reencoded;
                  canvasFallbackBuffer = b2;
                  rawBuffer = b2;
                }
              } finally { URL.revokeObjectURL(url2); }
            } catch (e) {}
          }
        }
      } catch (e) {}
    }
  }

  if (!rawBuffer || rawBuffer.byteLength === 0) {
    console.error('prepareFileForSending: all read tiers failed', { name: rawFile.name, size: rawFile.size, type: rawFile.type });
    throw new Error(`Could not access "${rawFile.name}". If this photo is stored in cloud backup, please ensure it is downloaded to device storage or select it again.`);
  }

  let file = rawFile;
  let fileBuffer = rawBuffer;
  if (canvasFallbackFile && canvasFallbackBuffer) {
    file = canvasFallbackFile;
    fileBuffer = canvasFallbackBuffer;
  } else {
    const optimized = await optimizeImageForSending(rawFile, rawBuffer);
    file = optimized;
    if (file !== rawFile) {
      let gotOptimized = false;
      try {
        const optimizedBuffer = await file.arrayBuffer();
        if (optimizedBuffer && optimizedBuffer.byteLength > 0) { fileBuffer = optimizedBuffer; gotOptimized = true; }
      } catch (e) {}
      if (!gotOptimized) {
        try {
          const u = URL.createObjectURL(file);
          try { const rr = await fetch(u); const bb = await rr.arrayBuffer(); if (bb && bb.byteLength > 0) fileBuffer = bb; }
          finally { URL.revokeObjectURL(u); }
        } catch (e) {}
      }
    }
  }

  const fileSessionKey = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encryptedFileBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    fileSessionKey,
    fileBuffer
  );
  const keyJwk = await window.crypto.subtle.exportKey('jwk', fileSessionKey);

  const inferredMime = inferMimeType(file.name, file.type);
  const localBlob = new Blob([fileBuffer], { type: inferredMime });

  return {
    file,
    fileBuffer,
    inferredMime,
    localBlob,
    encryptedBase64: bufferToBase64(encryptedFileBuffer),
    keyJwk,
    ivBase64: bufferToBase64(iv)
  };
};

// Creates a downscaled lightweight canvas thumbnail blob for in-chat message previews
export const createThumbnailBlob = (blob, maxDimension = 480) => {
  return new Promise((resolve) => {
    if (!blob || blob.size < 150 * 1024 || !blob.type || !blob.type.startsWith('image/')) {
      return resolve(blob);
    }
    const img = new window.Image();
    const origUrl = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(origUrl);
      const width = img.width;
      const height = img.height;

      if (width <= maxDimension && height <= maxDimension) {
        return resolve(blob);
      }

      let targetWidth = width;
      let targetHeight = height;

      if (width > height) {
        if (width > maxDimension) {
          targetHeight = Math.round((height * maxDimension) / width);
          targetWidth = maxDimension;
        }
      } else {
        if (height > maxDimension) {
          targetWidth = Math.round((width * maxDimension) / height);
          targetHeight = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      canvas.toBlob(
        (thumbnailBlob) => {
          resolve(thumbnailBlob || blob);
        },
        'image/jpeg',
        0.82
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(origUrl);
      resolve(blob);
    };
    img.src = origUrl;
  });
};

// In-memory instant media URL cache (URL -> { fullUrl, thumbUrl })
export const globalMediaSessionCache = new Map();

// Deterministic shimmer aspect
export const getSkeletonAspect = (url = '', w = null, h = null) => {
  if (w && h && w > 0 && h > 0) {
    return `${w} / ${h}`;
  }
  let hash = 0;
  const s = String(url);
  for (let i = 0; i < s.length; i++) hash = ((hash * 31) + s.charCodeAt(i)) >>> 0;
  const buckets = ['1 / 1', '4 / 3', '3 / 2', '16 / 10', '4 / 3', '3 / 4', '1 / 1'];
  return buckets[hash % buckets.length];
};
