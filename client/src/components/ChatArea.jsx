import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  Send, Shield, Phone, Video, Paperclip, Mic, X, Play, Pause, 
  FileText, Image, Video as VideoIcon, Download, AlertTriangle,
  ArrowLeft, CornerUpLeft, ArrowDown, PhoneOff, VideoOff, ArrowUp, Plus, ShieldCheck, Trash2, Camera, Music, Check, Copy, Ban, Unlock, Loader2,
  ChevronLeft, ChevronRight, Smile
} from 'lucide-react';
import AppleEmojiPicker from './AppleEmojiPicker';
import { uploadEncryptedFile } from '../services/api';
import { bufferToBase64, base64ToBuffer } from '../services/crypto';
import { getSocket } from '../services/socket';
import { renderAvatar } from './Sidebar';
import { loadOrFetchDecryptedMedia, setCachedMedia, getMemoryMediaUrl, warmupMediaCache } from '../services/mediaCache';
import { soundEngine } from '../services/soundEffects';

const getSafetyNumber = (keyA, keyB) => {
  if (!keyA || !keyB) return 'N/A';
  
  // Sort key JSON strings to guarantee commutative identity verification
  const strA = typeof keyA === 'string' ? keyA : JSON.stringify(keyA);
  const strB = typeof keyB === 'string' ? keyB : JSON.stringify(keyB);
  const sorted = [strA, strB].sort();
  const combined = sorted[0] + sorted[1];
  
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  const absHash = Math.abs(hash).toString().padEnd(10, '7') + Math.abs(hash * 31 + 17).toString().padEnd(10, '3');
  return absHash.slice(0, 5) + ' ' + absHash.slice(5, 10) + ' ' + absHash.slice(10, 15) + ' ' + absHash.slice(15, 20);
};

// ==========================================
// Date & Time Formatting Helpers
// ==========================================
const formatMessageTime = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const shouldShowDateSeparator = (messages, index) => {
  if (index === 0) return true;
  const prevDate = new Date(messages[index - 1].timestamp);
  const currDate = new Date(messages[index].timestamp);
  return prevDate.toDateString() !== currDate.toDateString();
};

const formatSeparatorDate = (timestamp) => {
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

// Detect if a message consists exclusively of 1 to 3 emojis
// Detect if a message consists exclusively of 1 to 3 emojis
const isOnlyEmoji = (text) => {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Reject if it contains standard ASCII alphanumeric words (unless keycap emoji)
  if (/[a-zA-Z]/.test(trimmed)) {
    return false;
  }
  if (/[0-9]/.test(trimmed) && !/^[0-9]\uFE0F?\u20E3$/.test(trimmed)) {
    return false;
  }

  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
  const segments = segmenter 
    ? Array.from(segmenter.segment(trimmed)).map(s => s.segment.trim()).filter(Boolean) 
    : Array.from(trimmed).filter(c => c.trim().length > 0);
  
  if (segments.length === 0 || segments.length > 3) return false;
  
  const EMOJI_REGEX = /^(\p{Extended_Pictographic}|\p{Emoji}|\u200D|\uFE0E|\uFE0F|\p{Emoji_Component}|\p{Emoji_Modifier}|\p{Emoji_Modifier_Base}|\p{Emoji_Presentation})+$/u;
  return segments.every(s => EMOJI_REGEX.test(s));
};

const getEmojiCount = (text) => {
  if (!text || typeof text !== 'string') return 0;
  const trimmed = text.trim();
  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
  const segments = segmenter 
    ? Array.from(segmenter.segment(trimmed)).map(s => s.segment.trim()).filter(Boolean) 
    : Array.from(trimmed).filter(c => c.trim().length > 0);
  return segments.length;
};

// Format text with clickable links
const renderFormattedText = (text) => {
  if (!text || typeof text !== 'string') return text;
  
  const URL_REGEX = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s]|www\.[^\s<]+[^<.,:;"')\]\s])/gi;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }

    const rawUrl = match[0];
    const href = rawUrl.startsWith('http://') || rawUrl.startsWith('https://') 
      ? rawUrl 
      : `https://${rawUrl}`;

    parts.push(
      <a
        key={`link-${match.index}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="chat-text-link"
        onClick={(e) => {
          if (window.__isChatraSelectionMode) {
            e.preventDefault();
          } else {
            e.stopPropagation();
          }
        }}
      >
        {rawUrl}
      </a>
    );

    lastIndex = URL_REGEX.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
};

// Group consecutive image/video media into visual albums, consecutive file attachments into multi-file cards,
// and deduplicate consecutive identical system call logs.
const groupMessagesWithAlbums = (rawMessages) => {
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
const readBlobBufferSafely = async (blob) => {
  if (!blob) return null;
  if (blob._preloadedBuffer && blob._preloadedBuffer.byteLength > 0) {
    return blob._preloadedBuffer;
  }
  // Tier 1: direct arrayBuffer
  if (typeof blob.arrayBuffer === 'function') {
    try {
      const buf = await blob.arrayBuffer();
      if (buf && buf.byteLength > 0) return buf;
    } catch (e) {}
  }
  // Tier 2: Response stream (bypasses Chrome/Android content lock)
  try {
    const res = new Response(blob);
    const buf = await res.arrayBuffer();
    if (buf && buf.byteLength > 0) return buf;
  } catch (e) {}
  // Tier 3: Sliced blob
  try {
    const sliced = blob.slice(0, blob.size, blob.type);
    if (typeof sliced.arrayBuffer === 'function') {
      const buf = await sliced.arrayBuffer();
      if (buf && buf.byteLength > 0) return buf;
    }
  } catch (e) {}
  // Tier 4: FileReader fallback
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result || new ArrayBuffer(0));
      reader.onerror = () => resolve(new ArrayBuffer(0));
      reader.readAsArrayBuffer(blob);
    } catch (e) {
      resolve(new ArrayBuffer(0));
    }
  });
};

// Fullscreen Interactive Album Gallery Modal
const AlbumGalleryModal = ({ items, initialIndex = 0, onClose }) => {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [isOpen, setIsOpen] = useState(false);
  const currentItem = items[activeIndex];
  const total = items.length;
  const touchStartRef = useRef(null);
  const isClosingRef = useRef(false);

  useEffect(() => {
    window.__isMediaModalOpen = true;
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    const timer = requestAnimationFrame(() => setIsOpen(true));
    return () => {
      cancelAnimationFrame(timer);
      window.__isMediaModalOpen = false;
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
    };
  }, []);

  const handleClose = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    setIsOpen(false);
    setTimeout(() => {
      onClose();
    }, 250);
  }, [onClose]);

  const handleOverlayClick = useCallback((e) => {
    // If click originated on an interactive element, do not dismiss
    if (
      e.target.closest('.gallery-nav-btn') ||
      e.target.closest('.gallery-action-btn') ||
      e.target.closest('.album-gallery-filmstrip') ||
      e.target.closest('.message-image') ||
      e.target.closest('.message-video') ||
      e.target.closest('.gallery-caption-bar')
    ) {
      return;
    }
    handleClose();
  }, [handleClose]);

  const handlePrev = useCallback(() => {
    setActiveIndex(prev => (prev > 0 ? prev - 1 : total - 1));
  }, [total]);

  const handleNext = useCallback(() => {
    setActiveIndex(prev => (prev < total - 1 ? prev + 1 : 0));
  }, [total]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') handleClose();
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'ArrowRight') handleNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose, handlePrev, handleNext]);

  const file = currentItem?.fileMetadata;
  const isImage = file?.mimeType?.startsWith('image/');
  const isVideo = file?.mimeType?.startsWith('video/');

  const handleDownloadCurrent = async () => {
    if (!file) return;
    try {
      const blob = await loadOrFetchDecryptedMedia(file);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name || 'media';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    }
  };

  return createPortal(
    <div 
      className={`album-gallery-modal-overlay ${isOpen ? 'visible' : ''}`}
      onClick={handleOverlayClick}
      onTouchStart={(e) => {
        touchStartRef.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touchStartRef.current === null) return;
        const deltaX = e.changedTouches[0].clientX - touchStartRef.current;
        if (deltaX > 45) handlePrev();
        else if (deltaX < -45) handleNext();
        touchStartRef.current = null;
      }}
    >
      {/* Top Navigation Bar */}
      <div className="album-gallery-header">
        <div className="album-gallery-title-info">
          <span className="album-gallery-counter">{activeIndex + 1} of {total}</span>
          {file?.name && <span className="album-gallery-filename">{file.name}</span>}
        </div>
        <div className="album-gallery-actions">
          <button 
            className="gallery-action-btn" 
            onClick={handleDownloadCurrent}
            title="Download file"
            aria-label="Download file"
          >
            <Download size={19} />
          </button>
          <button 
            className="gallery-action-btn close-btn" 
            onClick={handleClose}
            title="Close viewer"
            aria-label="Close viewer"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Main Full-Size Media Container */}
      <div className="album-gallery-main">
        {total > 1 && (
          <button 
            className="gallery-nav-btn prev-btn" 
            onClick={(e) => {
              e.stopPropagation();
              handlePrev();
            }}
            title="Previous (Left Arrow)"
            aria-label="Previous"
          >
            <ChevronLeft size={28} />
          </button>
        )}

        <div className="album-gallery-stage">
          {isImage ? (
            <ImagePreviewLoader 
              fileMetadata={file} 
              isFullRes={true}
            />
          ) : isVideo ? (
            <VideoPreviewLoader fileMetadata={file} />
          ) : null}
          {currentItem?.text && (
            <div className="gallery-caption-bar">
              <p>{currentItem.text}</p>
            </div>
          )}
        </div>

        {total > 1 && (
          <button 
            className="gallery-nav-btn next-btn" 
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            title="Next (Right Arrow)"
            aria-label="Next"
          >
            <ChevronRight size={28} />
          </button>
        )}
      </div>

      {/* Bottom Filmstrip Carousel */}
      {total > 1 && (
        <div className="album-gallery-filmstrip" onClick={(e) => e.stopPropagation()}>
          <div className="filmstrip-track">
            {items.map((item, idx) => {
              const itemFile = item.fileMetadata;
              const isActive = idx === activeIndex;
              return (
                <button
                  key={item.id || idx}
                  className={`filmstrip-thumb ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveIndex(idx)}
                  title={`Photo ${idx + 1}`}
                >
                  <ImagePreviewLoader fileMetadata={itemFile} />
                  {isActive && <div className="active-thumb-glow" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};

// WhatsApp-style Media Collage Grid with Fullscreen Gallery Modal Support
const MediaAlbumGrid = React.memo(function MediaAlbumGrid({ albumItems, onImageClick, selectionMode, isLast, handleImageLoad }) {
  const [galleryIndex, setGalleryIndex] = useState(null);
  const total = albumItems.length;

  const displayItems = albumItems.slice(0, 4);
  const remainingCount = total - 3;

  let gridClass = 'album-grid-4';
  if (total === 2) gridClass = 'album-grid-2';
  else if (total === 3) gridClass = 'album-grid-3';

  return (
    <>
      <div className="media-album-wrapper">
        <div className={`media-album-grid ${gridClass}`}>
          {displayItems.map((item, idx) => {
            const isFourthWithMore = idx === 3 && total > 4;
            const file = item.fileMetadata;
            const isImage = file?.mimeType?.startsWith('image/');
            const isVideo = file?.mimeType?.startsWith('video/');

            return (
              <div 
                key={item.id || idx} 
                className={`album-grid-cell cell-${idx + 1}`}
                onClick={(e) => {
                  if (selectionMode) return;
                  e.stopPropagation();
                  setGalleryIndex(idx);
                }}
              >
                {isImage ? (
                  <ImagePreviewLoader 
                    fileMetadata={file} 
                    onImageClick={() => {
                      if (!selectionMode) setGalleryIndex(idx);
                    }}
                    onImageLoad={isLast && idx === 0 ? handleImageLoad : undefined} 
                  />
                ) : isVideo ? (
                  <VideoPreviewLoader fileMetadata={file} />
                ) : null}

                {isFourthWithMore && (
                  <div 
                    className="album-more-overlay"
                    role="button"
                    title={`View all ${total} media items in full screen`}
                    onClick={(e) => {
                      if (selectionMode) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setGalleryIndex(3);
                    }}
                  >
                    <span className="album-more-text">+{remainingCount}</span>
                    <span className="album-more-sub">See all {total}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {galleryIndex !== null && (
        <AlbumGalleryModal 
          items={albumItems} 
          initialIndex={galleryIndex} 
          onClose={() => setGalleryIndex(null)} 
        />
      )}
    </>
  );
});

// ==========================================
// MessageList Component (Memoized for peak performance)
// ==========================================
const MessageList = React.memo(({
  messages,
  activeContactUsername,
  activeContactIsTyping,
  justReceivedId,
  lastMessageRef,
  typingBubbleRef,
  scrollToMessage,
  setReplyingTo,
  textareaRef,
  renderMessageContent
  , onDeleteMessages
  , selectionCancelRef
  , onSelectionModeChange
}) => {
  const [swipeState, setSwipeState] = useState({ msgId: null, offset: 0, isSwiping: false });
  const swipeStartRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [deletingIds, setDeletingIds] = useState([]);
  const selectionMode = selectedIds.length > 0;

  const groupedMessages = useMemo(() => groupMessagesWithAlbums(messages), [messages]);

  const selectedMsgForCopy = selectedIds.length === 1 ? messages.find(m => m.id === selectedIds[0]) : null;
  const canCopySelected = Boolean(
    selectedMsgForCopy && 
    !selectedMsgForCopy.mediaType && 
    !selectedMsgForCopy.fileMetadata && 
    typeof selectedMsgForCopy.text === 'string' && 
    selectedMsgForCopy.text.trim().length > 0
  );

  useEffect(() => {
    onSelectionModeChange?.({ active: selectionMode, count: selectedIds.length, canCopy: canCopySelected });
    if (selectionCancelRef) {
      selectionCancelRef.current = () => setSelectedIds([]);
      selectionCancelRef.current.delete = () => {
        const ids = [...selectedIds];
        setSelectedIds([]);
        onDeleteMessages(ids);
      };
      selectionCancelRef.current.copy = () => {
        if (selectedMsgForCopy && selectedMsgForCopy.text) {
          const textToCopy = selectedMsgForCopy.text;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(textToCopy).catch(() => {});
          } else {
            const textarea = document.createElement('textarea');
            textarea.value = textToCopy;
            document.body.appendChild(textarea);
            textarea.select();
            try { document.execCommand('copy'); } catch (e) {}
            document.body.removeChild(textarea);
          }
          if (window.navigator && window.navigator.vibrate) {
            try { window.navigator.vibrate(15); } catch (err) {}
          }
          soundEngine?.playClick?.();
          setSelectedIds([]);
        }
      };
    }
    return () => { if (selectionCancelRef) selectionCancelRef.current = null; };
  }, [selectionMode, selectedIds, selectedMsgForCopy, canCopySelected, onDeleteMessages, onSelectionModeChange, selectionCancelRef]);

  const toggleSelected = (msg) => {
    const ids = msg.isAlbum ? msg.allIds : [msg.id];
    setSelectedIds(prev => {
      const allSelected = ids.every(id => prev.includes(id));
      if (allSelected) {
        return prev.filter(id => !ids.includes(id));
      } else {
        return [...prev, ...ids.filter(id => !prev.includes(id))];
      }
    });
  };

  const startLongPress = (msg) => {
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      toggleSelected(msg);
      if (navigator.vibrate) navigator.vibrate(18);
    }, 480);
  };
  const cancelLongPress = () => window.clearTimeout(longPressTimerRef.current);

  const hasJustReceivedMessage = Boolean(
    justReceivedId !== null && 
    messages && 
    messages.length > 0 && 
    messages[messages.length - 1]?.id === justReceivedId
  );

  return (
    <div className="message-list">
      {groupedMessages && groupedMessages.map((msg, index) => {
        const isSent = msg.sender === activeContactUsername ? false : true;
        const showDateSeparator = shouldShowDateSeparator(groupedMessages, index);

        // Render call logs as centered E2EE system logs rather than message bubbles
        if (msg.mediaType === 'call') {
          let callData = { callType: 'voice', status: 'completed', duration: 0 };
          try {
            callData = JSON.parse(msg.text);
          } catch (e) {
            // Fallback
          }
          const isVoice = callData.callType === 'voice';
          const status = callData.status;
          const isSentByMe = msg.sender.toLowerCase() !== activeContactUsername.toLowerCase();
          const isMissedOrCancelled = status === 'cancelled' || status === 'missed' || status === 'declined';

          let statusText = '';
          if (isSentByMe) {
            if (status === 'completed') {
              statusText = `Outgoing ${isVoice ? 'Voice' : 'Video'} Call`;
            } else if (status === 'cancelled') {
              statusText = 'Cancelled Call';
            } else {
              statusText = 'Declined Call';
            }
          } else {
            if (status === 'completed') {
              statusText = `Incoming ${isVoice ? 'Voice' : 'Video'} Call`;
            } else {
              statusText = `Missed ${isVoice ? 'Voice' : 'Video'} Call`;
            }
          }

          const formatCallDuration = (secs) => {
            const mins = Math.floor(secs / 60);
            const remainder = secs % 60;
            return `${mins}:${remainder.toString().padStart(2, '0')}`;
          };

          const iconClass = isMissedOrCancelled ? 'missed' : 'completed';

          return (
            <React.Fragment key={msg.id}>
              {showDateSeparator && (
                <div className="date-separator">
                  <span>{formatSeparatorDate(msg.timestamp)}</span>
                </div>
              )}
              <div 
                id={`msg-${msg.id}`}
                ref={index === messages.length - 1 ? lastMessageRef : null}
                className="system-call-log-container"
              >
                <div className="system-call-log-card glass">
                  <div className={`system-call-log-icon ${iconClass}`}>
                    {isVoice ? (
                      isMissedOrCancelled ? <PhoneOff size={12} /> : <Phone size={12} />
                    ) : (
                      isMissedOrCancelled ? <VideoOff size={12} /> : <Video size={12} />
                    )}
                  </div>
                  <div className="system-call-log-details">
                    <span className="system-call-log-text">
                      {statusText}{msg.callCount > 1 ? ` (${msg.callCount})` : ''}
                    </span>
                    {status === 'completed' && (
                      <span className="system-call-duration">({formatCallDuration(callData.duration)})</span>
                    )}
                    <span className="system-call-bullet">•</span>
                    <span className="system-call-time">
                      {formatMessageTime(msg.timestamp)}
                    </span>
                  </div>
                </div>
              </div>
            </React.Fragment>
          );
        }

        const staggerIndex = Math.max(0, index - (groupedMessages.length - 12));

        const isOnlyEmojiMsg = !msg.isAlbum && !msg.mediaType && !msg.replyTo && isOnlyEmoji(msg.text);
        const emojiCount = isOnlyEmojiMsg ? getEmojiCount(msg.text) : 0;

        const prevMsg = groupedMessages[index - 1];
        const isFirstOfGroup = !prevMsg || (prevMsg.mediaType === 'call') || (prevMsg.sender?.toLowerCase() !== msg.sender?.toLowerCase());

        return (
          <React.Fragment key={msg.id}>
            {showDateSeparator && (
              <div className="date-separator">
                <span>{formatSeparatorDate(msg.timestamp)}</span>
              </div>
            )}
            <div 
              className={`message-row ${isSent ? 'sent' : 'received'} ${isFirstOfGroup ? 'is-first-of-group' : 'is-subsequent'} {((msg.isAlbum || msg.isMultiFile) ? msg.allIds.some(id => deletingIds.includes(id)) : deletingIds.includes(msg.id)) || msg.isDeleting ? 'is-deleting' : ''} ${msg.isCollapsing ? 'is-collapsing' : ''}`}
              style={{ '--msg-delay': staggerIndex }}
              onContextMenu={(e) => e.preventDefault()}
              onClickCapture={(e) => {
                if (longPressTriggeredRef.current) {
                  e.preventDefault();
                  e.stopPropagation();
                  longPressTriggeredRef.current = false;
                  return;
                }
                if (selectionMode) {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleSelected(msg);
                }
              }}
              onMouseDown={(e) => {
                if (window.__isMediaModalOpen || e.button !== 0 || selectionMode) return;
                startLongPress(msg);
              }}
              onMouseUp={cancelLongPress}
              onMouseLeave={cancelLongPress}
              onTouchStart={(e) => {
                if (window.__isMediaModalOpen || document.body.style.overflow === 'hidden' || document.querySelector('.image-lightbox-overlay.visible, .album-gallery-modal-overlay')) {
                  return;
                }
                if (selectionMode) {
                  e.preventDefault();
                  return;
                }
                startLongPress(msg);
                if (window.matchMedia && !window.matchMedia('(pointer: coarse)').matches) return;
                const touch = e.touches[0];
                swipeStartRef.current = { x: touch.clientX, y: touch.clientY, msgId: msg.id };
              }}
              onClick={() => {
                if (longPressTriggeredRef.current) {
                  longPressTriggeredRef.current = false;
                  return;
                }
                if (selectionMode) toggleSelected(msg);
              }}
              onTouchMove={(e) => {
                if (window.__isMediaModalOpen || document.body.style.overflow === 'hidden' || document.querySelector('.image-lightbox-overlay.visible, .album-gallery-modal-overlay')) {
                  return;
                }
                if (selectionMode) return;
                cancelLongPress();
                if (!swipeStartRef.current || swipeStartRef.current.msgId !== msg.id) return;
                const touch = e.touches[0];
                const deltaX = touch.clientX - swipeStartRef.current.x;
                const deltaY = touch.clientY - swipeStartRef.current.y;

                if (deltaX > 0 && Math.abs(deltaX) > Math.abs(deltaY)) {
                  const clampedOffset = Math.min(deltaX * 0.6, 75);
                  setSwipeState({ msgId: msg.id, offset: clampedOffset, isSwiping: true });
                }
              }}
              onTouchEnd={() => {
                if (window.__isMediaModalOpen || document.body.style.overflow === 'hidden' || document.querySelector('.image-lightbox-overlay.visible, .album-gallery-modal-overlay')) {
                  swipeStartRef.current = null;
                  setSwipeState({ msgId: null, offset: 0, isSwiping: false });
                  return;
                }
                if (selectionMode) return;
                cancelLongPress();
                if (swipeStartRef.current?.msgId === msg.id) {
                  if (swipeState.offset >= 30) {
                    const targetMsg = (msg.isAlbum || msg.isMultiFile) ? (msg.albumItems || msg.fileItems)[0] : msg;
                    setReplyingTo({
                      id: targetMsg.id,
                      sender: targetMsg.sender,
                      text: msg.isAlbum ? `[${msg.albumItems.length} Photos]` : msg.isMultiFile ? `[${msg.fileItems.length} Files]` : (msg.mediaType ? `[${msg.mediaType}]` : msg.text),
                      mediaType: targetMsg.mediaType || null,
                      fileMetadata: targetMsg.fileMetadata || null
                    });
                    if (window.navigator && window.navigator.vibrate) {
                      try { window.navigator.vibrate(15); } catch (err) {}
                    }
                    setTimeout(() => {
                      if (textareaRef.current) {
                        textareaRef.current.blur();
                        textareaRef.current.focus();
                        textareaRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                      }
                    }, 60);
                  }
                }
                swipeStartRef.current = null;
                setSwipeState({ msgId: null, offset: 0, isSwiping: false });
              }}
              onTouchCancel={() => {
                if (selectionMode) return;
                cancelLongPress();
                swipeStartRef.current = null;
                setSwipeState({ msgId: null, offset: 0, isSwiping: false });
              }}
            >
              {(() => {
                const isSelectedMsg = (msg.isAlbum || msg.isMultiFile) 
                  ? msg.allIds.some(id => selectedIds.includes(id)) 
                  : selectedIds.includes(msg.id);

                return (
                  <div 
                    id={`msg-${msg.id}`} 
                    ref={index === groupedMessages.length - 1 ? lastMessageRef : null}
                    data-unread-id={(!isSent && msg.status < 2) ? msg.id : undefined}
                    className={`message-wrapper ${isSent ? 'sent' : 'received'} ${isOnlyEmojiMsg ? 'emoji-only-wrapper' : ''} ${msg.isNew ? 'new-message' : ''} ${(!isSent && msg.isNew) ? 'fused-morph' : ''} ${isSelectedMsg ? 'is-selected' : ''} ${msg.isDeleting ? 'is-deleting' : ''} ${selectionMode ? 'selection-mode-message' : ''}`}
                    style={{
                      transform: swipeState.msgId === msg.id && swipeState.offset > 0 ? `translateX(${swipeState.offset}px)` : 'translateX(0px)',
                      transition: swipeState.msgId === msg.id && swipeState.isSwiping ? 'none' : 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
                    }}
                  >
                    {/* Swipe-to-reply spring indicator icon */}
                    {swipeState.msgId === msg.id && swipeState.offset > 5 && (
                      <div 
                        className="swipe-reply-indicator"
                        style={{
                          opacity: Math.min(swipeState.offset / 30, 1),
                          transform: `translateY(-50%) scale(${Math.min(swipeState.offset / 30, 1)})`
                        }}
                      >
                        <CornerUpLeft size={16} color="var(--accent-color)" />
                      </div>
                    )}
                    <div className={`message-bubble ${isSelectedMsg ? 'is-selected' : ''} ${msg.isAlbum ? 'album-bubble' : ''} ${msg.isMultiFile ? 'multifile-bubble' : ''} ${isOnlyEmojiMsg ? `emoji-only-bubble count-${emojiCount}` : ''} ${msg.mediaType === 'file' && msg.fileMetadata?.mimeType?.startsWith('image/') ? 'single-image-bubble' : ''}`}>
                      {isSelectedMsg && (
                        <div className="selection-indicator-badge" aria-hidden="true">
                          <Check size={12} strokeWidth={2.8} />
                        </div>
                      )}
                      {!selectionMode && (
                        <div className="message-actions-container">
                          <button 
                            className="msg-action-btn" 
                            title="Reply"
                            aria-label="Reply to message"
                            onClick={() => {
                              const targetMsg = (msg.isAlbum || msg.isMultiFile) ? (msg.albumItems || msg.fileItems)[0] : msg;
                              setReplyingTo({
                                id: targetMsg.id,
                                sender: targetMsg.sender,
                                text: msg.isAlbum ? `[${msg.albumItems.length} Photos]` : msg.isMultiFile ? `[${msg.fileItems.length} Files]` : (msg.mediaType ? `[${msg.mediaType}]` : msg.text),
                                mediaType: targetMsg.mediaType || null,
                                fileMetadata: targetMsg.fileMetadata || null
                              });
                              setTimeout(() => {
                                if (textareaRef.current) {
                                  textareaRef.current.blur();
                                  textareaRef.current.focus();
                                  textareaRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                                }
                              }, 50);
                            }}
                          >
                            <CornerUpLeft size={12} />
                          </button>
                        </div>
                      )}
                      {msg.replyTo && (
                        <div className="message-reply-context" onClick={() => scrollToMessage(msg.replyTo.id)}>
                          <span className="reply-context-sender">{msg.replyTo.sender}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                            {msg.replyTo.mediaType === 'file' && msg.replyTo.fileMetadata?.mimeType?.startsWith('image/') && (
                              <div className="reply-image-thumbnail">
                                <ImagePreviewLoader fileMetadata={msg.replyTo.fileMetadata} />
                              </div>
                            )}
                            <p className="reply-context-text">
                              {msg.replyTo.mediaType === 'file' && msg.replyTo.fileMetadata?.mimeType?.startsWith('image/')
                                ? 'Photo'
                                : msg.replyTo.text
                              }
                            </p>
                          </div>
                        </div>
                      )}
                      <div className="message-bubble-body">
                        <div className="message-text-content">
                          {renderMessageContent(msg, index === groupedMessages.length - 1)}
                        </div>
                        {msg.mediaType !== 'voice' && (
                          <span className="inline-message-meta">
                            <span className="inline-meta-time">
                              {formatMessageTime(msg.timestamp)}
                            </span>
                            {isSent && (
                              <span className="inline-meta-ticks" title={msg.status === 2 ? "Read" : msg.status === 1 ? "Delivered" : "Sent"}>
                                {msg.status === 0 && <span className="tick-single">✓</span>}
                                {msg.status === 1 && <span className="tick-delivered">✓✓</span>}
                                {msg.status === 2 && <span className="tick-read">✓✓</span>}
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </React.Fragment>
        );
      })}
      <div 
        ref={typingBubbleRef} 
        className={`typing-indicator-wrapper ${activeContactIsTyping && !hasJustReceivedMessage ? 'visible' : ''}`}
      >
        <div className="typing-indicator-inner-grid">
          <div className="message-wrapper received" style={{ marginBottom: '8px' }}>
            <div className="typing-bubble">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

const ChatArea = React.memo(function ChatArea({ 
  currentUser,
  activeContact, 
  onSendMessage, 
  onInitiateCall,
  currentUserToken,
  sharedSecret,
  onBack,
  isNavigatingBack,
  markMessageAsReadLocal,
  markAllMessagesAsReadLocal,
  onImageClick,
  onVerifyContact,
  onSaveContact,
  onBlockContact,
  onDeleteMessages,
  selectionCancelCallbackRef,
  onOpenSafetyModal,
  replyingTo,
  setReplyingTo
}) {
  const selectionCancelRef = useRef(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectionCount, setSelectionCount] = useState(0);
  const [selectionCanCopy, setSelectionCanCopy] = useState(false);
  const selectionModeRef = useRef(false);
  selectionModeRef.current = selectionMode;
  const handleSelectionModeChange = ({ active, count, canCopy }) => {
    setSelectionMode(active);
    setSelectionCount(count);
    setSelectionCanCopy(Boolean(canCopy));
  };
  const handleChatBack = () => {
    if (selectionMode) {
      selectionCancelRef.current?.();
      return true;
    }
    onBack();
    return false;
  };
  useEffect(() => {
    if (selectionCancelCallbackRef) selectionCancelCallbackRef.current = handleChatBack;
    return () => { if (selectionCancelCallbackRef) selectionCancelCallbackRef.current = null; };
  }, [selectionCancelCallbackRef, selectionMode]);
  const [inputText, setInputText] = useState('');
  const [swipeState, setSwipeState] = useState({ msgId: null, offset: 0, isSwiping: false });
  const swipeStartRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingExitMode, setRecordingExitMode] = useState(null); // 'cancel' | 'send' | null
  const [isSendingVoice, setIsSendingVoice] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isClearingFiles, setIsClearingFiles] = useState(false);
  const [removingFileIndex, setRemovingFileIndex] = useState(null);
  const [isClosingReply, setIsClosingReply] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); // { filename, current, total, status, percent }

  // Warm up and pre-decode cached media for instant 0ms access across conversations
  useEffect(() => {
    if (activeContact?.messages?.length) {
      warmupMediaCache(activeContact.messages);
    }
  }, [activeContact?.username, activeContact?.messages]);

  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [isClosingAttachMenu, setIsClosingAttachMenu] = useState(false);
  const attachMenuRef = useRef(null);
  const attachBtnRef = useRef(null);

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isClosingEmojiPicker, setIsClosingEmojiPicker] = useState(false);
  const emojiPickerRef = useRef(null);
  const emojiBtnRef = useRef(null);

  const closeEmojiPicker = useCallback(() => {
    if (!showEmojiPicker || isClosingEmojiPicker) return;
    setIsClosingEmojiPicker(true);
    setTimeout(() => {
      setShowEmojiPicker(false);
      setIsClosingEmojiPicker(false);
    }, 180);
  }, [showEmojiPicker, isClosingEmojiPicker]);

  const toggleEmojiPicker = useCallback(() => {
    if (showEmojiPicker) {
      closeEmojiPicker();
    } else {
      if (showAttachMenu) closeAttachMenu();
      setShowEmojiPicker(true);
    }
  }, [showEmojiPicker, closeEmojiPicker, showAttachMenu]);

  const adjustTextareaHeight = useCallback((el) => {
    if (!el) return;
    el.style.height = '38px';
    if (el.scrollHeight > 48) {
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  }, []);

  const handleInsertEmoji = useCallback((emoji) => {
    if (!textareaRef.current) {
      setInputText(prev => prev + emoji);
      return;
    }
    const textarea = textareaRef.current;
    const start = textarea.selectionStart ?? inputText.length;
    const end = textarea.selectionEnd ?? inputText.length;
    const newText = inputText.substring(0, start) + emoji + inputText.substring(end);
    setInputText(newText);
    soundEngine.playKeyboardTick?.();

    requestAnimationFrame(() => {
      textarea.focus();
      const newPos = start + emoji.length;
      textarea.setSelectionRange(newPos, newPos);
      adjustTextareaHeight(textarea);
    });
  }, [inputText, adjustTextareaHeight]);

  const handleDeleteChar = useCallback(() => {
    if (!textareaRef.current || !inputText) {
      setInputText(prev => prev.slice(0, -1));
      return;
    }
    const textarea = textareaRef.current;
    const start = textarea.selectionStart ?? inputText.length;
    const end = textarea.selectionEnd ?? inputText.length;
    if (start !== end) {
      const newText = inputText.substring(0, start) + inputText.substring(end);
      setInputText(newText);
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(start, start);
        adjustTextareaHeight(textarea);
      });
    } else if (start > 0) {
      const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
      let newPos = start - 1;
      if (segmenter) {
        const segments = Array.from(segmenter.segment(inputText.substring(0, start)));
        const lastSegment = segments[segments.length - 1];
        if (lastSegment) {
          newPos = lastSegment.index;
        }
      }
      const newText = inputText.substring(0, newPos) + inputText.substring(start);
      setInputText(newText);
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(newPos, newPos);
        adjustTextareaHeight(textarea);
      });
    }
  }, [inputText, adjustTextareaHeight]);

  // Close attach menu and emoji picker on outside click or Escape key
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        attachMenuRef.current && 
        !attachMenuRef.current.contains(e.target) &&
        attachBtnRef.current &&
        !attachBtnRef.current.contains(e.target)
      ) {
        closeAttachMenu();
      }
      if (
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(e.target) &&
        emojiBtnRef.current &&
        !emojiBtnRef.current.contains(e.target)
      ) {
        closeEmojiPicker();
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        closeAttachMenu();
        closeEmojiPicker();
      }
    };
    if (showAttachMenu || showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showAttachMenu, showEmojiPicker, closeEmojiPicker]);

  const [isBannerDismissing, setIsBannerDismissing] = useState(false);
  const [dismissedBannerUser, setDismissedBannerUser] = useState(null);

  const handleSaveContactWithAnimation = (username) => {
    if (isBannerDismissing) return;
    setIsBannerDismissing(true);
    setTimeout(() => {
      saveContactToPermanentList?.(username);
      setDismissedBannerUser(username);
      setIsBannerDismissing(false);
    }, 280);
  };

  const handleCancelReplyWithAnimation = useCallback(() => {
    if (isClosingReply || !replyingTo) return;
    setIsClosingReply(true);
    setTimeout(() => {
      setReplyingTo(null);
      setIsClosingReply(false);
    }, 220);
  }, [isClosingReply, replyingTo, setReplyingTo]);

  const handleClearAllFilesWithAnimation = useCallback(() => {
    if (isClearingFiles || selectedFiles.length === 0) return;
    setIsClearingFiles(true);
    setTimeout(() => {
      setSelectedFiles([]);
      setIsClearingFiles(false);
    }, 220);
  }, [isClearingFiles, selectedFiles.length]);

  const handleRemoveSingleFileWithAnimation = useCallback((idx) => {
    if (selectedFiles.length <= 1) {
      handleClearAllFilesWithAnimation();
      return;
    }
    setRemovingFileIndex(idx);
    setTimeout(() => {
      setSelectedFiles(prev => prev.filter((_, i) => i !== idx));
      setRemovingFileIndex(null);
    }, 180);
  }, [selectedFiles.length, handleClearAllFilesWithAnimation]);

  const handleBlockContactWithAnimation = (username) => {
    if (isBannerDismissing) return;
    setIsBannerDismissing(true);
    setTimeout(() => {
      onBlockContact?.(username);
      setDismissedBannerUser(username);
      setIsBannerDismissing(false);
    }, 280);
  };

  const closeAttachMenu = () => {
    if (!showAttachMenu) return;
    setIsClosingAttachMenu(true);
    window.setTimeout(() => {
      setShowAttachMenu(false);
      setIsClosingAttachMenu(false);
    }, 180);
  };

  // Close attach popover menu on outside click or Escape key
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        attachMenuRef.current && 
        !attachMenuRef.current.contains(e.target) &&
        attachBtnRef.current &&
        !attachBtnRef.current.contains(e.target)
      ) {
        closeAttachMenu();
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        closeAttachMenu();
      }
    };
    if (showAttachMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showAttachMenu]);

  const openFilePicker = (acceptType = '*/*', captureType = null) => {
    closeAttachMenu();
    const fileInput = document.getElementById('file-input');
    if (fileInput) {
      fileInput.accept = acceptType;
      if (captureType) {
        fileInput.setAttribute('capture', captureType);
      } else {
        fileInput.removeAttribute('capture');
      }
      fileInput.value = '';
      fileInput.click();
    }
  };
  
  const messagesEndRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const recordingDurationRef = useRef(0);
  const textareaRef = useRef(null);

  // Audio players reference map (for voice note playing)
  const [playingAudioId, setPlayingAudioId] = useState(null);
  const [audioProgress, setAudioProgress] = useState({}); // msgId -> percentage
  const activeAudioRef = useRef(null);
  const activeAudioUrlRef = useRef(null);
  const activeAudioMsgIdRef = useRef(null);
  
  // Debounce typing status triggers
  const typingTimeoutRef = useRef(null);
  const isTypingRef = useRef(false);
  const prevContactRef = useRef(activeContact.username);
  const [justReceivedId, setJustReceivedId] = useState(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const isScrolledUpRef = useRef(false);
  const [isInlineTypingVisible, setIsInlineTypingVisible] = useState(false);
  const typingBubbleRef = useRef(null);
  const [activeReplyInfo, setActiveReplyInfo] = useState(null);
  const [activeFileInfo, setActiveFileInfo] = useState(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isLastMessageVisible, setIsLastMessageVisible] = useState(true);
  const lastMessageRef = useRef(null);

  const unreadMessagesCount = useMemo(() => {
    if (!activeContact?.messages) return 0;
    return activeContact.messages.filter(m => m.sender === activeContact.username && m.status < 2).length;
  }, [activeContact?.messages, activeContact?.username]);

  // The scroll unread badge ONLY displays if the user is scrolled up away from the bottom AND there are unread messages
  const localUnreadCount = (!isScrolledUp || isLastMessageVisible) ? 0 : unreadMessagesCount;

  useEffect(() => {
    if (replyingTo) {
      setActiveReplyInfo(replyingTo);
    }
  }, [replyingTo]);

  useEffect(() => {
    if (selectedFiles.length > 0) {
      setActiveFileInfo(selectedFiles[0]);
    } else {
      setActiveFileInfo(null);
    }
  }, [selectedFiles]);



  // Clear typing and replying status on active contact change
  useEffect(() => {
    // If we were typing for the previous contact, notify them we stopped
    const socket = getSocket();
    if (socket && socket.connected && isTypingRef.current && prevContactRef.current) {
      socket.emit('typing', { recipient: prevContactRef.current, isTyping: false });
    }
    isTypingRef.current = false;

    // Track the new active contact
    prevContactRef.current = activeContact.username;

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    setReplyingTo(null);
    setJustReceivedId(null);
    setIsScrolledUp(false);
    isScrolledUpRef.current = false;

    // Unmount cleanup: stop active recording, revoke audio object URLs, and notify offline typing
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stream?.getTracks().forEach(t => t.stop());
          mediaRecorderRef.current.stop();
        } catch (e) {}
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        if (activeAudioUrlRef.current) {
          URL.revokeObjectURL(activeAudioUrlRef.current);
          activeAudioUrlRef.current = null;
        }
      }
      const currentSocket = getSocket();
      if (currentSocket && currentSocket.connected && isTypingRef.current && prevContactRef.current) {
        currentSocket.emit('typing', { recipient: prevContactRef.current, isTyping: false });
      }
    };
  }, [activeContact.username]);

  const handleScroll = useCallback((e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    // Mark as scrolled up the moment the bottom content (typing indicator) begins to get cut off (20px threshold)
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 20;
    const nextScrolledUp = !isAtBottom;
    if (isScrolledUpRef.current !== nextScrolledUp) {
      isScrolledUpRef.current = nextScrolledUp;
      setIsScrolledUp(nextScrolledUp);
    }
  }, []);

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
    isScrolledUpRef.current = false;
    setIsScrolledUp(false);
    setIsLastMessageVisible(true);
    if (markAllMessagesAsReadLocal) {
      markAllMessagesAsReadLocal(activeContact.username);
    }
  };

  // Track very recently received messages to manage typing bubble fusion timing
  useEffect(() => {
    if (!activeContact?.messages?.length) return;
    const lastMsg = activeContact.messages[activeContact.messages.length - 1];
    const isReceived = lastMsg.sender === activeContact.username;
    
    if (isReceived && lastMsg.isNew) {
      setJustReceivedId(lastMsg.id);
      const timer = setTimeout(() => {
        setJustReceivedId(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [activeContact?.messages?.length, activeContact.username]);

  // Automatically smooth-scroll down as the typing indicator appears if the user is at the bottom
  useEffect(() => {
    if (activeContact?.isTyping) {
      setJustReceivedId(null);
      if (isLastMessageVisible && !isScrolledUp) {
        const startTime = performance.now();
        let frameId;
        const keepBottomInView = (now) => {
          if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
          }
          if (now - startTime < 320) {
            frameId = requestAnimationFrame(keepBottomInView);
          }
        };
        frameId = requestAnimationFrame(keepBottomInView);
        return () => cancelAnimationFrame(frameId);
      }
    }
  }, [activeContact?.isTyping, isLastMessageVisible, isScrolledUp]);

  const highlightTimersRef = useRef({});

  useEffect(() => {
    return () => {
      Object.values(highlightTimersRef.current).forEach(clearTimeout);
      highlightTimersRef.current = {};
    };
  }, []);

  const triggerHighlight = useCallback((element, msgId) => {
    if (!element) return;

    if (highlightTimersRef.current[msgId]) {
      clearTimeout(highlightTimersRef.current[msgId]);
    }

    // Force CSS animation re-trigger on rapid consecutive clicks
    element.classList.remove('highlight-flash');
    void element.offsetWidth; // Force DOM reflow
    element.classList.add('highlight-flash');

    highlightTimersRef.current[msgId] = setTimeout(() => {
      element.classList.remove('highlight-flash');
      delete highlightTimersRef.current[msgId];
    }, 1800);
  }, []);

  const scrollToMessage = useCallback((msgId) => {
    const element = document.getElementById(`msg-${msgId}`);
    const container = messagesContainerRef.current;
    if (!element || !container) return;

    // Check if element is currently in view
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();

    const isCurrentlyVisible = (
      elementRect.top >= containerRect.top - 50 &&
      elementRect.bottom <= containerRect.bottom + 50
    );

    // Initiate smooth scroll
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (isCurrentlyVisible) {
      triggerHighlight(element, msgId);
    } else {
      // Observe when target scrolls into view before playing highlight animation
      if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              triggerHighlight(element, msgId);
              observer.disconnect();
            }
          });
        }, {
          root: container,
          threshold: 0.3
        });
        observer.observe(element);

        setTimeout(() => observer.disconnect(), 2000);
      } else {
        setTimeout(() => {
          triggerHighlight(element, msgId);
        }, 400);
      }
    }
  }, [triggerHighlight]);

  const prevMessageCountRef = useRef(0);
  const messagesContainerRef = useRef(null);
  const messagesBounceWrapperRef = useRef(null);

  // Hook for elastic overscroll bounce (rubber-banding) in chat messages (desktop only)
  useEffect(() => {
    const isMobile = window.innerWidth <= 768 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    if (isMobile) return;

    const container = messagesContainerRef.current;
    const wrapper = messagesBounceWrapperRef.current;
    if (!container || !wrapper) return;

    let startY = 0;
    let isDragging = false;
    
    // Physics engine state variables
    let position = 0;
    let velocity = 0;
    const tension = 0.08; // Stiffness of the spring
    const damping = 0.48;  // Critically damped friction coefficient
    let rafId = null;

    // Reset translations
    wrapper.style.transform = 'translate3d(0px, 0px, 0px)';
    wrapper.style.transition = 'none';

    const updatePhysics = () => {
      if (isDragging) return;

      const force = -tension * position;
      const friction = -damping * velocity;
      const acceleration = force + friction;
      
      velocity += acceleration;
      position += velocity;

      const maxVisualOverscroll = 85;
      if (Math.abs(position) > maxVisualOverscroll) {
        position = Math.sign(position) * maxVisualOverscroll;
        velocity = 0; 
      }

      wrapper.style.transform = `translate3d(0px, ${position}px, 0px)`;

      if (Math.abs(position) > 0.05 || Math.abs(velocity) > 0.05) {
        rafId = requestAnimationFrame(updatePhysics);
      } else {
        position = 0;
        velocity = 0;
        wrapper.style.transform = 'translate3d(0px, 0px, 0px)';
        rafId = null;
      }
    };

    const handleTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      startY = e.touches[0].clientY;
      isDragging = true;
    };

    const handleTouchMove = (e) => {
      if (!isDragging) return;

      const currentY = e.touches[0].clientY;
      const deltaY = currentY - startY;

      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;

      const atTop = scrollTop <= 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1;

      if (atTop && deltaY > 0) {
        if (e.cancelable) e.preventDefault();
        position = Math.sign(deltaY) * Math.pow(Math.abs(deltaY), 0.75);
        wrapper.style.transform = `translate3d(0px, ${position}px, 0px)`;
      } else if (atBottom && deltaY < 0) {
        if (e.cancelable) e.preventDefault();
        position = Math.sign(deltaY) * Math.pow(Math.abs(deltaY), 0.75);
        wrapper.style.transform = `translate3d(0px, ${position}px, 0px)`;
      } else {
        startY = currentY;
        position = 0;
        wrapper.style.transform = 'translate3d(0px, 0px, 0px)';
      }
    };

    const handleTouchEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      velocity = 0;
      if (!rafId) {
        rafId = requestAnimationFrame(updatePhysics);
      }
    };

    const handleWheel = (e) => {
      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;

      const atTop = scrollTop <= 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1;

      if ((atTop && e.deltaY < 0) || (atBottom && e.deltaY > 0)) {
        if (e.cancelable) e.preventDefault();
        velocity -= e.deltaY * 0.045;
        if (!rafId) {
          rafId = requestAnimationFrame(updatePhysics);
        }
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      container.removeEventListener('wheel', handleWheel);
    };
  }, [activeContact.username]);

  // Scroll to bottom synchronously on mount / active contact change (runs before paint)
  useLayoutEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
    prevMessageCountRef.current = activeContact?.messages?.length || 0;
    setIsLastMessageVisible(true);
    setIsScrolledUp(false);
    isScrolledUpRef.current = false;
    
    if (markAllMessagesAsReadLocal) {
      markAllMessagesAsReadLocal(activeContact.username);
    }
    
    // Reset textarea height to 36px baseline
    if (textareaRef.current) {
      textareaRef.current.style.height = '36px';
    }
  }, [activeContact.username, markAllMessagesAsReadLocal]);

  // Immediately mark unread messages as read when looking at bottom view
  useEffect(() => {
    if ((isLastMessageVisible || !isScrolledUp) && unreadMessagesCount > 0 && markAllMessagesAsReadLocal) {
      markAllMessagesAsReadLocal(activeContact.username);
    }
  }, [unreadMessagesCount, isLastMessageVisible, isScrolledUp, activeContact.username, markAllMessagesAsReadLocal]);

  // Scroll smoothly on new messages or typing indicators
  useEffect(() => {
    const currentCount = activeContact?.messages?.length || 0;
    
    if (currentCount === prevMessageCountRef.current + 1) {
      const lastMsg = activeContact.messages[activeContact.messages.length - 1];
      const isSentByMe = lastMsg && lastMsg.sender !== activeContact.username;
      
      // Auto-scroll if the message was sent by us OR the previous last message was visible in view
      if (isSentByMe || isLastMessageVisible) {
        if (isLastMessageVisible) {
          // At-bottom: Lock scroll position frame-by-frame during the entry bubble animation
          const startTime = performance.now();
          let frameId;
          
          const keepScrollAtBottom = (now) => {
            if (messagesContainerRef.current) {
              messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
            }
            if (now - startTime < 400) {
              frameId = requestAnimationFrame(keepScrollAtBottom);
            }
          };
          
          frameId = requestAnimationFrame(keepScrollAtBottom);
          return () => cancelAnimationFrame(frameId);
        } else {
          // Scrolled-up: Glide smoothly down to the bottom
          if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTo({
              top: messagesContainerRef.current.scrollHeight,
              behavior: 'smooth'
            });
          }
        }
      }
    } else if (currentCount > prevMessageCountRef.current) {
      if (messagesContainerRef.current && isLastMessageVisible) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
    }
    prevMessageCountRef.current = currentCount;
  }, [activeContact?.messages?.length]);

  const handleImageLoad = () => {
    // If the user was already looking at the bottom, pin the scroll position as the decrypted image loads
    if (isLastMessageVisible) {
      const startTime = performance.now();
      let frameId;
      
      const keepScrollAtBottom = (now) => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
        if (now - startTime < 200) {
          frameId = requestAnimationFrame(keepScrollAtBottom);
        }
      };
      
      frameId = requestAnimationFrame(keepScrollAtBottom);
    }
  };

  // Observe unread messages and mark them as read when they enter the viewport
  useEffect(() => {
    if (!activeContact?.messages?.length || !messagesContainerRef.current) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const msgId = entry.target.getAttribute('data-unread-id');
          if (msgId) {
            entry.target.removeAttribute('data-unread-id');
            // Mark read locally (blue ticks, badge count decrease)
            markMessageAsReadLocal(msgId);
            
            // Tell the server we read this message (updates DB / Bob's ticks)
            const socket = getSocket();
            if (socket && socket.connected) {
              socket.emit('mark-as-read', { sender: activeContact.username });
            }
            
            // Stop observing once marked
            observer.unobserve(entry.target);
          }
        }
      });
    }, {
      root: messagesContainerRef.current,
      threshold: 0.1 // Triggers when 10% of the element is visible
    });

    // Observe all unread messages
    const unreadElements = messagesContainerRef.current.querySelectorAll('[data-unread-id]');
    unreadElements.forEach(el => observer.observe(el));

    return () => observer.disconnect();
  }, [activeContact?.messages, activeContact.username, markMessageAsReadLocal]);

  // Observe inline typing bubble visibility inside viewport
  useEffect(() => {
    if (!activeContact?.isTyping || !messagesContainerRef.current) {
      setIsInlineTypingVisible(false);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      setIsInlineTypingVisible(entry.isIntersecting);
    }, {
      root: messagesContainerRef.current,
      threshold: 0.05 // Trigger when even a tiny bit of the typing bubble enters view
    });

    const currentBubble = typingBubbleRef.current;
    if (currentBubble) {
      observer.observe(currentBubble);
    }

    return () => {
      if (currentBubble) {
        observer.unobserve(currentBubble);
      }
    };
  }, [activeContact?.isTyping]);

  // Observe visibility of the last message in viewport
  useEffect(() => {
    if (!messagesContainerRef.current || !lastMessageRef.current) {
      setIsLastMessageVisible(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      setIsLastMessageVisible(entry.isIntersecting);
    }, {
      root: messagesContainerRef.current,
      threshold: 0.05 // Consider visible if even 5% of the last message is in view
    });

    const currentLast = lastMessageRef.current;
    observer.observe(currentLast);

    return () => {
      if (currentLast) {
        observer.unobserve(currentLast);
      }
    };
  }, [activeContact?.messages?.length, activeContact.username]);

  // Handle auto-resize text area & emit typing events
  const handleTextareaChange = (e) => {
    const text = e.target.value;
    setInputText(text);
    adjustTextareaHeight(e.target);

    const socket = getSocket();
    if (socket && socket.connected) {
      if (text.trim().length > 0) {
        if (!isTypingRef.current) {
          isTypingRef.current = true;
          socket.emit('typing', { recipient: activeContact.username, isTyping: true });
        }

        // Reset auto-stop typing timer
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
          socket.emit('typing', { recipient: activeContact.username, isTyping: false });
          isTypingRef.current = false;
        }, 3000);
      } else {
        // Immediately stop typing if text input cleared
        if (isTypingRef.current) {
          socket.emit('typing', { recipient: activeContact.username, isTyping: false });
          isTypingRef.current = false;
        }
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      }
    }
  };

  const handleSendMessage = async () => {
    // If there's neither text nor attached files, do nothing
    if (!inputText.trim() && selectedFiles.length === 0) return;

    // Immediately emit stop typing
    const socket = getSocket();
    if (socket && socket.connected && isTypingRef.current) {
      socket.emit('typing', { recipient: activeContact.username, isTyping: false });
      isTypingRef.current = false;
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    const captionText = inputText.trim();
    const replyContext = replyingTo ? { 
      id: replyingTo.id, 
      sender: replyingTo.sender, 
      text: replyingTo.text,
      mediaType: replyingTo.mediaType || null,
      fileMetadata: replyingTo.fileMetadata || null
    } : null;

    // Reset input fields instantly
    setInputText('');
    setReplyingTo(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = '38px';
      textareaRef.current.focus({ preventScroll: true });
    }

    if (selectedFiles.length > 0) {
      // Batch send files sequentially
      setUploading(true);
      const filesToUpload = [...selectedFiles];
      setSelectedFiles([]); // Clear queue immediately

      try {
        for (let idx = 0; idx < filesToUpload.length; idx++) {
          const fileToUpload = filesToUpload[idx];
          
          setUploadProgress({
            filename: fileToUpload.name,
            current: idx + 1,
            total: filesToUpload.length,
            percent: 15,
            status: 'Reading file data...'
          });

          // 1. Read file as ArrayBuffer safely (supporting Android content URI files)
          let fileBuffer = fileToUpload._preloadedBuffer || await readBlobBufferSafely(fileToUpload);
          if (!fileBuffer || fileBuffer.byteLength === 0) {
            try {
              fileBuffer = await new Response(fileToUpload).arrayBuffer();
            } catch (e) {}
          }

          setUploadProgress({
            filename: fileToUpload.name,
            current: idx + 1,
            total: filesToUpload.length,
            percent: 42,
            status: 'Encrypting (AES-256-GCM)...'
          });

          // 2. Generate AES-GCM session key
          const fileSessionKey = await window.crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
          );

          // 3. Encrypt file buffer
          const iv = window.crypto.getRandomValues(new Uint8Array(12));
          const encryptedFileBuffer = await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            fileSessionKey,
            fileBuffer
          );

          setUploadProgress({
            filename: fileToUpload.name,
            current: idx + 1,
            total: filesToUpload.length,
            percent: 74,
            status: 'Uploading encrypted payload...'
          });

          // 4. Base64 convert
          const encryptedBase64 = bufferToBase64(encryptedFileBuffer);

          // 5. Upload encrypted file payload
          const { fileUrl } = await uploadEncryptedFile(fileToUpload.name, encryptedBase64, currentUserToken);

          setUploadProgress({
            filename: fileToUpload.name,
            current: idx + 1,
            total: filesToUpload.length,
            percent: 95,
            status: 'Finalizing E2EE message...'
          });

          // Save local copy in IndexedDB
          setCachedMedia(fileUrl, fileToUpload, fileToUpload.type || 'application/octet-stream');

          // 6. Export JWK session key
          const fileSessionKeyJwk = await window.crypto.subtle.exportKey('jwk', fileSessionKey);

          // Attach caption only to the first file in a multi-file batch
          const fileCaption = (idx === 0) ? (captionText || null) : null;

          // 7. Emit message via Socket
          onSendMessage({
            type: 'file',
            text: fileCaption,
            fileMetadata: {
              url: fileUrl,
              name: fileToUpload.name,
              size: fileToUpload.size,
              mimeType: fileToUpload.type || 'application/octet-stream',
              keyJwk: fileSessionKeyJwk,
              iv: bufferToBase64(iv)
            },
            replyTo: idx === 0 ? replyContext : null
          });
        }
        soundEngine.playMessageSent();
      } catch (err) {
        console.error("Encryption/Upload failed:", err);
        alert(`Failed to send encrypted file: ${err.message || 'Unknown upload error'}`);
      } finally {
        setUploadProgress(null);
        setUploading(false);
      }
    } else {
      // Send text-only message
      onSendMessage({
        type: 'text',
        text: captionText,
        replyTo: replyContext
      });
      soundEngine.playMessageSent();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if ((inputText && inputText.trim().length > 0) || selectedFiles.length > 0) {
        handleSendMessage();
      }
    }
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const pastedFiles = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          if (file.size > 15 * 1024 * 1024) {
            alert(`File "${file.name}" exceeds 15MB limit.`);
            continue;
          }
          pastedFiles.push(file);
        }
      }
    }
    if (pastedFiles.length > 0) {
      setSelectedFiles(prev => [...prev, ...pastedFiles]);
      e.preventDefault();
    }
  };

  // ==========================================
  // File Attachment Handling & E2EE Upload
  // ==========================================
  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    
    const validFiles = [];
    for (const f of files) {
      if (f.size > 15 * 1024 * 1024) {
        continue;
      }
      try {
        const buffer = await readBlobBufferSafely(f);
        if (buffer && buffer.byteLength > 0) {
          const safeFile = new File([buffer], f.name, {
            type: f.type || 'application/octet-stream',
            lastModified: f.lastModified || Date.now()
          });
          safeFile._preloadedBuffer = buffer;
          validFiles.push(safeFile);
        } else {
          validFiles.push(f);
        }
      } catch (readErr) {
        console.warn('File selection buffer fallback:', readErr);
        validFiles.push(f);
      }
    }

    if (validFiles.length > 0) {
      setSelectedFiles(prev => [...prev, ...validFiles]);
    }
    e.target.value = '';
  };



  // ==========================================
  // E2EE File Download & Decrypt
  // ==========================================
  const downloadAndDecryptFile = useCallback(async (fileMetadata) => {
    try {
      const blob = await loadOrFetchDecryptedMedia(fileMetadata);
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = fileMetadata.name || 'download';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to decrypt and download file.');
    }
  }, []);

  // ==========================================
  // Voice Notes Recorder
  // ==========================================
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1
        }
      });

      // Select the best supported mimeType for high quality audio recording
      let options = { audioBitsPerSecond: 128000 };
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        options.mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        options.mimeType = 'audio/ogg;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        options.mimeType = 'audio/mp4';
      }

      mediaRecorderRef.current = new MediaRecorder(stream, options);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorderRef.current.mimeType || 'audio/webm' });
        
        // Stop all track streams
        stream.getTracks().forEach(track => track.stop());

        // Process audio encryption and upload
        await processAndSendVoiceNote(audioBlob);
      };

      setIsRecording(true);
      recordingDurationRef.current = 0;
      setRecordingDuration(0);
      mediaRecorderRef.current.start(250);
      soundEngine.playVoiceRecordStart();

      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => {
          const next = prev + 1;
          recordingDurationRef.current = next;
          return next;
        });
      }, 1000);
    } catch (err) {
      console.error('Microphone access denied:', err);
      alert('Microphone access is required to record voice notes.');
    }
  };

  const isRecordingRef = useRef(isRecording);
  useEffect(() => {
    isRecordingRef.current = isRecording;
    window.__isChatraRecording = isRecording;
  }, [isRecording]);

  // Push history state 'recording' when voice recording is active
  useEffect(() => {
    if (isRecording) {
      if (window.history.state !== 'recording') {
        window.history.pushState('recording', '');
      }
    } else {
      if (window.history.state === 'recording') {
        window.__isPoppingRecording = true;
        window.history.back();
        setTimeout(() => {
          window.__isPoppingRecording = false;
        }, 100);
      }
    }
  }, [isRecording]);

  // Intercept native back gesture / popstate event while recording voice note
  useEffect(() => {
    const handleVoiceRecordingPopState = () => {
      if (isRecordingRef.current) {
        // Intercept back action: cancel recording cleanly without sending!
        stopRecording(false);
      }
    };

    window.addEventListener('popstate', handleVoiceRecordingPopState);
    return () => window.removeEventListener('popstate', handleVoiceRecordingPopState);
  }, []);

  // Cleanup voice recording on unmount or active contact change or page unload
  useEffect(() => {
    const cleanupRecording = () => {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.onstop = null; // null out onstop callback so it NEVER sends
        if (mediaRecorderRef.current.state !== 'inactive') {
          try {
            mediaRecorderRef.current.stop();
          } catch (e) {}
        }
        if (mediaRecorderRef.current.stream) {
          mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
        }
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };

    window.addEventListener('beforeunload', cleanupRecording);

    return () => {
      window.removeEventListener('beforeunload', cleanupRecording);
      cleanupRecording();
    };
  }, [activeContact?.username]);

  const stopRecording = (shouldSend = true) => {
    if (!mediaRecorderRef.current && !isRecording) return;
    
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
    }
    soundEngine.playVoiceRecordStop();
    
    if (!shouldSend) {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.onstop = null; // null out onstop callback so it NEVER sends
        if (mediaRecorderRef.current.state !== 'inactive') {
          try {
            mediaRecorderRef.current.stop();
          } catch (e) {}
        }
        if (mediaRecorderRef.current.stream) {
          mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
        }
      }
      setRecordingExitMode('cancel');
      setTimeout(() => {
        setIsRecording(false);
        setRecordingExitMode(null);
      }, 200);
    } else {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          if (mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.requestData();
          }
          mediaRecorderRef.current.stop();
        } catch (e) {
          console.error('Error stopping recorder:', e);
        }
      }
      setRecordingExitMode('send');
      setTimeout(() => {
        setIsRecording(false);
        setRecordingExitMode(null);
      }, 140);
    }
  };

  const processAndSendVoiceNote = async (audioBlob) => {
    if (!audioBlob || audioBlob.size === 0) {
      console.warn('Empty voice audio blob, skipping send.');
      return;
    }
    setIsSendingVoice(true);
    try {
      const token = currentUserToken || currentUser?.token || localStorage.getItem('chatra_token') || localStorage.getItem('token');
      if (!token) {
        throw new Error('User session token is missing. Please re-login.');
      }

      // 1. Read audio blob as ArrayBuffer
      const arrayBuffer = await audioBlob.arrayBuffer();

      // 2. Generate a one-time session key for AES-GCM
      const audioKey = await window.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );

      // 3. Encrypt audio data
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const encryptedAudioBuffer = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        audioKey,
        arrayBuffer
      );

      // 4. Convert encrypted audio to Base64
      const encryptedBase64 = bufferToBase64(encryptedAudioBuffer);

      // 5. Upload encrypted audio to server
      const mime = audioBlob.type || 'audio/webm';
      const extension = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'mp4' : 'webm';
      const { fileUrl } = await uploadEncryptedFile(`voice-note.${extension}`, encryptedBase64, token);

      // Save original voice blob in local IndexedDB so sender keeps voice note permanently
      try {
        setCachedMedia(fileUrl, audioBlob, mime);
      } catch (cacheErr) {
        console.warn('Cache write warning:', cacheErr);
      }

      // 6. Export session key to JWK
      const audioKeyJwk = await window.crypto.subtle.exportKey('jwk', audioKey);

      // 7. Send the voice note metadata encrypted
      const replyContext = replyingTo ? { 
        id: replyingTo.id, 
        sender: replyingTo.sender, 
        text: replyingTo.text,
        mediaType: replyingTo.mediaType || null,
        fileMetadata: replyingTo.fileMetadata || null
      } : null;

      const durationSec = Math.max(1, recordingDurationRef.current || recordingDuration || 1);

      await onSendMessage({
        type: 'voice',
        fileMetadata: {
          url: fileUrl,
          name: 'Voice Note',
          size: audioBlob.size,
          mimeType: mime,
          keyJwk: audioKeyJwk,
          iv: bufferToBase64(iv),
          duration: durationSec
        },
        replyTo: replyContext
      });
      setReplyingTo(null);
      soundEngine.playMessageSent();
    } catch (err) {
      console.error('Error sending voice note:', err);
      alert(`Failed to send encrypted voice note: ${err?.message || err}`);
    } finally {
      setIsSendingVoice(false);
    }
  };

  // ==========================================
  // Custom Voice Note Player (Decrypted local playback)
  // ==========================================
  const togglePlayAudio = useCallback(async (msgId, fileMetadata, seekPercentage = null, forceAutoPlay = null) => {
    // 1. If this message is ALREADY loaded into activeAudioRef.current:
    if (activeAudioMsgIdRef.current === msgId && activeAudioRef.current) {
      const audio = activeAudioRef.current;
      const duration = audio.duration || fileMetadata?.duration || 0;

      // Handle seeking
      if (seekPercentage !== null && duration > 0) {
        const newTime = seekPercentage * duration;
        if (!isNaN(newTime)) {
          audio.currentTime = newTime;
          setAudioProgress(prev => ({ ...prev, [msgId]: (newTime / duration) * 100 }));
        }
      }

      // Handle Play / Pause action
      const shouldPlay = forceAutoPlay !== null ? forceAutoPlay : audio.paused;
      if (shouldPlay) {
        audio.play().then(() => {
          setPlayingAudioId(msgId);
        }).catch(console.error);
      } else {
        audio.pause();
        setPlayingAudioId(null);
      }
      return;
    }

    // 2. If clicking play or seeking on a NEW audio message:
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      if (activeAudioUrlRef.current) {
        URL.revokeObjectURL(activeAudioUrlRef.current);
        activeAudioUrlRef.current = null;
      }
    }

    try {
      // Fetch and decrypt audio blob
      const blob = await loadOrFetchDecryptedMedia(fileMetadata);
      const localUrl = URL.createObjectURL(blob);
      activeAudioUrlRef.current = localUrl;
      activeAudioMsgIdRef.current = msgId;

      const audio = new Audio(localUrl);
      activeAudioRef.current = audio;

      audio.ontimeupdate = () => {
        if (audio.duration) {
          const progress = (audio.currentTime / audio.duration) * 100;
          setAudioProgress(prev => ({ ...prev, [msgId]: progress }));
        }
      };

      audio.onended = () => {
        setPlayingAudioId(null);
        setAudioProgress(prev => ({ ...prev, [msgId]: 0 }));
      };

      audio.playbackRate = playbackRate;

      const duration = fileMetadata?.duration || 0;
      const initialProgress = audioProgress[msgId] || (seekPercentage !== null ? seekPercentage * 100 : 0);
      const startPct = seekPercentage !== null ? seekPercentage : (initialProgress / 100);

      audio.onloadedmetadata = () => {
        const actualDuration = audio.duration || duration;
        if (startPct > 0 && actualDuration > 0) {
          audio.currentTime = startPct * actualDuration;
        }
      };

      setAudioProgress(prev => ({
        ...prev,
        [msgId]: startPct * 100
      }));

      const startPlayback = forceAutoPlay !== null ? forceAutoPlay : (seekPercentage === null);
      if (startPlayback) {
        setPlayingAudioId(msgId);
        audio.play().catch(console.error);
      } else {
        setPlayingAudioId(null);
      }
    } catch (err) {
      console.error('Voice note error:', err);
      if (err.message && (err.message.includes('404') || err.message.includes('expired') || err.message.includes('Failed to fetch'))) {
        alert('This voice note is no longer available on the server (expired or deleted).');
      } else {
        alert('Failed to decrypt and play voice note.');
      }
    }
  }, [playbackRate, audioProgress]);

  const handlePlaybackRateChange = useCallback((newRate) => {
    setPlaybackRate(newRate);
    if (activeAudioRef.current) {
      activeAudioRef.current.playbackRate = newRate;
    }
  }, []);

  // Format voice note timer: MM:SS
  const formatTime = (secs) => {
    if (isNaN(secs) || secs < 0) return "0:00";
    const mins = Math.floor(secs / 60);
    const remainder = Math.floor(secs % 60);
    return `${mins}:${remainder.toString().padStart(2, '0')}`;
  };

  // Render message bubble content based on message type
  const renderMessageContent = useCallback((msg, isLast) => {
    const isSent = msg.sender?.toLowerCase() !== activeContact?.username?.toLowerCase();

    if (msg.isAlbum) {
      return (
        <div className="media-container media-album-container">
          <MediaAlbumGrid 
            albumItems={msg.albumItems} 
            onImageClick={onImageClick} 
            selectionMode={selectionModeRef.current} 
            isLast={isLast}
            handleImageLoad={handleImageLoad}
          />
          {msg.text && <p className="media-caption">{renderFormattedText(msg.text)}</p>}
        </div>
      );
    }

    if (msg.isMultiFile) {
      return (
        <div className="multi-file-card">
          {msg.fileItems.map((item, idx) => {
            const file = item.fileMetadata || {};
            const fileName = file.name || file.fileName || file.filename || 'Document';
            const fileSizeStr = file.size ? `${(file.size / 1024).toFixed(1)} KB` : 'File';
            return (
              <div key={item.id || idx} className="file-attachment-row">
                <FileText size={22} className="file-icon" />
                <div className="file-info">
                  <span className="file-name" title={fileName}>{fileName}</span>
                  <span className="file-size">{fileSizeStr}</span>
                </div>
                <button 
                  className="file-download-btn" 
                  onClick={() => downloadAndDecryptFile(file)}
                  title="Download & Decrypt File"
                  aria-label="Download & Decrypt File"
                >
                  <Download size={14} />
                </button>
              </div>
            );
          })}
          {msg.text && <p className="media-caption">{renderFormattedText(msg.text)}</p>}
        </div>
      );
    }

    if (msg.mediaType === 'file') {
      const file = msg.fileMetadata || {};
      const isImage = file.mimeType?.startsWith('image/');
      const isVideo = file.mimeType?.startsWith('video/');

      let element;
      if (isImage) {
        element = (
          <div className="image-message-wrapper">
            <ImagePreviewLoader fileMetadata={file} onImageClick={onImageClick ? (src) => {
              if (!selectionModeRef.current) onImageClick(src);
            } : undefined} onImageLoad={isLast ? handleImageLoad : undefined} />
          </div>
        );
      } else if (isVideo) {
        element = <VideoPreviewLoader fileMetadata={file} />;
      } else {
        const fileName = file.name || file.fileName || file.filename || 'Document';
        const fileSizeStr = file.size ? `${(file.size / 1024).toFixed(1)} KB` : 'File';
        element = (
          <div className="file-attachment-card">
            <FileText size={22} className="file-icon" />
            <div className="file-info">
              <span className="file-name" title={fileName}>{fileName}</span>
              <span className="file-size">{fileSizeStr}</span>
            </div>
            <button 
              className="file-download-btn" 
              onClick={() => downloadAndDecryptFile(file)}
              title="Download & Decrypt File"
              aria-label="Download & Decrypt File"
            >
              <Download size={14} />
            </button>
          </div>
        );
      }

      return (
        <div className="media-container">
          {element}
          {msg.text && <p className="media-caption">{renderFormattedText(msg.text)}</p>}
        </div>
      );
    }

    if (msg.mediaType === 'voice') {
      const file = msg.fileMetadata;
      const isPlaying = playingAudioId === msg.id;
      const progress = audioProgress[msg.id] || 0;
      const totalDuration = file.duration || 0;

      // Compute display time: current position if active audio is loaded, else progress ratio * totalDuration
      const currentTimeSec = (activeAudioMsgIdRef.current === msg.id && activeAudioRef.current)
        ? activeAudioRef.current.currentTime
        : (progress / 100) * totalDuration;

      return (
        <div className="voice-note-player-compact">
          <VoiceNotePreloader fileMetadata={file} />
          {/* Row 1 (Top): Circular Play Button + Progress Scrubber Track */}
          <div className="voice-row-top">
            <button 
              className="play-pause-btn-compact" 
              onClick={() => { if (!selectionModeRef.current) togglePlayAudio(msg.id, file); }}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" style={{ marginLeft: '1.5px' }} />}
            </button>

            <div className="voice-slider-container">
              <input 
                type="range"
                className="voice-slider"
                min="0"
                max="100"
                step="0.1"
                value={progress}
                onChange={(e) => {
                  const seekPct = parseFloat(e.target.value) / 100;
                  if (!selectionModeRef.current) togglePlayAudio(msg.id, file, seekPct, false);
                }}
                style={{
                  background: `linear-gradient(to right, var(--accent-color) ${progress}%, rgba(255, 255, 255, 0.15) ${progress}%)`
                }}
              />
            </div>
          </div>

          {/* Row 2 (Bottom): Duration (Left) + Speed & Timestamp (Right) */}
          <div className="voice-row-bottom">
            <span className="voice-duration">
              {formatTime(currentTimeSec)} / {formatTime(totalDuration)}
            </span>
            <div className="voice-bottom-right">
              <button 
                className="voice-speed-btn" 
                title={`Playback speed ${playbackRate}x`}
                aria-label={`Playback speed ${playbackRate}x`}
                onClick={(e) => {
                  e.stopPropagation();
                  const nextRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
                  handlePlaybackRateChange(nextRate);
                }}
              >
                {playbackRate}x
              </button>
              <span className="voice-inline-meta">
                <span className="inline-meta-time">{formatMessageTime(msg.timestamp)}</span>
                {isSent && (
                  <span className="inline-meta-ticks">
                    {msg.status === 0 && <span className="tick-single">✓</span>}
                    {msg.status === 1 && <span className="tick-delivered">✓✓</span>}
                    {msg.status === 2 && <span className="tick-read">✓✓</span>}
                  </span>
                )}
              </span>
            </div>
          </div>
        </div>
      );
    }
    if (msg.mediaType === 'call') {
      let callData = { callType: 'voice', status: 'completed', duration: 0 };
      try {
        callData = JSON.parse(msg.text);
      } catch (err) {
        // Fallback
      }

      const isVoice = callData.callType === 'voice';
      const status = callData.status;
      const isSentByMe = msg.sender !== activeContact.username;
      
      const isMissedOrCancelled = status === 'cancelled' || status === 'missed' || status === 'declined';

      let statusText = '';
      if (isSentByMe) {
        if (status === 'completed') {
          statusText = `Outgoing ${isVoice ? 'Voice' : 'Video'} Call`;
        } else if (status === 'cancelled') {
          statusText = 'Cancelled Call';
        } else {
          statusText = 'Declined Call';
        }
      } else {
        if (status === 'completed') {
          statusText = `Incoming ${isVoice ? 'Voice' : 'Video'} Call`;
        } else if (status === 'cancelled') {
          statusText = `Missed ${isVoice ? 'Voice' : 'Video'} Call`;
        } else {
          statusText = `Missed ${isVoice ? 'Voice' : 'Video'} Call`;
        }
      }

      const formatCallDuration = (secs) => {
        const mins = Math.floor(secs / 60);
        const remainder = secs % 60;
        return `${mins}:${remainder.toString().padStart(2, '0')}`;
      };

      const iconClass = isMissedOrCancelled ? 'missed' : 'completed';
      
      return (
        <div className="call-log-card">
          <div className={`call-log-icon-container ${iconClass}`}>
            {isVoice ? (
              isMissedOrCancelled ? <PhoneOff size={16} /> : <Phone size={16} />
            ) : (
              isMissedOrCancelled ? <VideoOff size={16} /> : <Video size={16} />
            )}
          </div>
          <div className="call-log-details">
            <span className="call-log-title">{statusText}</span>
            {status === 'completed' && (
              <span className="call-log-subtitle">Duration: {formatCallDuration(callData.duration)}</span>
            )}
          </div>
        </div>
      );
    }
    // Render emoji-only response inside quoted reply bubble
    if (msg.replyTo && isOnlyEmoji(msg.text)) {
      return <div className="reply-emoji-body">{msg.text}</div>;
    }
    // Default plaintext
    return renderFormattedText(msg.text);
  }, [playingAudioId, audioProgress, playbackRate, downloadAndDecryptFile, togglePlayAudio, handlePlaybackRateChange, onImageClick, activeContact?.username]);

  return (
    <div className={`chat-area ${isNavigatingBack ? 'navigating-back' : ''}`}>
      {/* Header */}
      <div className="chat-header glass">
        <div className="chat-header-info">
          <button className={`back-btn ${selectionMode ? 'selection-back-btn' : ''}`} onClick={handleChatBack} title={selectionMode ? 'Cancel selection' : 'Back to menu'} aria-label={selectionMode ? 'Cancel selection' : 'Back to menu'}>
            <div className="btn-icon-wrapper" key={selectionMode ? 'cancel-icon' : 'back-icon'}>
              {selectionMode ? <X size={18} /> : <ArrowLeft size={18} />}
            </div>
          </button>
          {renderAvatar(activeContact.username, activeContact.customName || activeContact.displayName, activeContact.avatarIcon)}
          <div className="chat-header-name">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeContact.customName || activeContact.displayName || activeContact.username}
              </span>
              {activeContact.isVerified && <ShieldCheck size={15} style={{ color: 'var(--accent-color)', flexShrink: 0 }} title="Verified Identity" />}
            </h2>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
              <span style={{ fontFamily: 'monospace' }}>@{activeContact.username}</span>
              <span>•</span>
              <span className={`chat-header-status ${activeContact.status === 'online' ? 'online' : ''}`}>
                {activeContact.status === 'online' ? 'Online' : 'Offline'}
              </span>
            </span>
          </div>
        </div>
        <div className={`chat-header-actions ${selectionMode ? 'selection-header-actions' : ''}`}>
          {selectionMode ? (
            <>
              <span className="selection-count-label" aria-label={`${selectionCount} selected`}>
                <span key={selectionCount} className="selection-count-number">{selectionCount}</span>
              </span>
              {selectionCount === 1 && selectionCanCopy && (
                <button 
                  className="header-action-btn selection-copy-header-btn" 
                  onClick={() => selectionCancelRef.current?.copy?.()} 
                  title="Copy text" 
                  aria-label="Copy text"
                >
                  <Copy size={19} />
                </button>
              )}
              <button className="header-action-btn selection-delete-header-btn" onClick={() => selectionCancelRef.current?.delete?.()} title="Delete selected messages" aria-label="Delete selected messages"><Trash2 size={20} /></button>
            </>
          ) : (
            <>
              <button 
                className="header-action-btn" 
                onClick={() => onInitiateCall('voice')}
                title="Secure Voice Call"
                aria-label="Secure Voice Call"
              >
                <Phone size={19} />
              </button>
              <button 
                className="header-action-btn" 
                onClick={() => onInitiateCall('video')}
                title="Secure Video Call"
                aria-label="Secure Video Call"
              >
                <Video size={19} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Unsaved contact warning banner with smooth pill animation */}
      {activeContact?.isSaved === false && dismissedBannerUser !== activeContact.username && (
        <div className={`unsaved-contact-banner glass ${isBannerDismissing ? 'dismissing' : ''}`}>
          <div className="banner-info">
            <AlertTriangle size={15} className="warning-icon" />
            <span>
              <strong>@{activeContact.username}</strong> is not in your contacts.
            </span>
          </div>
          <div className="banner-actions">
            <button 
              className="banner-btn add-btn"
              onClick={() => handleSaveContactWithAnimation(activeContact.username)}
            >
              Add Chat
            </button>
            <button 
              className="banner-btn block-btn"
              onClick={() => handleBlockContactWithAnimation(activeContact.username)}
            >
              Block
            </button>
          </div>
        </div>
      )}

      <div 
        className="messages-container" 
        key={activeContact.username} 
        ref={messagesContainerRef} 
        onScroll={handleScroll}
      >
        <div className="messages-bounce-wrapper" ref={messagesBounceWrapperRef}>
          <div className="e2ee-banner">
            <Shield size={14} />
            <span>Messages and media are end-to-end encrypted. No one else, not even Chatra, can read them.</span>
          </div>

          <MessageList
            messages={activeContact.messages}
            activeContactUsername={activeContact.username}
            activeContactIsTyping={activeContact.isTyping}
            justReceivedId={justReceivedId}
            lastMessageRef={lastMessageRef}
            typingBubbleRef={typingBubbleRef}
            scrollToMessage={scrollToMessage}
            setReplyingTo={setReplyingTo}
            textareaRef={textareaRef}
            renderMessageContent={renderMessageContent}
            onDeleteMessages={onDeleteMessages}
            selectionCancelRef={selectionCancelRef}
            onSelectionModeChange={handleSelectionModeChange}
          />
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input controls */}
      <div className="chat-input-wrapper">
        {/* Floating Scroll-to-Bottom Button / Typing Indicator */}
        <button 
          className={`scroll-to-bottom-btn glass ${((isScrolledUp || !isLastMessageVisible) && !isInlineTypingVisible) ? 'visible' : ''} ${(activeContact.isTyping && !isInlineTypingVisible) ? 'typing-active' : ''}`} 
          onClick={scrollToBottom} 
          title="Scroll to bottom"
          aria-label="Scroll to bottom"
        >
          <div className="scroll-btn-content">
            <span className="typing-text-wrapper">
              {activeContact.username} is typing...
            </span>
            <ArrowDown size={18} className={activeContact.isTyping ? 'typing-arrow-bounce' : ''} />
          </div>
          {localUnreadCount > 0 && (
            <span className="scroll-unread-badge">
              {localUnreadCount}
            </span>
          )}
        </button>
        
        {/* Floating Reply Preview Pill */}
        <div className={`reply-preview-bar ${(replyingTo || isClosingReply) ? 'glass visible' : ''} ${isClosingReply ? 'is-exiting' : ''}`}>
          {activeReplyInfo && (
            <div className="reply-preview-inner">
              <div className="reply-preview-left">
                {activeReplyInfo.mediaType === 'file' && activeReplyInfo.fileMetadata?.mimeType?.startsWith('image/') && (
                  <div className="reply-image-thumbnail">
                    <ImagePreviewLoader fileMetadata={activeReplyInfo.fileMetadata} />
                  </div>
                )}
                <div className="reply-preview-text-block">
                  <div className="reply-preview-badge-row">
                    <CornerUpLeft size={13} className="reply-preview-icon" />
                    <span className="reply-preview-label">Replying to {activeReplyInfo.sender}</span>
                  </div>
                  <span className="reply-preview-text">
                    {activeReplyInfo.mediaType === 'file' && activeReplyInfo.fileMetadata?.mimeType?.startsWith('image/')
                      ? 'Photo'
                      : activeReplyInfo.text
                    }
                  </span>
                </div>
              </div>
              <button 
                className="reply-preview-close" 
                onClick={(e) => {
                  e.currentTarget.blur();
                  handleCancelReplyWithAnimation();
                }} 
                title="Cancel reply" 
                aria-label="Cancel reply"
              >
                <X size={15} />
              </button>
            </div>
          )}
        </div>
        
        {/* Upload & Encryption Progress Floating Overlay */}
        {uploadProgress && (
          <div className="upload-progress-banner glass">
            <div className="upload-progress-header">
              <div className="upload-progress-icon-badge">
                <Loader2 size={15} className="spinner-rotating" />
              </div>
              <div className="upload-progress-text">
                <div className="upload-progress-title-row">
                  <span className="upload-progress-title">{uploadProgress.filename}</span>
                  {uploadProgress.total > 1 && (
                    <span className="upload-progress-counter">
                      ({uploadProgress.current}/{uploadProgress.total})
                    </span>
                  )}
                </div>
                <span className="upload-progress-status">{uploadProgress.status}</span>
              </div>
              <div className="upload-progress-percent-badge">
                {uploadProgress.percent !== null ? `${Math.round(uploadProgress.percent)}%` : ''}
              </div>
            </div>
            <div className="upload-progress-track">
              <div 
                className={`upload-progress-fill ${uploadProgress.percent === null ? 'indeterminate' : ''}`}
                style={uploadProgress.percent !== null ? { width: `${Math.min(100, Math.max(8, uploadProgress.percent))}%` } : {}}
              />
            </div>
          </div>
        )}

        {/* Floating Attachment Preview Pill */}
        <div className={`attachment-preview-bar ${(selectedFiles.length > 0 || isClearingFiles) ? 'glass visible' : ''} ${isClearingFiles ? 'is-exiting' : ''}`}>
          {(selectedFiles.length > 0 || isClearingFiles) && (
            <div className="attachment-preview-inner">
              <div 
                className="multi-file-preview-container"
                onWheel={(e) => {
                  if (e.deltaY !== 0) {
                    e.currentTarget.scrollLeft += e.deltaY;
                  }
                }}
              >
                {selectedFiles.map((file, idx) => (
                  <div key={`${file.name}-${idx}`} className={`file-preview-pill ${removingFileIndex === idx ? 'is-removing' : ''}`}>
                    {file.type?.startsWith('image/') ? <Image size={13} /> : <FileText size={13} />}
                    <span className="file-pill-name">{file.name}</span>
                    <button 
                      className="remove-pill-btn" 
                      onClick={() => handleRemoveSingleFileWithAnimation(idx)}
                      title="Remove file"
                      aria-label="Remove file"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <button 
                className="clear-all-files-btn" 
                onClick={handleClearAllFilesWithAnimation}
                title="Clear all attachments"
              >
                <span>Clear All</span>
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>

        {/* Separated Pill-Style Input Controls */}
        <div className="chat-input-row">
          <input
            type="file"
            id="file-input"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />

          {/* 1. Left: Separated Media Attachment Pill Button */}
          <div className={`input-action-pill-wrapper attach-pill-wrapper ${(isRecording && !recordingExitMode) ? 'is-hidden' : ''}`}>
            {(showAttachMenu || isClosingAttachMenu) && !isRecording && (
              <div ref={attachMenuRef} className={`attach-menu-popover glass ${isClosingAttachMenu ? 'is-closing' : ''}`}>
                <div className="attach-menu-header">
                  <span>Share Media & Files</span>
                </div>
                <div className="attach-menu-options">
                  <button 
                    className="attach-menu-item"
                    onClick={() => openFilePicker('image/*,video/*')}
                  >
                    <div className="attach-icon-badge photos">
                      <Image size={18} />
                    </div>
                    <div className="attach-item-text">
                      <span className="attach-title">Photos & Videos</span>
                      <span className="attach-desc">Share images or video clips</span>
                    </div>
                  </button>

                  <button 
                    className="attach-menu-item"
                    onClick={() => openFilePicker('.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar,.7z,.tar,.gz,.csv,.json,.apk')}
                  >
                    <div className="attach-icon-badge document">
                      <FileText size={18} />
                    </div>
                    <div className="attach-item-text">
                      <span className="attach-title">Document</span>
                      <span className="attach-desc">Share documents, PDFs, or archives</span>
                    </div>
                  </button>

                  <button 
                    className="attach-menu-item"
                    onClick={() => openFilePicker('audio/*')}
                  >
                    <div className="attach-icon-badge audio">
                      <Music size={18} />
                    </div>
                    <div className="attach-item-text">
                      <span className="attach-title">Audio & Music</span>
                      <span className="attach-desc">Share audio tracks or sound</span>
                    </div>
                  </button>

                  <button 
                    className="attach-menu-item"
                    onClick={() => openFilePicker('image/*', 'environment')}
                  >
                    <div className="attach-icon-badge camera">
                      <Camera size={18} />
                    </div>
                    <div className="attach-item-text">
                      <span className="attach-title">Camera</span>
                      <span className="attach-desc">Capture a photo or selfie</span>
                    </div>
                  </button>
                </div>
              </div>
            )}

            <button 
              ref={attachBtnRef}
              className={`input-circle-btn attach-btn ${showAttachMenu ? 'active-menu' : ''}`}
              onClick={() => showAttachMenu ? closeAttachMenu() : setShowAttachMenu(true)}
              title={showAttachMenu ? "Cancel media sharing" : "Share media or files"}
              aria-label={showAttachMenu ? "Cancel media sharing" : "Share media or files"}
              disabled={isRecording || uploading}
            >
              <Plus size={20} strokeWidth={2.5} />
            </button>
          </div>

            {/* 2. Center: Dedicated Pill-Shaped Typing Bar */}
            <div className={`chat-input-pill ${(selectedFiles.length > 0 || replyingTo) ? 'with-preview' : ''} ${(isRecording && !recordingExitMode) ? 'is-recording-mode' : ''} glass`}>
              {isRecording ? (
                <div className={`recording-banner ${recordingExitMode ? `is-exiting-${recordingExitMode}` : ''}`}>
                  <div className="recording-indicator">
                    <div className="recording-dot" />
                    <span className="recording-timer">{formatTime(recordingDuration)}</span>
                  </div>
                  <div className="recording-waveform-bars">
                    <span className="wave-bar bar-1" />
                    <span className="wave-bar bar-2" />
                    <span className="wave-bar bar-3" />
                    <span className="wave-bar bar-4" />
                    <span className="wave-bar bar-5" />
                  </div>
                  <button 
                    className="recording-cancel-btn" 
                    onClick={() => stopRecording(false)} 
                    title="Cancel recording" 
                    aria-label="Cancel recording"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ) : (
                <>
                  <textarea
                    ref={textareaRef}
                    className="message-textarea"
                    placeholder="Message"
                    value={inputText}
                    onChange={handleTextareaChange}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    disabled={uploading}
                  />
                  <button
                    ref={emojiBtnRef}
                    type="button"
                    className={`input-emoji-btn ${showEmojiPicker ? 'active' : ''}`}
                    onClick={toggleEmojiPicker}
                    title={showEmojiPicker ? "Close emoji picker" : "Choose an emoji"}
                    aria-label="Choose an emoji"
                  >
                    <Smile size={20} />
                  </button>
                </>
              )}
            </div>

            {/* Apple Emoji Picker Popover */}
            {(showEmojiPicker || isClosingEmojiPicker) && (
              <div 
                ref={emojiPickerRef} 
                className={`apple-emoji-popover-wrapper ${isClosingEmojiPicker ? 'is-closing' : ''}`}
              >
                <AppleEmojiPicker 
                  onSelectEmoji={handleInsertEmoji} 
                  onDelete={handleDeleteChar}
                  onClose={closeEmojiPicker}
                />
              </div>
            )}

          {/* 3. Right: Separated Action Pill Button (Mic / Send / Loading) */}
          <div className="input-action-pill-wrapper">
            {isSendingVoice ? (
              <button 
                className="input-circle-btn send-btn voice-sending-active" 
                disabled 
                title="Encrypting & sending voice note..."
                aria-label="Encrypting & sending voice note..."
              >
                <Loader2 size={18} className="spinner-rotating" />
              </button>
            ) : uploading ? (
              <button 
                className="input-circle-btn send-btn uploading-active" 
                disabled 
                title="Encrypting & sending payload..."
                aria-label="Encrypting & sending payload..."
              >
                <Loader2 size={18} className="spinner-rotating" />
              </button>
            ) : isRecording ? (
              <button 
                className={`input-circle-btn send-btn voice-send ${recordingExitMode === 'send' ? 'is-sending-blink' : ''}`}
                onClick={() => stopRecording(true)} 
                title="Stop and send voice note"
                aria-label="Stop and send voice note"
              >
                <ArrowUp size={18} strokeWidth={2.5} />
              </button>
            ) : (inputText.trim() || selectedFiles.length > 0) ? (
              <button 
                className="input-circle-btn send-btn send-active" 
                onPointerDown={(e) => {
                  // Prevent focus transfer away from textarea to keep keyboard up
                  e.preventDefault();
                }}
                onClick={() => {
                  handleSendMessage();
                }} 
                disabled={(!inputText.trim() && selectedFiles.length === 0) || uploading}
                title="Send Encrypted Message"
                aria-label="Send Encrypted Message"
              >
                <ArrowUp size={18} strokeWidth={2.8} />
              </button>
            ) : (
              <button 
                className="input-circle-btn mic-btn"
                onClick={startRecording}
                title="Record voice note"
                aria-label="Record voice note"
                disabled={uploading}
              >
                <Mic size={19} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default ChatArea;

// ==========================================
// Helper component: Decrypted image loader
// ==========================================
// Creates a downscaled lightweight canvas thumbnail blob for in-chat message previews
const createThumbnailBlob = (blob, maxDimension = 480) => {
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
const globalMediaSessionCache = new Map();

function ImagePreviewLoader({ fileMetadata, onImageClick, onImageLoad, isFullRes = false }) {
  const fileUrl = fileMetadata?.url;
  
  const [imgSrc, setImgSrc] = useState(() => {
    if (!fileUrl) return null;
    const memoryUrl = getMemoryMediaUrl(fileUrl, isFullRes);
    if (memoryUrl) return memoryUrl;
    if (globalMediaSessionCache.has(fileUrl)) {
      const cached = globalMediaSessionCache.get(fileUrl);
      return isFullRes ? cached.fullUrl : cached.thumbUrl;
    }
    return null;
  });
  const [error, setError] = useState(null);
  const [isLoaded, setIsLoaded] = useState(() => {
    if (!fileUrl) return false;
    return Boolean(getMemoryMediaUrl(fileUrl, isFullRes) || globalMediaSessionCache.has(fileUrl));
  });
  const fullResUrlRef = useRef(
    fileUrl
      ? (getMemoryMediaUrl(fileUrl, true) || (globalMediaSessionCache.has(fileUrl) ? globalMediaSessionCache.get(fileUrl).fullUrl : null))
      : null
  );

  useEffect(() => {
    if (!fileUrl) return;

    const memoryUrl = getMemoryMediaUrl(fileUrl, isFullRes);
    if (memoryUrl) {
      setImgSrc(memoryUrl);
      fullResUrlRef.current = getMemoryMediaUrl(fileUrl, true) || memoryUrl;
      setIsLoaded(true);
      if (onImageLoad) onImageLoad();
      return;
    }

    // Instant hit from global session cache (0ms)
    if (globalMediaSessionCache.has(fileUrl)) {
      const cached = globalMediaSessionCache.get(fileUrl);
      setImgSrc(isFullRes ? cached.fullUrl : cached.thumbUrl);
      fullResUrlRef.current = cached.fullUrl;
      setIsLoaded(true);
      if (onImageLoad) onImageLoad();
      return;
    }

    let active = true;

    const loadAndDecrypt = async () => {
      try {
        const fullBlob = await loadOrFetchDecryptedMedia(fileMetadata);
        if (!active) return;
        
        const fullUrl = getMemoryMediaUrl(fileUrl, true) || URL.createObjectURL(fullBlob);

        // Downscale for in-chat message bubble preview
        const thumbBlob = await createThumbnailBlob(fullBlob, 480);
        if (!active) return;

        const thumbUrl = (thumbBlob === fullBlob) ? fullUrl : URL.createObjectURL(thumbBlob);

        const cacheEntry = { fullUrl, thumbUrl };
        globalMediaSessionCache.set(fileUrl, cacheEntry);
        setCachedMedia(fileUrl, fullBlob, fileMetadata.mimeType, thumbBlob);

        fullResUrlRef.current = fullUrl;
        setImgSrc(isFullRes ? fullUrl : thumbUrl);
        setIsLoaded(true);
        if (onImageLoad) onImageLoad();
      } catch (err) {
        if (active) setError(err.message || 'Media loading failed');
      }
    };

    loadAndDecrypt();

    return () => {
      active = false;
    };
  }, [fileUrl, isFullRes]);

  if (error) return <span style={{ color: 'var(--text-muted, #a0aec0)', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', padding: '6px 10px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '6px' }}><AlertTriangle size={14} style={{ color: '#e53e3e' }} /> {error}</span>;

  return (
    <div className={`image-loader-container ${isLoaded ? 'is-ready' : 'is-decrypting'}`}>
      {/* Minimalist & Premium Media Decryption Loading Card */}
      {!isLoaded && (
        <div className="image-skeleton-loader">
          <div className="media-decrypt-spinner-badge">
            <div className="media-decrypt-spinner-ring" />
            <Shield size={16} className="media-decrypt-icon" />
          </div>
          {fileMetadata?.size && (
            <span className="media-decrypt-size-pill">
              {(fileMetadata.size / 1024).toFixed(0)} KB
            </span>
          )}
        </div>
      )}
      
      {/* Image tag with smooth blur-to-sharp cinematic crossfade */}
      {imgSrc && (
        <img 
          className={`message-image ${isLoaded ? 'loaded' : ''}`}
          src={imgSrc} 
          alt={fileMetadata.name} 
          decoding="async"
          onClick={onImageClick ? () => onImageClick(fullResUrlRef.current || imgSrc) : undefined}
          onLoad={() => {
            setIsLoaded(true);
            if (onImageLoad) onImageLoad();
          }}
          style={{
            cursor: onImageClick ? 'pointer' : 'default'
          }}
        />
      )}
    </div>
  );
}

// ==========================================
// Helper component: Decrypted video loader
// ==========================================
function VideoPreviewLoader({ fileMetadata }) {
  const [videoSrc, setVideoSrc] = useState(null);
  const [error, setError] = useState(false);
  const objectUrlRef = useRef(null);

  useEffect(() => {
    let active = true;

    const loadAndDecrypt = async () => {
      try {
        const blob = await loadOrFetchDecryptedMedia(fileMetadata);
        if (!active) return;
        const localUrl = URL.createObjectURL(blob);
        objectUrlRef.current = localUrl;
        setVideoSrc(localUrl);
      } catch (err) {
        console.error(err);
        if (active) setError(true);
      }
    };

    loadAndDecrypt();

    return () => {
      active = false;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [fileMetadata]);

  if (error) return <span style={{ color: 'var(--danger-color)', display: 'flex', alignItems: 'center', gap: '4px' }}><AlertTriangle size={14} /> Video Decryption Failed</span>;
  if (!videoSrc) return <span style={{ color: 'var(--text-subtle)' }}>Decrypting Video...</span>;
  return <video className="message-video" src={videoSrc} controls />;
}

// ==========================================
// Helper component: Background voice note pre-cache loader
// ==========================================
function VoiceNotePreloader({ fileMetadata }) {
  useEffect(() => {
    if (fileMetadata && fileMetadata.url) {
      loadOrFetchDecryptedMedia(fileMetadata).catch((err) => {
        console.warn('Voice note pre-cache warning:', err);
      });
    }
  }, [fileMetadata]);

  return null;
}
