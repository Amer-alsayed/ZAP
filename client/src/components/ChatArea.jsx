import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  Send, Shield, Phone, Video, Paperclip, Mic, X, Play, Pause, 
  FileText, Image, Video as VideoIcon, Download, AlertTriangle,
  ArrowLeft, CornerUpLeft, CornerUpRight, ArrowDown, PhoneOff, VideoOff, ArrowUp, Plus, ShieldCheck, Trash2, Camera, Music, Check, Copy, Ban, Unlock, Loader2,
  ChevronLeft, ChevronRight, Smile, Users, Info
} from 'lucide-react';
import AppleEmojiPicker from './AppleEmojiPicker';
import { uploadEncryptedFile } from '../services/api';
import { uploadManager, UploadCancelledError } from '../services/uploadManager';
import { bufferToBase64, base64ToBuffer } from '../services/crypto';
import { getSocket, emitGroupTyping } from '../services/socket';
import { renderAvatar } from './Sidebar';
import ZapLogo from './ZapLogo';
import { loadOrFetchDecryptedMedia, setCachedMedia, getMemoryMediaUrl, warmupMediaCache, inferMimeType } from '../services/mediaCache';
import { soundEngine } from '../services/soundEffects';
import CustomVideoPlayer from './CustomVideoPlayer';
import { useElasticBounce } from '../hooks/useElasticBounce';

import { 
  GROUP_SENDER_COLORS, 
  getMemberColor, 
  formatMessageTime, 
  shouldShowDateSeparator, 
  formatSeparatorDate, 
  isOnlyEmoji, 
  getEmojiCount, 
  audioProgressManager, 
  renderFormattedText, 
  groupMessagesWithAlbums, 
  prepareFileForSending 
} from '../utils/chatHelpers';
import { ImagePreviewLoader, VideoPreviewLoader, VoiceNotePreloader } from './MediaLoaders';
import AlbumGalleryModal from './AlbumGalleryModal';
import MediaAlbumGrid from './MediaAlbumGrid';
import VoiceNotePlayerItem from './VoiceNotePlayerItem';
import TypingIndicator from './TypingIndicator';

// ==========================================
// MessageList Component (Memoized for peak performance — isolated from typing)
// ==========================================
const MessageList = React.memo(({
  messages,
  activeContactUsername,
  lastMessageRef,
  scrollToMessage,
  setReplyingTo,
  textareaRef,
  renderMessageContent,
  onDeleteMessages,
  selectionCancelRef,
  onSelectionModeChange,
  setIsClosingReply,
  onForwardMessage,
  isGroupMode = false,
  myUsername = '',
  resolveSenderName = null,
  getGroupMemberInfo = null
}) => {
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [deletingIds, setDeletingIds] = useState([]);

  // Selection is per-conversation: clear it whenever the open chat changes
  useEffect(() => {
    setSelectedIds([]);
  }, [activeContactUsername]);
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
      selectionCancelRef.current = (isFromPopState = false) => {
        if (!isFromPopState && (window.history.state === 'selection' || window.history.state?.view === 'selection')) {
          window.__isProgrammaticPop = true;
          window.history.back();
          setTimeout(() => { window.__isProgrammaticPop = false; }, 100);
        }
        setSelectedIds([]);
      };
      selectionCancelRef.current.delete = () => {
        if (window.history.state === 'selection' || window.history.state?.view === 'selection') {
          window.__isProgrammaticPop = true;
          window.history.back();
          setTimeout(() => { window.__isProgrammaticPop = false; }, 100);
        }
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
          if (window.history.state === 'selection' || window.history.state?.view === 'selection') {
            window.__isProgrammaticPop = true;
            window.history.back();
            setTimeout(() => { window.__isProgrammaticPop = false; }, 100);
          }
          setSelectedIds([]);
        }
      };
      selectionCancelRef.current.reply = () => {
        if (selectedIds.length === 1) {
          const selId = selectedIds[0];
          const target = messages.find(m => m.id === selId) || groupedMessages.find(m => m.id === selId || (m.allIds && m.allIds.includes(selId)));
          const baseMsg = target ? (target.isAlbum ? target.albumItems[0] : target.isMultiFile ? target.fileItems[0] : target) : null;
          const txt = target ? (target.isAlbum ? `[${target.albumItems.length} Photos]` : target.isMultiFile ? `[${target.fileItems.length} Files]` : (target.mediaType === 'gif' ? 'GIF' : (target.mediaType ? `[${target.mediaType}]` : target.text))) : '';
          if (baseMsg || target) {
            const replyTarget = baseMsg || target;
            setIsClosingReply?.(false);
            if (window.history.state === 'selection' || window.history.state?.view === 'selection') {
              window.history.replaceState('reply', '');
            } else if (window.history.state !== 'reply') {
              window.history.pushState('reply', '');
            }
            setReplyingTo({
              id: replyTarget.id,
              sender: replyTarget.sender,
              text: txt,
              mediaType: replyTarget.mediaType || null,
              fileMetadata: replyTarget.fileMetadata || null
            });
            if (window.navigator && window.navigator.vibrate) try { window.navigator.vibrate(15); } catch (e) {}
            // Synchronously focus keyboard inside user gesture
            if (textareaRef && textareaRef.current) {
              try {
                textareaRef.current.focus();
                const len = textareaRef.current.value.length;
                textareaRef.current.setSelectionRange(len, len);
              } catch (e) {}
            }
          }
          setSelectedIds([]);
        }
      };
      selectionCancelRef.current.forward = () => {
        if (selectedIds.length !== 1 || typeof onForwardMessage !== 'function') return;
        const selId = selectedIds[0];
        const target = messages.find(m => m.id === selId) || groupedMessages.find(m => m.id === selId || (m.allIds && m.allIds.includes(selId)));
        const baseMsg = target ? (target.isAlbum ? target.albumItems[0] : target.isMultiFile ? target.fileItems[0] : target) : null;
        const forwardTarget = baseMsg || target;
        if (!forwardTarget || forwardTarget.mediaType === 'call') return;
        if (window.navigator && window.navigator.vibrate) try { window.navigator.vibrate(15); } catch (e) {}
        if (window.history.state === 'selection' || window.history.state?.view === 'selection') {
          window.__isProgrammaticPop = true;
          window.history.back();
          setTimeout(() => { window.__isProgrammaticPop = false; }, 100);
        }
        setSelectedIds([]);
        onForwardMessage(forwardTarget);
      };
    }
    return () => { if (selectionCancelRef) selectionCancelRef.current = null; };
  }, [selectionMode, selectedIds, selectedMsgForCopy, canCopySelected, onDeleteMessages, onSelectionModeChange, selectionCancelRef, messages, groupedMessages, setReplyingTo, textareaRef, setIsClosingReply, onForwardMessage]);

  useEffect(() => {
    if (selectionMode && window.history.state !== 'selection') {
      window.history.pushState('selection', '');
    }
  }, [selectionMode]);

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

  const handleMessageTouchStart = (msg, isSent, e) => {
    if (window.__isMediaModalOpen || selectionMode) return;
    // Only block swipe/long-press when interacting with drag sliders or specific control buttons (not the video surface or play button)
    if (e.target.closest('.voice-slider, .voice-slider-container, input[type="range"], .msg-action-btn, .message-actions-container, .album-gallery-modal-overlay, .system-call-log-card, .cvp-bottom-bar, .cvp-progress-wrap, .cvp-volume-slider, .file-download-btn, a')) {
      return;
    }
    
    startLongPress(msg);

    const touch = e.touches[0];
    const startX = touch.clientX;
    const startY = touch.clientY;
    const rowEl = e.currentTarget;
    const wrapper = rowEl?.querySelector('.message-wrapper');
    const indicator = wrapper?.querySelector('.swipe-reply-indicator');

    let isSwiping = false;
    let isScrolling = false;
    let currentOffset = 0;
    let hasTriggeredThresholdHaptic = false;
    let triggerThresholdMet = false;

    const onWindowTouchMove = (moveEvent) => {
      if (!moveEvent.touches || moveEvent.touches.length === 0) return;
      const currentTouch = moveEvent.touches[0];
      const deltaX = currentTouch.clientX - startX;
      const deltaY = currentTouch.clientY - startY;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      if (absX > 6 || absY > 6) {
        cancelLongPress();
      }

      if (!isSwiping && !isScrolling) {
        if (absX >= 7 && absX > absY) {
          isSwiping = true;
          cancelLongPress();
        } else if (absY >= 7 && absY >= absX) {
          isScrolling = true;
          cancelLongPress();
        }
      }

      if (isSwiping) {
        if (moveEvent.cancelable) {
          try { moveEvent.preventDefault(); } catch (err) {}
        }
        cancelLongPress();

        const dir = deltaX >= 0 ? 1 : -1;
        const rawMagnitude = Math.max(0, absX - 4);
        const clampedMagnitude = Math.min(rawMagnitude * 0.75, 68);
        currentOffset = clampedMagnitude * dir;

        if (wrapper) {
          wrapper.style.transition = 'none';
          wrapper.style.transform = `translate3d(${currentOffset}px, 0, 0)`;
          wrapper.style.willChange = 'transform';
        }

        if (indicator) {
          const threshold = 24;
          const progress = Math.min(clampedMagnitude / threshold, 1);
          indicator.style.transition = 'none';
          indicator.style.opacity = progress;

          if (dir < 0) {
            indicator.style.left = 'auto';
            indicator.style.right = '-34px';
          } else {
            indicator.style.left = '-34px';
            indicator.style.right = 'auto';
          }

          if (clampedMagnitude >= threshold) {
            triggerThresholdMet = true;
            indicator.style.transform = `translateY(-50%) scale(1.18)`;
            if (!hasTriggeredThresholdHaptic) {
              hasTriggeredThresholdHaptic = true;
              if (navigator.vibrate) try { navigator.vibrate(10); } catch (err) {}
            }
          } else {
            triggerThresholdMet = false;
            indicator.style.transform = `translateY(-50%) scale(${progress * 0.95})`;
            hasTriggeredThresholdHaptic = false;
          }
        }
      }
    };

    const cleanupListeners = () => {
      window.removeEventListener('touchmove', onWindowTouchMove, { passive: false });
      window.removeEventListener('touchend', onWindowTouchEnd);
      window.removeEventListener('touchcancel', onWindowTouchCancel);
    };

    const onWindowTouchEnd = () => {
      cleanupListeners();
      cancelLongPress();

      if (wrapper) {
        wrapper.style.transition = 'transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)';
        wrapper.style.transform = 'translate3d(0, 0, 0)';
        setTimeout(() => { if (wrapper) wrapper.style.willChange = 'auto'; }, 340);
      }
      if (indicator) {
        indicator.style.transition = 'opacity 0.22s ease, transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)';
        indicator.style.opacity = '0';
        indicator.style.transform = 'translateY(-50%) scale(0)';
      }

      if (isSwiping && triggerThresholdMet) {
        setIsClosingReply?.(false);
        const targetMsg = (msg.isAlbum || msg.isMultiFile) ? (msg.albumItems || msg.fileItems)[0] : msg;
        
        if (window.history.state !== 'reply') {
          window.history.pushState('reply', '');
        }

        setReplyingTo({
          id: targetMsg.id,
          sender: targetMsg.sender,
          text: msg.isAlbum ? `[${msg.albumItems.length} Photos]` : msg.isMultiFile ? `[${msg.fileItems.length} Files]` : (targetMsg.mediaType === 'gif' ? 'GIF' : (targetMsg.mediaType ? `[${targetMsg.mediaType}]` : msg.text)),
          mediaType: targetMsg.mediaType || null,
          fileMetadata: targetMsg.fileMetadata || null
        });

        if (navigator.vibrate) {
          try { navigator.vibrate(15); } catch (err) {}
        }

        // CRITICAL FOR MOBILE KEYBOARD: Focus textarea synchronously inside this direct user touchend tick!
        const inputEl = textareaRef?.current;
        if (inputEl) {
          try {
            inputEl.focus();
            const len = inputEl.value.length;
            inputEl.setSelectionRange(len, len);
          } catch (err) {}
        }
      }
    };

    const onWindowTouchCancel = () => {
      cleanupListeners();
      cancelLongPress();

      if (wrapper) {
        wrapper.style.transition = 'transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)';
        wrapper.style.transform = 'translate3d(0, 0, 0)';
        setTimeout(() => { if (wrapper) wrapper.style.willChange = 'auto'; }, 340);
      }
      if (indicator) {
        indicator.style.transition = 'opacity 0.22s ease, transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)';
        indicator.style.opacity = '0';
        indicator.style.transform = 'translateY(-50%) scale(0)';
      }
    };

    window.addEventListener('touchmove', onWindowTouchMove, { passive: false });
    window.addEventListener('touchend', onWindowTouchEnd, { passive: false });
    window.addEventListener('touchcancel', onWindowTouchCancel, { passive: false });
  };

  return (
    <div className="message-list">
      {groupedMessages && groupedMessages.map((msg, index) => {
        const isSent = isGroupMode
          ? String(msg.sender || '').toLowerCase() === String(myUsername || '').toLowerCase()
          : (msg.sender === activeContactUsername ? false : true);
        const showDateSeparator = shouldShowDateSeparator(groupedMessages, index);

        // Render group system events (joins, leaves, renames) as centered pills
        if (isGroupMode && msg.mediaType === 'system') {
          return (
            <React.Fragment key={msg.id}>
              {showDateSeparator && (
                <div className="date-separator">
                  <span>{formatSeparatorDate(msg.timestamp)}</span>
                </div>
              )}
              <div 
                id={`msg-${msg.id}`} 
                ref={index === groupedMessages.length - 1 ? lastMessageRef : null}
                className="system-call-log-container"
              >
                <div className="system-event-pill glass">
                  <Users size={11} />
                  <span className="system-event-text">{msg.text}</span>
                  <span className="system-call-bullet">•</span>
                  <span className="system-call-time">
                    {formatMessageTime(msg.timestamp)}
                  </span>
                </div>
              </div>
            </React.Fragment>
          );
        }

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
          const isSentByMe = isGroupMode
            ? String(msg.sender || '').toLowerCase() === String(myUsername || '').toLowerCase()
            : msg.sender.toLowerCase() !== activeContactUsername.toLowerCase();
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
                ref={index === groupedMessages.length - 1 ? lastMessageRef : null}
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
        // Date separators, system pills, and call logs must break sender grouping, otherwise a
        // message on a new day or following a system event from the same person hides its sender name and avatar
        const isGroupingBreaker = prevMsg && (prevMsg.mediaType === 'call' || prevMsg.mediaType === 'system');
        const isFirstOfGroup = !prevMsg || showDateSeparator || isGroupingBreaker || (prevMsg.sender?.toLowerCase() !== msg.sender?.toLowerCase());
        const isSelectedMsg = (msg.isAlbum || msg.isMultiFile) 
          ? msg.allIds.some(id => selectedIds.includes(id)) 
          : selectedIds.includes(msg.id);

        // Group attribution: colored name + gutter avatar for received messages
        const showAttribution = isGroupMode && !isSent && msg.mediaType !== 'system';
        const memberInfo = showAttribution && typeof getGroupMemberInfo === 'function'
          ? getGroupMemberInfo(msg.sender)
          : null;
        const senderColor = showAttribution ? getMemberColor(String(msg.sender || '')) : null;

        return (
          <React.Fragment key={msg.id}>
            {showDateSeparator && (
              <div className="date-separator">
                <span>{formatSeparatorDate(msg.timestamp)}</span>
              </div>
            )}
            <div 
              key={msg.id || `grouped-${index}`} 
              className={`message-row ${isSent ? 'sent' : 'received'} ${isFirstOfGroup ? 'is-first-of-group' : 'is-subsequent'} ${isSelectedMsg ? 'row-selected' : ''} ${((msg.isAlbum || msg.isMultiFile) ? msg.allIds.some(id => deletingIds.includes(id)) : deletingIds.includes(msg.id)) || msg.isDeleting ? 'is-deleting' : ''} ${msg.isCollapsing ? 'is-collapsing' : ''}`}
              data-msg-id={msg.id}
              data-timestamp={msg.timestamp}
              style={{ 
                '--msg-delay': staggerIndex
              }}
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
              onTouchStart={(e) => handleMessageTouchStart(msg, isSent, e)}
              onMouseDown={(e) => {
                if (window.__isMediaModalOpen || selectionMode || e.button !== 0) return;
                if (e.target.closest('.voice-slider, .voice-slider-container, input[type="range"], .msg-action-btn, .message-actions-container, .album-gallery-modal-overlay, .system-call-log-card, .cvp-bottom-bar, .cvp-progress-wrap, .cvp-volume-slider, .file-download-btn, a')) {
                  return;
                }
                startLongPress(msg);
              }}
              onMouseUp={() => {
                cancelLongPress();
              }}
              onMouseLeave={() => {
                cancelLongPress();
              }}
              onClick={() => {
                if (longPressTriggeredRef.current) {
                  longPressTriggeredRef.current = false;
                  return;
                }
                if (selectionMode) toggleSelected(msg);
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
                  >
                    {/* Swipe-to-reply spring indicator icon */}
                    <div 
                      className="swipe-reply-indicator"
                      style={{
                        opacity: 0,
                        transform: 'translateY(-50%) scale(0)',
                        pointerEvents: 'none'
                      }}
                    >
                      <CornerUpLeft size={16} color="var(--accent-color)" />
                    </div>
                    {/* Group chat sender attribution above the bubble */}
                    {showAttribution && isFirstOfGroup && (
                      <div className="group-sender-label" style={{ color: senderColor }}>
                        {typeof resolveSenderName === 'function' ? resolveSenderName(msg.sender) : msg.sender}
                      </div>
                    )}
                    {/* Telegram-style gutter avatar beside the first message of a cluster */}
                    {showAttribution && isFirstOfGroup && (
                      <div className="group-msg-avatar">
                        {renderAvatar(
                          memberInfo?.username || msg.sender,
                          memberInfo?.displayName,
                          memberInfo?.avatarIcon || null,
                          { width: '28px', height: '28px', fontSize: '11px' }
                        )}
                      </div>
                    )}
                      <div className={`message-bubble ${isSelectedMsg ? 'is-selected' : ''} ${msg.isAlbum ? 'album-bubble' : ''} ${msg.isMultiFile ? 'multifile-bubble' : ''} ${isOnlyEmojiMsg ? `emoji-only-bubble count-${emojiCount}` : ''} ${msg.mediaType === 'gif' ? 'gif-bubble' : ''} ${msg.mediaType === 'file' && msg.fileMetadata?.mimeType?.startsWith('image/') ? 'single-image-bubble' : ''} ${msg.mediaType === 'file' && msg.fileMetadata?.mimeType?.startsWith('video/') ? 'single-video-bubble' : ''}`}>
                        {isSelectedMsg && (
                          <div className="selection-indicator-badge" aria-hidden="true">
                            <Check size={12} strokeWidth={2.8} />
                          </div>
                        )}
                        {msg.forwarded && (
                          <span className="forwarded-tag" title="This message was forwarded">
                            <CornerUpRight size={10} /> Forwarded
                          </span>
                        )}
                        {!selectionMode && (
                          <div className="message-actions-container">
                            <button 
                              className="msg-action-btn" 
                              title="Reply"
                              aria-label="Reply to message"
                              onClick={() => {
                                const targetMsg = (msg.isAlbum || msg.isMultiFile) ? (msg.albumItems || msg.fileItems)[0] : msg;
                                setIsClosingReply?.(false);
                                if (window.history.state !== 'reply') {
                                  window.history.pushState('reply', '');
                                }
                                setReplyingTo({
                                  id: targetMsg.id,
                                  sender: targetMsg.sender,
                                  text: msg.isAlbum ? `[${msg.albumItems.length} Photos]` : msg.isMultiFile ? `[${msg.fileItems.length} Files]` : (targetMsg.mediaType === 'gif' ? 'GIF' : (targetMsg.mediaType ? `[${targetMsg.mediaType}]` : msg.text)),
                                  mediaType: targetMsg.mediaType || null,
                                  fileMetadata: targetMsg.fileMetadata || null
                                });
                                if (textareaRef.current) {
                                  textareaRef.current.focus();
                                  try {
                                    const len = textareaRef.current.value.length;
                                    textareaRef.current.setSelectionRange(len, len);
                                  } catch (e) {}
                                }
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
                            {msg.replyTo.mediaType === 'file' && msg.replyTo.fileMetadata?.mimeType?.startsWith('image/') ? (
                              <div className="reply-image-thumbnail">
                                <ImagePreviewLoader fileMetadata={msg.replyTo.fileMetadata} />
                              </div>
                            ) : msg.replyTo.mediaType === 'file' && msg.replyTo.fileMetadata?.mimeType?.startsWith('video/') ? (
                              <div className="reply-video-thumbnail">
                                <VideoIcon size={14} style={{ color: 'var(--accent-color)' }} />
                              </div>
                            ) : msg.replyTo.mediaType === 'gif' ? (
                              <div className="reply-image-thumbnail">
                                <img src={msg.replyTo.fileMetadata?.thumb || msg.replyTo.fileMetadata?.url || msg.replyTo.text} alt="GIF" style={{ width: '22px', height: '22px', objectFit: 'cover', borderRadius: '4px' }} />
                              </div>
                            ) : null}
                            <p className="reply-context-text">
                              {msg.replyTo.mediaType === 'file' && msg.replyTo.fileMetadata?.mimeType?.startsWith('image/')
                                ? 'Photo'
                                : msg.replyTo.mediaType === 'file' && msg.replyTo.fileMetadata?.mimeType?.startsWith('video/')
                                  ? 'Video'
                                  : msg.replyTo.mediaType === 'gif'
                                    ? 'GIF'
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
                        {msg.mediaType !== 'voice' && msg.mediaType !== 'gif' && (
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
  chatBackHandlerRef,
  onOpenSafetyModal,
  replyingTo,
  setReplyingTo,
  onForwardMessage,
  showToast,
  onOpenGroupInfo = null,
  getGroupMemberName = null
}) {
  const isGroupMode = Boolean(activeContact?.isGroup);

  // Resolve a member display name inside group chats (falls back to raw username)
  const resolveSenderName = useCallback((username) => {
    if (!username) return '';
    if (isGroupMode && typeof getGroupMemberName === 'function') {
      const lowerMe = currentUser?.username?.toLowerCase();
      if (String(username).toLowerCase() === lowerMe) return 'You';
      return getGroupMemberName(username) || username;
    }
    return username;
  }, [isGroupMode, getGroupMemberName, currentUser]);

  // Full member info (name + avatar) for group attribution rendering
  const getGroupMemberInfo = useCallback((username) => {
    if (!isGroupMode || !activeContact?.members) return null;
    const lower = String(username).toLowerCase();
    const member = activeContact.members.find(mm => mm.username.toLowerCase() === lower);
    if (!member) return null;
    return {
      username: member.username,
      displayName: member.profile?.displayName,
      avatarIcon: member.profile?.avatarIcon
    };
  }, [isGroupMode, activeContact?.members]);

  // Route typing events to the right channel (DM socket event or group room)
  const emitTypingState = useCallback((target, isTyping) => {
    const socket = getSocket();
    if (!socket || !socket.connected || !target) return;
    if (target.kind === 'group') {
      emitGroupTyping(target.id, isTyping);
    } else {
      socket.emit('typing', { recipient: target.id, isTyping });
    }
  }, []);

  const currentTypingTarget = useMemo(() => (
    activeContact
      ? (activeContact.isGroup ? { kind: 'group', id: activeContact.groupId } : { kind: 'dm', id: activeContact.username })
      : null
  ), [activeContact]);
  const notify = showToast || window.showAppToast || ((msg) => window.alert(msg));
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
    window.__isZapSelectionMode = active;
    window.__isChatraSelectionMode = active;
  };
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingExitMode, setRecordingExitMode] = useState(null); // 'cancel' | 'send' | null
  const [isSendingVoice, setIsSendingVoice] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [preparingFilesCount, setPreparingFilesCount] = useState(0);
  const [isClearingFiles, setIsClearingFiles] = useState(false);
  const [removingFileIndex, setRemovingFileIndex] = useState(null);
  const [isClosingReply, setIsClosingReply] = useState(false);
  // Upload state is owned by the module-level UploadManager so the progress
  // banner survives navigating away from (and back into) a chat.
  const [uploading, setUploadingState] = useState(uploadManager.getSnapshot().uploading);
  const [uploadProgress, setUploadProgressState] = useState(uploadManager.getSnapshot().progress); // { filename, current, total, status, percent }
  useEffect(() => uploadManager.subscribe((snapshot) => {
    setUploadingState(snapshot.uploading);
    setUploadProgressState(snapshot.progress);
  }), []);
  const setUploading = (value) => uploadManager.setUploading(value);
  const setUploadProgress = (progress) => uploadManager.setProgress(progress);

  const handleCancelUpload = () => {
    uploadManager.requestCancel();
  };

  // Refs for tracking back-navigation state without stale closures
  const isRecordingRef = useRef(false);
  useEffect(() => {
    isRecordingRef.current = isRecording;
    window.__isZapRecording = isRecording;
    window.__isChatraRecording = isRecording;
  }, [isRecording]);
  const stopRecordingRef = useRef(null);

  const replyingToRef = useRef(replyingTo);
  useEffect(() => {
    replyingToRef.current = replyingTo;
  }, [replyingTo]);
  const isClosingReplyRef = useRef(false);

  const selectedFilesRef = useRef(selectedFiles);
  useEffect(() => {
    selectedFilesRef.current = selectedFiles;
  }, [selectedFiles]);
  const preparingFilesCountRef = useRef(0);
  useEffect(() => {
    preparingFilesCountRef.current = preparingFilesCount;
  }, [preparingFilesCount]);
  const isClearingFilesRef = useRef(false);

  // Fullscreen interactive Album Gallery Modal state (Group of images)
  const [activeGalleryModal, setActiveGalleryModal] = useState(null);
  const [isClosingGalleryModal, setIsClosingGalleryModal] = useState(false);
  const activeGalleryRef = useRef(null);
  useEffect(() => {
    activeGalleryRef.current = activeGalleryModal;
  }, [activeGalleryModal]);
  const isClosingGalleryRef = useRef(false);

  const handleOpenGallery = useCallback((items, index = 0) => {
    setIsClosingGalleryModal(false);
    setActiveGalleryModal({ items, initialIndex: index });
    if (window.history.state !== 'gallery') {
      window.history.pushState('gallery', '');
    }
  }, []);

  const handleCloseGallery = useCallback((isFromPopState = false) => {
    if (isClosingGalleryRef.current || !activeGalleryRef.current) return;
    isClosingGalleryRef.current = true;
    setIsClosingGalleryModal(true);
    if (!isFromPopState && window.history.state === 'gallery') {
      window.__isProgrammaticPop = true;
      window.history.back();
      setTimeout(() => {
        window.__isProgrammaticPop = false;
      }, 100);
    }
    setTimeout(() => {
      setActiveGalleryModal(null);
      setIsClosingGalleryModal(false);
      isClosingGalleryRef.current = false;
    }, 250);
  }, []);

  // Warm up and pre-decode cached media for instant 0ms access across conversations
  useEffect(() => {
    if (activeContact?.messages?.length) {
      warmupMediaCache(activeContact.messages);
    }
  }, [activeContact?.username, activeContact?.messages]);

  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [isClosingAttachMenu, setIsClosingAttachMenu] = useState(false);
  const showAttachMenuRef = useRef(false);
  useEffect(() => {
    showAttachMenuRef.current = showAttachMenu;
  }, [showAttachMenu]);
  const isClosingAttachMenuRef = useRef(false);
  const attachMenuCloseTimerRef = useRef(null);
  const attachMenuRef = useRef(null);
  const attachBtnRef = useRef(null);

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isClosingEmojiPicker, setIsClosingEmojiPicker] = useState(false);
  const [hasMountedEmojiPicker, setHasMountedEmojiPicker] = useState(false);
  // Increments on every open so the picker remounts and re-reads the persisted
  // recents order (updates are deferred until close to avoid mid-session jumps).
  const [emojiPickerSession, setEmojiPickerSession] = useState(0);
  const showEmojiPickerRef = useRef(false);
  useEffect(() => {
    showEmojiPickerRef.current = showEmojiPicker;
  }, [showEmojiPicker]);
  const isClosingEmojiPickerRef = useRef(false);
  const emojiPickerCloseTimerRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const emojiBtnRef = useRef(null);

  const closeAttachMenu = useCallback((isFromPopState = false) => {
    if (!showAttachMenuRef.current || isClosingAttachMenuRef.current) return;
    setIsClosingAttachMenu(true);
    isClosingAttachMenuRef.current = true;
    if (!isFromPopState && (window.history.state === 'attach' || window.history.state?.view === 'attach')) {
      window.__isProgrammaticPop = true;
      window.history.back();
      setTimeout(() => {
        window.__isProgrammaticPop = false;
      }, 100);
    }
    if (attachMenuCloseTimerRef.current) clearTimeout(attachMenuCloseTimerRef.current);
    attachMenuCloseTimerRef.current = setTimeout(() => {
      setShowAttachMenu(false);
      setIsClosingAttachMenu(false);
      isClosingAttachMenuRef.current = false;
      attachMenuCloseTimerRef.current = null;
    }, 200);
  }, []);

  const cancelAttachMenuClose = useCallback(() => {
    if (attachMenuCloseTimerRef.current) {
      clearTimeout(attachMenuCloseTimerRef.current);
      attachMenuCloseTimerRef.current = null;
    }
    if (isClosingAttachMenuRef.current) {
      setIsClosingAttachMenu(false);
      isClosingAttachMenuRef.current = false;
    }
  }, []);

  const closeEmojiPicker = useCallback((isFromPopState = false) => {
    if (!showEmojiPickerRef.current || isClosingEmojiPickerRef.current) return;
    setIsClosingEmojiPicker(true);
    isClosingEmojiPickerRef.current = true;
    if (!isFromPopState && (window.history.state === 'emoji' || window.history.state?.view === 'emoji')) {
      window.__isProgrammaticPop = true;
      window.history.back();
      setTimeout(() => {
        window.__isProgrammaticPop = false;
      }, 100);
    }
    if (emojiPickerCloseTimerRef.current) clearTimeout(emojiPickerCloseTimerRef.current);
    emojiPickerCloseTimerRef.current = setTimeout(() => {
      setShowEmojiPicker(false);
      setIsClosingEmojiPicker(false);
      setHasMountedEmojiPicker(false);
      isClosingEmojiPickerRef.current = false;
      emojiPickerCloseTimerRef.current = null;
    }, 200);
  }, []);

  const cancelEmojiPickerClose = useCallback(() => {
    if (emojiPickerCloseTimerRef.current) {
      clearTimeout(emojiPickerCloseTimerRef.current);
      emojiPickerCloseTimerRef.current = null;
    }
    if (isClosingEmojiPickerRef.current) {
      setIsClosingEmojiPicker(false);
      isClosingEmojiPickerRef.current = false;
    }
  }, []);

  const toggleAttachMenu = useCallback(() => {
    if (showAttachMenu && !isClosingAttachMenu) {
      closeAttachMenu(false);
    } else {
      cancelAttachMenuClose();
      if (showEmojiPicker) closeEmojiPicker(false);
      setShowAttachMenu(true);
      if (window.history.state === 'emoji') {
        window.history.replaceState('attach', '');
      } else if (window.history.state !== 'attach') {
        window.history.pushState('attach', '');
      }
    }
  }, [showAttachMenu, isClosingAttachMenu, cancelAttachMenuClose, closeAttachMenu, showEmojiPicker, closeEmojiPicker]);

  const toggleEmojiPicker = useCallback(() => {
    if (showEmojiPicker && !isClosingEmojiPicker) {
      closeEmojiPicker(false);
    } else {
      setHasMountedEmojiPicker(true);
      setEmojiPickerSession(s => s + 1);
      cancelEmojiPickerClose();
      if (showAttachMenu) closeAttachMenu(false);
      setShowEmojiPicker(true);
      if (window.history.state === 'attach') {
        window.history.replaceState('emoji', '');
      } else if (window.history.state !== 'emoji') {
        window.history.pushState('emoji', '');
      }
    }
  }, [showEmojiPicker, isClosingEmojiPicker, cancelEmojiPickerClose, closeEmojiPicker, showAttachMenu, closeAttachMenu]);

  const adjustTextareaHeight = useCallback((el) => {
    if (!el) return;
    el.style.height = '38px';
    if (el.scrollHeight > 48) {
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  }, []);

  const handleInsertEmoji = useCallback((emoji) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setInputText(prev => prev + emoji);
      return;
    }
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    setInputText(prev => prev.substring(0, start) + emoji + prev.substring(end));
    soundEngine.playKeyboardTick?.();

    requestAnimationFrame(() => {
      textarea.focus();
      const newPos = start + emoji.length;
      textarea.setSelectionRange(newPos, newPos);
      adjustTextareaHeight(textarea);
    });
  }, [adjustTextareaHeight]);

  const handleDeleteChar = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || !textarea.value) {
      setInputText(prev => prev.slice(0, -1));
      return;
    }
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    if (start !== end) {
      setInputText(prev => prev.substring(0, start) + prev.substring(end));
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(start, start);
        adjustTextareaHeight(textarea);
      });
    } else if (start > 0) {
      const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
      let newPos = start - 1;
      if (segmenter) {
        const segments = Array.from(segmenter.segment(textarea.value.substring(0, start)));
        const lastSegment = segments[segments.length - 1];
        if (lastSegment) {
          newPos = lastSegment.index;
        }
      }
      setInputText(prev => prev.substring(0, newPos) + prev.substring(start));
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(newPos, newPos);
        adjustTextareaHeight(textarea);
      });
    }
  }, [adjustTextareaHeight]);

  // Close attach menu and emoji picker on outside click or Escape key
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        attachMenuRef.current && 
        !attachMenuRef.current.contains(e.target) &&
        attachBtnRef.current &&
        !attachBtnRef.current.contains(e.target)
      ) {
        closeAttachMenu(false);
      }
      if (
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(e.target) &&
        emojiBtnRef.current &&
        !emojiBtnRef.current.contains(e.target)
      ) {
        closeEmojiPicker(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        closeAttachMenu(false);
        closeEmojiPicker(false);
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
  }, [showAttachMenu, showEmojiPicker, closeAttachMenu, closeEmojiPicker]);

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

  const handleCancelReplyWithAnimation = useCallback((isFromPopState = false) => {
    if (isClosingReplyRef.current || !replyingToRef.current) return;
    setIsClosingReply(true);
    isClosingReplyRef.current = true;
    if (textareaRef.current) {
      textareaRef.current.blur();
    }
    if (!isFromPopState && (window.history.state === 'reply' || window.history.state?.view === 'reply')) {
      window.__isProgrammaticPop = true;
      window.history.back();
      setTimeout(() => {
        window.__isProgrammaticPop = false;
      }, 100);
    }
    setReplyingTo(null);
    setTimeout(() => {
      setIsClosingReply(false);
      isClosingReplyRef.current = false;
    }, 280);
  }, [setReplyingTo]);

  const clearReplyContext = useCallback((skipHistoryPop = false) => {
    setReplyingTo(null);
    if (!skipHistoryPop && (window.history.state === 'reply' || window.history.state?.view === 'reply')) {
      window.__isProgrammaticPop = true;
      window.history.back();
      setTimeout(() => {
        window.__isProgrammaticPop = false;
      }, 100);
    }
  }, [setReplyingTo]);

  const handleClearAllFilesWithAnimation = useCallback((isFromPopState = false) => {
    if (isClearingFiles || selectedFiles.length === 0) return;
    setIsClearingFiles(true);
    if (!isFromPopState && (window.history.state === 'files' || window.history.state?.view === 'files')) {
      window.__isProgrammaticPop = true;
      window.history.back();
      setTimeout(() => {
        window.__isProgrammaticPop = false;
      }, 100);
    }
    setTimeout(() => {
      setSelectedFiles([]);
      setIsClearingFiles(false);
    }, 280);
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
    }, 320);
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

  // Centralized LIFO back handler for chat internal layers
  const handleChatBack = useCallback(() => {
    // 1. Close active album gallery modal if open
    if (activeGalleryRef.current && !isClosingGalleryRef.current) {
      handleCloseGallery(true);
      return true;
    }

    // 2. Close emoji picker if open
    if (showEmojiPickerRef.current && !isClosingEmojiPickerRef.current) {
      closeEmojiPicker(true);
      return true;
    }

    // 3. Close attach menu if open
    if (showAttachMenuRef.current && !isClosingAttachMenuRef.current) {
      closeAttachMenu(true);
      return true;
    }

    // 3b. A popover is already animating out — consume the back event so we don't exit the chat
    if (isClosingEmojiPickerRef.current || isClosingAttachMenuRef.current) {
      return true;
    }

    // 4. Cancel voice recording if in progress
    if (isRecordingRef.current) {
      stopRecordingRef.current?.(false);
      return true;
    }

    // 5. Cancel message selection if active
    if (selectionModeRef.current) {
      selectionCancelRef.current?.(true);
      return true;
    }

    // 6. Dismiss reply mode with smooth animation if active
    if (replyingToRef.current && !isClosingReplyRef.current) {
      handleCancelReplyWithAnimation(true);
      return true;
    }

    // 7. Clear pending file attachments if any
    if (selectedFilesRef.current?.length > 0 && !isClearingFilesRef.current) {
      handleClearAllFilesWithAnimation(true);
      return true;
    }

    return false;
  }, [handleCloseGallery, closeEmojiPicker, closeAttachMenu, handleCancelReplyWithAnimation, handleClearAllFilesWithAnimation]);

  const handleHeaderBackClick = useCallback(() => {
    if (selectionModeRef.current) {
      selectionCancelRef.current?.();
      return;
    }
    if (activeGalleryRef.current && !isClosingGalleryRef.current) {
      handleCloseGallery(true);
      return;
    }
    if (showEmojiPickerRef.current && !isClosingEmojiPickerRef.current) {
      closeEmojiPicker(true);
      return;
    }
    if (showAttachMenuRef.current && !isClosingAttachMenuRef.current) {
      closeAttachMenu(true);
      return;
    }
    if (isClosingEmojiPickerRef.current || isClosingAttachMenuRef.current) {
      return;
    }
    if (isRecordingRef.current) {
      stopRecordingRef.current?.(false);
      return;
    }
    if (replyingToRef.current && !isClosingReplyRef.current) {
      handleCancelReplyWithAnimation(false);
      return;
    }
    if (selectedFilesRef.current?.length > 0 && !isClearingFilesRef.current) {
      handleClearAllFilesWithAnimation();
      return;
    }
    if (typeof onBack === 'function') {
      onBack();
    }
  }, [onBack, handleCloseGallery, closeEmojiPicker, closeAttachMenu, handleCancelReplyWithAnimation, handleClearAllFilesWithAnimation]);

  useEffect(() => {
    if (chatBackHandlerRef) chatBackHandlerRef.current = handleChatBack;
    if (selectionCancelCallbackRef) selectionCancelCallbackRef.current = handleChatBack;
    return () => {
      if (chatBackHandlerRef) chatBackHandlerRef.current = null;
      if (selectionCancelCallbackRef) selectionCancelCallbackRef.current = null;
    };
  }, [chatBackHandlerRef, selectionCancelCallbackRef, handleChatBack]);

  const openFilePicker = (acceptType = '*/*', captureType = null) => {
    closeAttachMenu(false);
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
  const activeAudioRef = useRef(null);
  const activeAudioUrlRef = useRef(null);
  const activeAudioMsgIdRef = useRef(null);
  
  // Debounce typing status triggers
  const typingTimeoutRef = useRef(null);
  const isTypingRef = useRef(false);
  const prevContactRef = useRef(activeContact.username);
  const prevTypingTargetRef = useRef(currentTypingTarget);
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
  // Pagination: only render last 70 for big-chat perf (keeps DOM light) + professional gated history loader
  const [visibleCount, setVisibleCount] = useState(70);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const loadMoreRef = useRef(null);
  const prevScrollHeightForPaginationRef = useRef(0);
  const isLoadingOlderRef = useRef(false);
  useEffect(() => { isLoadingOlderRef.current = isLoadingOlder; }, [isLoadingOlder]);
  const visibleMessages = useMemo(() => {
    const msgs = activeContact?.messages || [];
    if (msgs.length <= visibleCount) return msgs;
    return msgs.slice(-visibleCount);
  }, [activeContact?.messages, visibleCount]);

  const hasMoreHistory = useMemo(() => {
    return (activeContact?.messages?.length || 0) > visibleCount;
  }, [activeContact?.messages?.length, visibleCount]);

  const loadOlderMessages = useCallback(() => {
    if (isLoadingOlderRef.current) return;
    const total = activeContact?.messages?.length || 0;
    if (total <= visibleCount) return;
    const container = messagesContainerRef.current;
    if (container) prevScrollHeightForPaginationRef.current = container.scrollHeight;
    setIsLoadingOlder(true);
    isLoadingOlderRef.current = true;
    // Professional minimum spinner visibility (WhatsApp/Telegram style) — prevents flash & gives time for heavy decrypt/layout
    const minDelay = total > 350 ? 520 : 380;
    setTimeout(() => {
      setVisibleCount(prev => Math.min(total, prev + 40));
    }, minDelay);
  }, [activeContact?.messages?.length, visibleCount]);

  // Load more sentinel — when top enters viewport, expand via gated loading UX (blocks fast-scroll white flash)
  useEffect(() => {
    const container = messagesContainerRef.current;
    const sentinel = loadMoreRef.current;
    if (!container || !sentinel) return;
    if ((activeContact?.messages?.length || 0) <= visibleCount) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isLoadingOlderRef.current) {
          loadOlderMessages();
        }
      },
      { root: container, threshold: 0.05, rootMargin: '320px 0px 0px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleMessages.length, visibleCount, activeContact?.messages?.length, loadOlderMessages]);

  // Preserve scroll position when pagination expands (avoid jump) + release loading lock
  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      if (isLoadingOlder) setIsLoadingOlder(false);
      return;
    }
    if (!prevScrollHeightForPaginationRef.current) {
      if (isLoadingOlder) {
        const t = setTimeout(() => setIsLoadingOlder(false), 80);
        return () => clearTimeout(t);
      }
      return;
    }
    const oldHeight = prevScrollHeightForPaginationRef.current;
    const newHeight = container.scrollHeight;
    if (newHeight > oldHeight) {
      container.scrollTop = newHeight - oldHeight + container.scrollTop;
    }
    prevScrollHeightForPaginationRef.current = 0;
    const t = setTimeout(() => setIsLoadingOlder(false), 160);
    return () => clearTimeout(t);
  }, [visibleCount]);

  // While history is loading, keep user pinned at spinner (professional "stopper" — like big apps)
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (!isLoadingOlder) return;
    const loaderGuard = 56;
    if (container.scrollTop < loaderGuard) {
      requestAnimationFrame(() => {
        if (isLoadingOlderRef.current && container.scrollTop < loaderGuard) {
          container.scrollTop = loaderGuard;
        }
      });
    }
    let rafId = null;
    const pinTopDuringLoad = () => {
      if (!isLoadingOlderRef.current) return;
      if (container.scrollTop < 4) {
        container.scrollTop = Math.min(loaderGuard, 8);
      }
      rafId = requestAnimationFrame(pinTopDuringLoad);
    };
    rafId = requestAnimationFrame(pinTopDuringLoad);
    const onWheel = (e) => {
      if (!isLoadingOlderRef.current) return;
      if (container.scrollTop <= loaderGuard && e.deltaY < 0) {
        e.preventDefault();
        container.scrollTop = loaderGuard;
      }
    };
    const onTouchMove = () => {
      if (!isLoadingOlderRef.current) return;
      if (container.scrollTop <= 2) {
        container.scrollTop = 2;
      }
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('touchmove', onTouchMove);
    };
  }, [isLoadingOlder]);

  const unreadMessagesCount = useMemo(() => {
    if (!activeContact?.messages) return 0;
    return activeContact.messages.filter(m => m.sender === activeContact.username && m.status < 2).length;
  }, [activeContact?.messages, activeContact?.username]);

  // The scroll unread badge ONLY displays if the user is scrolled up away from the bottom AND there are unread messages
  const localUnreadCount = (!isScrolledUp || isLastMessageVisible) ? 0 : unreadMessagesCount;

  useEffect(() => {
    if (replyingTo) {
      setActiveReplyInfo(replyingTo);
      if (textareaRef.current && !selectionModeRef.current) {
        const el = textareaRef.current;
        try {
          const len = el.value.length;
          el.setSelectionRange(len, len);
        } catch (e) {}
        if (document.activeElement !== el) {
          try { el.focus({ preventScroll: true }); } catch (e) {}
        }
      }
    }
  }, [replyingTo]);

  useEffect(() => {
    if (selectedFiles.length > 0) {
      setActiveFileInfo(selectedFiles[0]);
      if (window.history.state !== 'files') {
        window.history.pushState('files', '');
      }
    } else {
      setActiveFileInfo(null);
    }
  }, [selectedFiles]);



  // Clear typing and replying status on active contact change
  useEffect(() => {
    // If we were typing for the previous contact, notify them we stopped
    if (isTypingRef.current && prevTypingTargetRef.current) {
      emitTypingState(prevTypingTargetRef.current, false);
    }
    isTypingRef.current = false;

    // Track the new active contact
    prevContactRef.current = activeContact.username;
    prevTypingTargetRef.current = currentTypingTarget;

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    setReplyingTo(null);
    setJustReceivedId(null);
    setIsScrolledUp(false);
    isScrolledUpRef.current = false;
    setVisibleCount(70);
    setIsLoadingOlder(false);
    isLoadingOlderRef.current = false;
    prevScrollHeightForPaginationRef.current = 0;

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
      if (currentSocket && currentSocket.connected && isTypingRef.current && prevTypingTargetRef.current) {
        emitTypingState(prevTypingTargetRef.current, false);
      }
    };
  }, [activeContact.username]);

  const isSmoothScrollingRef = useRef(false);

  const scrollRafRef = useRef(null);
  const handleScroll = useCallback((e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    // Throttle to rAF — prevents 100+ React state updates per second on long-chat scroll that jank typing animation
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

      if (isSmoothScrollingRef.current) {
        if (distanceFromBottom <= 4) {
          isSmoothScrollingRef.current = false;
          isScrolledUpRef.current = false;
          setIsScrolledUp(false);
        }
        return;
      }

      if (distanceFromBottom > 12) {
        if (!isScrolledUpRef.current) {
          isScrolledUpRef.current = true;
          setIsScrolledUp(true);
        }
      } else if (distanceFromBottom <= 4) {
        if (isScrolledUpRef.current) {
          isScrolledUpRef.current = false;
          setIsScrolledUp(false);
        }
      }
    });
  }, []);

  const scrollToBottom = (e) => {
    if (e?.currentTarget) {
      e.currentTarget.blur();
    }
    isSmoothScrollingRef.current = true;
    isScrolledUpRef.current = false;
    setIsScrolledUp(false);
    setIsLastMessageVisible(true);
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
    if (markAllMessagesAsReadLocal) {
      markAllMessagesAsReadLocal(activeContact.username);
    }
  };

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const onScrollEnd = () => {
      isSmoothScrollingRef.current = false;
    };
    container.addEventListener('scrollend', onScrollEnd);
    return () => container.removeEventListener('scrollend', onScrollEnd);
  }, [activeContact.username]);

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

  // Smooth scroll pinning for typing indicator — GPU-composited via scrollIntoView (no RAF layout thrashing)
  useEffect(() => {
    if (activeContact?.isTyping) {
      setJustReceivedId(null);
      if (!isScrolledUpRef.current && messagesContainerRef.current && typingBubbleRef.current) {
        // Two-frame wait so CSS grid expansion has started, then smooth-scroll in sync with the animation
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!isScrolledUpRef.current && typingBubbleRef.current && messagesContainerRef.current) {
              typingBubbleRef.current.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'nearest' });
            }
          });
        });
      }
    }
  }, [activeContact?.isTyping]);

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
    let element = document.getElementById(`msg-${msgId}`);
    const container = messagesContainerRef.current;
    if (!container) return;
    if (!element) {
      // Paginated big chat: target is outside rendered window — expand window to include it
      const allMsgs = activeContact?.messages || [];
      const targetIdx = allMsgs.findIndex(m => String(m.id) === String(msgId));
      if (targetIdx !== -1) {
        const needed = allMsgs.length - targetIdx;
        if (needed > visibleCount) {
          if (container) prevScrollHeightForPaginationRef.current = container.scrollHeight;
          setVisibleCount(needed + 5);
          setTimeout(() => scrollToMessage(msgId), 140);
        }
      }
      return;
    }

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
  }, [triggerHighlight, activeContact?.messages, visibleCount]);

  const prevMessageCountRef = useRef(0);
  const messagesContainerRef = useRef(null);
  const messagesBounceWrapperRef = useRef(null);

  // Hook for elastic overscroll bounce (rubber-banding) in chat messages (re-binds cleanly on conversation switch)
  useElasticBounce(messagesContainerRef, messagesBounceWrapperRef, true, [activeContact?.username]);

  const scrollToBottomInstant = useCallback(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, []);

  const prevContactUsernameRef = useRef(null);

  // Auto-pin scroll position to bottom whenever the messages container or wrapper resizes (e.g. images load/decrypt, history arrives, fonts load), UNLESS the user has intentionally scrolled up.
  useEffect(() => {
    const container = messagesContainerRef.current;
    const wrapper = messagesBounceWrapperRef.current;
    if (!container || !wrapper) return;

    if (!isScrolledUpRef.current) {
      container.scrollTop = container.scrollHeight;
    }

    let rafId = null;

    const handleResize = () => {
      if (!isScrolledUpRef.current && !isSmoothScrollingRef.current) {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          if (container && !isScrolledUpRef.current) {
            container.scrollTop = container.scrollHeight;
          }
        });
      }
    };

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(wrapper);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [activeContact.username]);

  // Scroll to bottom when selecting contact / mounting chat & lock across initial layout paint frames
  useLayoutEffect(() => {
    const isNewContact = prevContactUsernameRef.current !== activeContact.username;
    prevContactUsernameRef.current = activeContact.username;

    if (isNewContact) {
      setIsLastMessageVisible(true);
      setIsScrolledUp(false);
      isScrolledUpRef.current = false;
      prevMessageCountRef.current = activeContact?.messages?.length || 0;
      
      // Perform immediate instant scroll
      scrollToBottomInstant();

      // Pin scroll to bottom over subsequent frames as fonts, images, and layout stabilize
      let frameCount = 0;
      let rafId;
      const pinToBottom = () => {
        if (messagesContainerRef.current && !isScrolledUpRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
        frameCount++;
        if (frameCount < 16) {
          rafId = requestAnimationFrame(pinToBottom);
        }
      };
      rafId = requestAnimationFrame(pinToBottom);

      const t1 = setTimeout(() => { if (!isScrolledUpRef.current) scrollToBottomInstant(); }, 50);
      const t2 = setTimeout(() => { if (!isScrolledUpRef.current) scrollToBottomInstant(); }, 150);
      const t3 = setTimeout(() => { if (!isScrolledUpRef.current) scrollToBottomInstant(); }, 350);
      const t4 = setTimeout(() => { if (!isScrolledUpRef.current) scrollToBottomInstant(); }, 600);

      return () => {
        if (rafId) cancelAnimationFrame(rafId);
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
        clearTimeout(t4);
      };
    }
  }, [activeContact.username, scrollToBottomInstant]);

  // Scroll to bottom when message history is populated or changed from SQLite
  useLayoutEffect(() => {
    const currentCount = activeContact?.messages?.length || 0;
    if (currentCount > 0 && !isScrolledUpRef.current) {
      scrollToBottomInstant();
      const rafId = requestAnimationFrame(() => {
        if (messagesContainerRef.current && !isScrolledUpRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [activeContact?.messages?.length, scrollToBottomInstant]);

  // Immediately mark unread messages as read when looking at bottom view
  useEffect(() => {
    if ((isLastMessageVisible || !isScrolledUp) && unreadMessagesCount > 0 && markAllMessagesAsReadLocal) {
      markAllMessagesAsReadLocal(activeContact.username);
    }
  }, [unreadMessagesCount, isLastMessageVisible, isScrolledUp, activeContact.username, markAllMessagesAsReadLocal]);

  // Scroll smoothly on new messages — pagination-aware
  useEffect(() => {
    const currentCount = activeContact?.messages?.length || 0;
    const prevCount = prevMessageCountRef.current;
    if (currentCount === prevCount + 1) {
      const lastMsg = activeContact.messages[activeContact.messages.length - 1];
      const isSentByMe = lastMsg && lastMsg.sender !== activeContact.username;
      if (isSentByMe || (isLastMessageVisible && !isScrolledUpRef.current)) {
        if (messagesContainerRef.current && (isSentByMe || (isLastMessageVisible && !isScrolledUpRef.current))) {
          requestAnimationFrame(() => {
            if (messagesContainerRef.current && (isSentByMe || !isScrolledUpRef.current)) {
              messagesContainerRef.current.scrollTo({
                top: messagesContainerRef.current.scrollHeight,
                behavior: 'smooth'
              });
            }
          });
        }
      } else if (isScrolledUpRef.current) {
        const delta = currentCount - prevCount;
        setVisibleCount(prev => Math.min(activeContact.messages.length, prev + delta));
      }
    } else if (currentCount > prevCount) {
      if (messagesContainerRef.current && (!isScrolledUpRef.current && isLastMessageVisible)) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      } else if (isScrolledUpRef.current) {
        const delta = currentCount - prevCount;
        setVisibleCount(prev => Math.min(activeContact.messages.length, prev + delta));
      }
    }
    prevMessageCountRef.current = currentCount;
  }, [activeContact?.messages?.length]);

  const handleImageLoad = useCallback(() => {
    if (!isScrolledUpRef.current && messagesContainerRef.current) {
      // Single smooth scroll — lets ResizeObserver + CSS handle the rest
      requestAnimationFrame(() => {
        if (messagesContainerRef.current && !isScrolledUpRef.current) {
          messagesContainerRef.current.scrollTo({
            top: messagesContainerRef.current.scrollHeight,
            behavior: 'smooth'
          });
        }
      });
    }
  }, []);

  // Smooth mobile keyboard handling — drives the --kb custom property consumed by CSS.
  // With interactive-widget=resizes-content (Android 108+) the layout viewport shrinks
  // natively so kb computes to ~0 and CSS does nothing. On iOS (which ignores the hint)
  // kb equals the real keyboard height and CSS lifts the chat above it.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const root = document.documentElement;
    let rafId = null;
    let wasOpen = false;

    const apply = () => {
      rafId = null;
      // Desktop is intentionally untouched
      if (window.innerWidth > 768) {
        root.style.removeProperty('--kb');
        root.classList.remove('keyboard-open');
        wasOpen = false;
        return;
      }
      const el = document.activeElement;
      const editing = !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable);
      const kbHeight = Math.round(window.innerHeight - viewport.height - viewport.offsetTop);
      const isOpen = editing && kbHeight > 60;
      if (isOpen) {
        root.style.setProperty('--kb', `${Math.min(kbHeight, Math.round(window.innerHeight * 0.7))}px`);
        root.classList.add('keyboard-open');
        // Keep the latest message in view once the keyboard settles open
        if (!wasOpen && !isScrolledUpRef.current && messagesContainerRef.current) {
          requestAnimationFrame(() => {
            if (messagesContainerRef.current && !isScrolledUpRef.current) {
              messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
            }
          });
        }
      } else {
        root.style.removeProperty('--kb');
        root.classList.remove('keyboard-open');
      }
      wasOpen = isOpen;
    };

    const schedule = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(apply);
    };

    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    window.addEventListener('orientationchange', schedule);
    window.addEventListener('focusin', schedule);
    window.addEventListener('focusout', schedule);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
      window.removeEventListener('orientationchange', schedule);
      window.removeEventListener('focusin', schedule);
      window.removeEventListener('focusout', schedule);
      root.style.removeProperty('--kb');
      root.classList.remove('keyboard-open');
    };
  }, []);

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
      threshold: 0.85 // Require 85% visible to be considered at bottom — prevents drag when slightly scrolled
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
          emitTypingState(currentTypingTarget, true);
        }

        // Reset auto-stop typing timer
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
          emitTypingState(currentTypingTarget, false);
          isTypingRef.current = false;
        }, 3000);
      } else {
        // Immediately stop typing if text input cleared
        if (isTypingRef.current) {
          emitTypingState(currentTypingTarget, false);
          isTypingRef.current = false;
        }
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      }
    }
  };

  const handleSendMessage = async () => {
    // Block sending while attachments are still being encrypted on-device
    if (preparingFilesCountRef.current > 0) {
      notify('Attachments are still encrypting. Please wait a moment.', 'info', 'Encrypting...');
      return;
    }
    // If there's neither text nor attached files, do nothing
    if (!inputText.trim() && selectedFiles.length === 0) return;

    // Automatically close emoji picker and attach menus when sending
    if (showEmojiPicker) {
      closeEmojiPicker(false);
    }
    if (showAttachMenu) {
      closeAttachMenu(false);
    }

    // Immediately emit stop typing
    if (isTypingRef.current) {
      emitTypingState(currentTypingTarget, false);
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
    clearReplyContext();
    if (window.history.state === 'files' || window.history.state?.view === 'files') {
      window.__isProgrammaticPop = true;
      window.history.back();
      setTimeout(() => {
        window.__isProgrammaticPop = false;
      }, 100);
    }
    if (textareaRef.current) {
      textareaRef.current.style.height = '38px';
      const isMobile = window.innerWidth <= 768 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
      if (isMobile) {
        try { textareaRef.current.focus(); } catch (e) {}
      } else {
        textareaRef.current.focus({ preventScroll: true });
      }
    }

    if (selectedFiles.length > 0) {
      // Batch send files sequentially
      uploadManager.beginBatch();
      setUploading(true);
      const filesToUpload = [...selectedFiles];
      setSelectedFiles([]); // Clear queue immediately
      const totalFiles = filesToUpload.length;

      try {
        for (let idx = 0; idx < totalFiles; idx++) {
          if (uploadManager.isCancelled()) throw new UploadCancelledError();
          const rawFile = filesToUpload[idx];
          const fileBasePct = (idx / totalFiles) * 100;
          const filePctWeight = (1 / totalFiles);

          const updateProgress = (stagePct, status) => {
            const overallPercent = Math.min(99, Math.round(fileBasePct + (stagePct * filePctWeight)));
            setUploadProgress({
              filename: rawFile.name,
              current: idx + 1,
              total: totalFiles,
              percent: overallPercent,
              status
            });
          };

          updateProgress(5, 'Preparing file...');

          // Attachments are pre-encrypted at selection time; reuse the ready
          // payload so sending is instant and cannot race the crypto.
          const preEncrypted = rawFile._encryptedPayload || null;
          let fileToUpload = preEncrypted ? rawFile : await optimizeImageForSending(rawFile);

          let fileBuffer = null;
          let encryptedBase64 = null;
          let fileSessionKeyJwk = null;
          let ivBase64 = null;

          if (preEncrypted) {
            updateProgress(30, 'Uploading...');
            encryptedBase64 = preEncrypted.encryptedBase64;
            fileSessionKeyJwk = preEncrypted.keyJwk;
            ivBase64 = preEncrypted.ivBase64;
          } else {
            updateProgress(15, 'Encrypting...');

            // Fallback path: read file as ArrayBuffer safely (supporting Android content URI files)
            let fallbackBuffer = null;
            for (let attempt = 0; attempt < 4 && (!fallbackBuffer || fallbackBuffer.byteLength === 0); attempt++) {
              if (attempt > 0) await new Promise(r => setTimeout(r, 200 * attempt));
              fallbackBuffer = fileToUpload._preloadedBuffer || await readBlobBufferSafely(fileToUpload);
              if (!fallbackBuffer || fallbackBuffer.byteLength === 0) {
                try {
                  fallbackBuffer = await new Response(fileToUpload).arrayBuffer();
                } catch (e) {}
              }
            }

            if (!fallbackBuffer || fallbackBuffer.byteLength === 0) {
              throw new Error(`Could not read data for "${fileToUpload.name}". Please try selecting the file again.`);
            }
            fileBuffer = fallbackBuffer;

            updateProgress(25, 'Encrypting...');

            // Generate AES-GCM session key
            const fileSessionKey = await window.crypto.subtle.generateKey(
              { name: 'AES-GCM', length: 256 },
              true,
              ['encrypt', 'decrypt']
            );

            // Encrypt file buffer
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const encryptedFileBuffer = await window.crypto.subtle.encrypt(
              { name: 'AES-GCM', iv },
              fileSessionKey,
              fileBuffer
            );

            // Base64 convert
            encryptedBase64 = bufferToBase64(encryptedFileBuffer);
            fileSessionKeyJwk = await window.crypto.subtle.exportKey('jwk', fileSessionKey);
            ivBase64 = bufferToBase64(iv);
          }

          updateProgress(35, 'Uploading...');

          // 5. Upload encrypted file payload with real-time XHR upload progress, cancellation & auto-retry
          let uploadResult = null;
          let lastUploadError = null;
          const abortRef = { current: null };
          const unregisterCancelHandler = uploadManager.registerCancelHandler(() => {
            if (abortRef.current) abortRef.current();
          });

          try {
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                uploadResult = await uploadEncryptedFile(
                  fileToUpload.name, 
                  encryptedBase64, 
                  currentUserToken,
                  (uploadPct) => {
                    const stagePct = 35 + (uploadPct * 0.60);
                    updateProgress(stagePct, 'Uploading...');
                  },
                  abortRef
                );
                break;
              } catch (err) {
                if (err?.isCancelled || uploadManager.isCancelled()) throw new UploadCancelledError();
                lastUploadError = err;
                if (attempt === 0) {
                  updateProgress(35, 'Retrying upload...');
                  await new Promise(r => setTimeout(r, 600));
                }
              }
            }
          } finally {
            unregisterCancelHandler();
            abortRef.current = null;
          }

          if (!uploadResult) {
            throw lastUploadError || new Error('Upload failed');
          }

          const { fileUrl } = uploadResult;

          // Don't emit the message if the user cancelled during the final network round-trips
          if (uploadManager.isCancelled()) throw new UploadCancelledError();

          updateProgress(98, 'Sending...');

          const inferredMime = preEncrypted
            ? preEncrypted.mimeType
            : inferMimeType(fileToUpload.name, fileToUpload.type);
          const localBlob = (preEncrypted?.localBlob instanceof Blob && preEncrypted.localBlob.size > 0)
            ? preEncrypted.localBlob
            : new Blob([fileBuffer], { type: inferredMime });

          // Save local copy in IndexedDB and memory cache (guaranteed in-memory Blob)
          setCachedMedia(fileUrl, localBlob, inferredMime);

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
              mimeType: inferredMime,
              keyJwk: fileSessionKeyJwk,
              iv: ivBase64
            },
            replyTo: idx === 0 ? replyContext : null
          });
        }
        soundEngine.playMessageSent();
      } catch (err) {
        if (err instanceof UploadCancelledError || err?.isCancelled || uploadManager.isCancelled()) {
          notify('Upload cancelled.', 'info', 'Upload Cancelled');
        } else {
          console.error("Encryption/Upload failed:", err);
          notify(`Failed to send encrypted file: ${err.message || 'Unknown upload error'}`, 'error', 'Upload Error');
        }
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

  const handleSendGif = useCallback((gif) => {
    if (!gif) return;
    const replyContext = replyingTo ? { 
      id: replyingTo.id, 
      sender: replyingTo.sender, 
      text: replyingTo.text,
      mediaType: replyingTo.mediaType || null,
      fileMetadata: replyingTo.fileMetadata || null
    } : null;

    clearReplyContext();
    onSendMessage({
      type: 'gif',
      text: gif.title || 'GIF',
      mediaType: 'gif',
      fileMetadata: {
        url: gif.url,
        thumb: gif.thumb || gif.url,
        name: gif.title || 'GIF'
      },
      replyTo: replyContext
    });
    soundEngine.playMessageSent();

    const isMobile = window.innerWidth <= 768 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    if (isMobile) {
      closeEmojiPicker(false);
    }
  }, [replyingTo, clearReplyContext, onSendMessage, closeEmojiPicker]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (preparingFilesCount > 0) return;
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
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) pastedFiles.push(file);
      }
    }
    if (pastedFiles.length > 0) {
      addFilesToSelection(pastedFiles);
      e.preventDefault();
    }
  };

  // ==========================================
  // File Attachment Handling & E2EE Upload
  // ==========================================
  // Shared pipeline: normalize -> read -> PRE-ENCRYPT at selection time.
  // A file only becomes sendable once its encrypted payload is fully ready
  // on-device, so hitting send immediately can never race the crypto.
  const addFilesToSelection = async (incomingFiles) => {
    const files = Array.from(incomingFiles || []);
    if (!files.length) return;

    const validFiles = [];
    setPreparingFilesCount(prev => prev + files.length);
    try {
      // 1. Concurrently read all file ArrayBuffers into memory FIRST while OS file descriptors are guaranteed alive
      await Promise.all(files.map(async (f) => {
        if (!f._preloadedBuffer || f._preloadedBuffer.byteLength === 0) {
          try {
            const buf = await readBlobBufferSafely(f);
            if (buf && buf.byteLength > 0) {
              f._preloadedBuffer = buf;
            }
          } catch (e) {}
        }
      }));

      // 2. Process, optimize, and pre-encrypt each file
      for (const f of files) {
        if (f.size > 50 * 1024 * 1024) {
          notify(`"${f.name}" exceeds the maximum file size of 50MB.`, 'error', 'File Too Large');
          continue;
        }
        try {
          const prepared = await prepareFileForSending(f);
          const safeFile = new File([prepared.fileBuffer], prepared.file.name, {
            type: prepared.file.type || prepared.inferredMime || 'application/octet-stream',
            lastModified: prepared.file.lastModified || Date.now()
          });
          safeFile._encryptedPayload = {
            encryptedBase64: prepared.encryptedBase64,
            keyJwk: prepared.keyJwk,
            ivBase64: prepared.ivBase64,
            name: prepared.file.name,
            size: prepared.file.size,
            mimeType: prepared.inferredMime,
            localBlob: prepared.localBlob
          };
          validFiles.push(safeFile);
        } catch (prepErr) {
          console.error('File preparation failed:', prepErr);
          notify(prepErr.message || `Could not process "${f.name}".`, 'error', 'Upload Error');
        }
      }
    } finally {
      setPreparingFilesCount(prev => Math.max(0, prev - files.length));
    }

    if (validFiles.length > 0) {
      setSelectedFiles(prev => [...prev, ...validFiles]);
    }
  };

  const handleFileSelect = (e) => {
    const inputElement = e.target;
    const files = Array.from(inputElement.files || []);
    if (!files.length) return;
    // Add files to selection (captures bytes into RAM immediately)
    addFilesToSelection(files);
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
      notify(err.message || 'Failed to decrypt and download file.', 'error', 'Download Error');
    }
  }, []);

  // ==========================================
  // Voice Notes Recorder
  // ==========================================
  const activeVoiceStreamRef = useRef(null);

  const releaseVoiceStreamTracks = useCallback(() => {
    if (activeVoiceStreamRef.current) {
      try {
        activeVoiceStreamRef.current.getTracks().forEach(track => {
          try { track.stop(); } catch (e) {}
        });
      } catch (e) {}
      activeVoiceStreamRef.current = null;
    }
  }, []);

  const startRecording = async () => {
    releaseVoiceStreamTracks();
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
      activeVoiceStreamRef.current = stream;

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
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorderRef.current?.mimeType || 'audio/webm' });
        
        // Stop all track streams immediately to release microphone hardware sensor
        releaseVoiceStreamTracks();

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
      releaseVoiceStreamTracks();
      notify('Microphone access is required to record voice notes.', 'error', 'Permission Required');
    }
  };

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
      }
      releaseVoiceStreamTracks();
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };

    window.addEventListener('beforeunload', cleanupRecording);

    return () => {
      window.removeEventListener('beforeunload', cleanupRecording);
      cleanupRecording();
    };
  }, [activeContact?.username, releaseVoiceStreamTracks]);

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
      }
      releaseVoiceStreamTracks();
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
          releaseVoiceStreamTracks();
        }
      } else {
        releaseVoiceStreamTracks();
      }
      setRecordingExitMode('send');
      setTimeout(() => {
        setIsRecording(false);
        setRecordingExitMode(null);
      }, 140);
    }
  };
  stopRecordingRef.current = stopRecording;

  const processAndSendVoiceNote = async (audioBlob) => {
    let finalBlob = audioBlob;
    if (!finalBlob || finalBlob.size === 0) {
      const sampleAudioHeader = new Uint8Array([
        0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81, 0x01, 0x42, 0xF7, 0x81, 0x01, 0x42, 0xF2, 0x81,
        0x04, 0x42, 0xF3, 0x81, 0x08, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6D, 0x42, 0x87, 0x81, 0x04
      ]);
      finalBlob = new Blob([sampleAudioHeader], { type: 'audio/webm' });
    }
    setIsSendingVoice(true);
    try {
      const token = currentUserToken || currentUser?.token || localStorage.getItem('zap_token') || localStorage.getItem('chatra_token') || localStorage.getItem('token');
      if (!token) {
        throw new Error('User session token is missing. Please re-login.');
      }

      // 1. Read audio blob as ArrayBuffer
      const arrayBuffer = await finalBlob.arrayBuffer();

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
      clearReplyContext();
      soundEngine.playMessageSent();
    } catch (err) {
      console.error('Error sending voice note:', err);
      notify(`Failed to send encrypted voice note: ${err?.message || err}`, 'error', 'Voice Note Error');
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
          audioProgressManager.emit(msgId, (newTime / duration) * 100, newTime);
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
          audioProgressManager.emit(msgId, progress, audio.currentTime);
        }
      };

      audio.onended = () => {
        setPlayingAudioId(null);
        audioProgressManager.clear(msgId);
      };

      audio.playbackRate = playbackRate;

      const duration = fileMetadata?.duration || 0;
      const initialProgress = audioProgressManager.getProgress(msgId) || (seekPercentage !== null ? seekPercentage * 100 : 0);
      const startPct = seekPercentage !== null ? seekPercentage : (initialProgress / 100);

      audio.onloadedmetadata = () => {
        const actualDuration = audio.duration || duration;
        if (startPct > 0 && actualDuration > 0) {
          audio.currentTime = startPct * actualDuration;
        }
      };

      audioProgressManager.emit(msgId, startPct * 100, startPct * duration);

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
        notify('This voice note is no longer available on the server (expired or deleted).', 'warning', 'Voice Note');
      } else {
        notify('Failed to decrypt and play voice note.', 'error', 'Audio Playback Error');
      }
    }
  }, [playbackRate]);

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
            onOpenGallery={handleOpenGallery}
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

    if (msg.mediaType === 'gif') {
      const gifUrl = msg.fileMetadata?.url || msg.fileMetadata?.thumb || msg.text;
      return (
        <div className="gif-message-wrapper">
          <img 
            src={gifUrl} 
            alt={msg.text || 'GIF'} 
            className="gif-message-img" 
            loading="lazy"
            onLoad={handleImageLoad}
          />
          <div className="gif-meta-overlay">
            <span className="gif-meta-time">{formatMessageTime(msg.timestamp)}</span>
            {isSent && (
              <span className="gif-meta-ticks" title={msg.status === 2 ? "Read" : msg.status === 1 ? "Delivered" : "Sent"}>
                {msg.status === 0 && <span className="tick-single">✓</span>}
                {msg.status === 1 && <span className="tick-delivered">✓✓</span>}
                {msg.status === 2 && <span className="tick-read">✓✓</span>}
              </span>
            )}
          </div>
        </div>
      );
    }

    if (msg.mediaType === 'file') {
      const file = msg.fileMetadata || {};
      const inferredMime = inferMimeType(file.name || file.fileName || file.filename || '', file.mimeType || '');
      const isImage = inferredMime.startsWith('image/');
      const isVideo = inferredMime.startsWith('video/');

      let element;
      if (isImage) {
        element = (
          <div className="image-message-wrapper">
            <ImagePreviewLoader 
              fileMetadata={file} 
              onImageClick={() => {
                if (!selectionModeRef.current) {
                  handleOpenGallery([msg], 0);
                }
              }} 
              onImageLoad={handleImageLoad} 
            />
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

      return (
        <VoiceNotePlayerItem 
          key={msg.id}
          msg={msg}
          file={file}
          isSent={isSent}
          isPlaying={isPlaying}
          playbackRate={playbackRate}
          onTogglePlay={togglePlayAudio}
          onPlaybackRateChange={handlePlaybackRateChange}
          selectionModeRef={selectionModeRef}
          formatMessageTime={formatMessageTime}
          formatTime={formatTime}
        />
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
  }, [playingAudioId, playbackRate, downloadAndDecryptFile, togglePlayAudio, handlePlaybackRateChange, onImageClick, activeContact?.username, handleOpenGallery]);

  return (
    <div className={`chat-area ${isGroupMode ? 'group-chat-active' : ''} ${isNavigatingBack ? 'navigating-back' : ''}`}>
      {/* Header */}
      <div className="chat-header glass">
        <div className="chat-header-info">
          <button className={`back-btn ${selectionMode ? 'selection-back-btn' : ''}`} onClick={(e) => { e.stopPropagation(); handleHeaderBackClick(); }} title={selectionMode ? 'Cancel selection' : 'Back to menu'} aria-label={selectionMode ? 'Cancel selection' : 'Back to menu'}>
            <div className="btn-icon-wrapper" key={selectionMode ? 'cancel-icon' : 'back-icon'}>
              {selectionMode ? <X size={18} /> : <ArrowLeft size={18} />}
            </div>
          </button>
          <div className="group-avatar-stack-wrapper">
            {renderAvatar(activeContact.username, activeContact.customName || activeContact.displayName, activeContact.avatarIcon)}
            {isGroupMode && <span className="group-avatar-badge"><Users size={11} /></span>}
          </div>
          <div className="chat-header-name">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeContact.customName || activeContact.displayName || activeContact.username}
              </span>
              {isGroupMode ? (
                <Users size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              ) : (
                activeContact.isVerified && <ShieldCheck size={15} style={{ color: 'var(--accent-color)', flexShrink: 0 }} title="Verified Identity" />
              )}
            </h2>
            {isGroupMode ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: activeContact.isRemoved ? 'rgba(239, 68, 68, 0.9)' : 'var(--text-muted)' }}>
                {activeContact.isRemoved ? (
                  <span style={{ fontWeight: '500' }}>Removed from group</span>
                ) : (
                  <span>{(activeContact.members?.length || 0)} member{((activeContact.members?.length || 0) === 1) ? '' : 's'}</span>
                )}
              </span>
            ) : (
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                <span style={{ fontFamily: 'monospace' }}>@{activeContact.username}</span>
                <span>•</span>
                <span className={`chat-header-status ${activeContact.status === 'online' ? 'online' : ''}`}>
                  {activeContact.status === 'online' ? 'Online' : 'Offline'}
                </span>
              </span>
            )}
          </div>
        </div>
        <div className={`chat-header-actions ${selectionMode ? 'selection-header-actions' : ''}`}>
          {selectionMode ? (
            <>
              <span className="selection-count-label" aria-label={`${selectionCount} selected`}>
                <span key={selectionCount} className="selection-count-number">{selectionCount}</span>
              </span>
              {selectionCount === 1 && (
                <button
                  className="header-action-btn selection-forward-header-btn"
                  onClick={() => selectionCancelRef.current?.forward?.()}
                  title="Forward"
                  aria-label="Forward selected message"
                >
                  <CornerUpRight size={19} />
                </button>
              )}
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
              {isGroupMode ? (
                <>
                  {!activeContact.isRemoved && (
                    <>
                      <button 
                        className="header-action-btn" 
                        onClick={() => onInitiateCall('voice')}
                        title="Group Voice Call"
                        aria-label="Start group voice call"
                      >
                        <Phone size={19} />
                      </button>
                      <button 
                        className="header-action-btn" 
                        onClick={() => onInitiateCall('video')}
                        title="Group Video Call"
                        aria-label="Start group video call"
                      >
                        <Video size={19} />
                      </button>
                    </>
                  )}
                  <button
                    className="header-action-btn"
                    onClick={() => onOpenGroupInfo?.()}
                    title="Group info & members"
                    aria-label="Group info and members"
                  >
                    <Info size={19} />
                  </button>
                </>
              ) : (
                <>
                  <button 
                    className="header-action-btn safety-number-btn" 
                    onClick={onOpenSafetyModal}
                    title="E2EE Safety Number Verification"
                    aria-label="E2EE Safety Number Verification"
                  >
                    <ShieldCheck size={19} />
                  </button>
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
            </>
          )}
        </div>
      </div>

      {/* Unsaved contact warning banner with smooth pill animation */}
      {activeContact?.isSaved === false && dismissedBannerUser !== activeContact.username && (
        <div className={`unsaved-contact-banner glass ${isBannerDismissing ? 'dismissing' : ''}`}>
          <div className="banner-content">
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
        className={`messages-container ${isLoadingOlder ? 'is-loading-history' : ''}`} 
        key={activeContact.username} 
        ref={messagesContainerRef} 
        onScroll={handleScroll}
      >
        <div className="messages-bounce-wrapper" ref={messagesBounceWrapperRef}>
          <div ref={loadMoreRef} style={{ height: '1px', width: '100%', pointerEvents: 'none' }} aria-hidden="true" />
          {isLoadingOlder && (
            <div className="history-loading-bar glass" role="status" aria-live="polite" aria-label="Loading older messages">
              <Loader2 size={14} className="spinner-rotating" />
              <span>Loading older messages…</span>
            </div>
          )}
          {!isLoadingOlder && hasMoreHistory && (
            <div className="load-more-pill-wrapper">
              <button 
                className="load-more-pill glass"
                onClick={loadOlderMessages}
                disabled={isLoadingOlder}
              >
                <span>Showing {visibleMessages.length} of {activeContact.messages.length} • Tap to load older</span>
              </button>
            </div>
          )}
          {!isLoadingOlder && !hasMoreHistory && activeContact.messages.length > 18 && (
            <div className="history-start-pill-wrapper" aria-hidden="true">
              <span className="history-start-pill">Beginning of conversation</span>
            </div>
          )}
          <div className="e2ee-banner">
            <Shield size={14} />
            <span>{isGroupMode
              ? 'Messages are end-to-end encrypted. Only members of this group can read them — not even ZAP.'
              : 'Messages and media are end-to-end encrypted. No one else, not even ZAP, can read them.'}
            </span>
          </div>

          <MessageList
            messages={visibleMessages}
            activeContactUsername={activeContact.username}
            lastMessageRef={lastMessageRef}
            scrollToMessage={scrollToMessage}
            setReplyingTo={setReplyingTo}
            textareaRef={textareaRef}
            renderMessageContent={renderMessageContent}
            onDeleteMessages={onDeleteMessages}
            selectionCancelRef={selectionCancelRef}
            onSelectionModeChange={handleSelectionModeChange}
            setIsClosingReply={setIsClosingReply}
            onForwardMessage={onForwardMessage}
            isGroupMode={isGroupMode}
            myUsername={currentUser?.username || ''}
            resolveSenderName={resolveSenderName}
            getGroupMemberInfo={getGroupMemberInfo}
          />
          {(() => {
            const typingNames = (activeContact.groupTypingNames || []);
            const hasGroupTyping = isGroupMode && typingNames.length > 0;
            const dmTyping = !isGroupMode && activeContact.isTyping;
            return (
              <TypingIndicator 
                isVisible={Boolean((hasGroupTyping || dmTyping) && !(justReceivedId !== null && activeContact.messages?.length && activeContact.messages[activeContact.messages.length - 1]?.id === justReceivedId))} 
                typingBubbleRef={typingBubbleRef} 
              />
            );
          })()}
          <div ref={messagesEndRef} style={{ height: '1px', minHeight: '1px', width: '100%', pointerEvents: 'none' }} />
        </div>
      </div>

      {/* Input controls */}
      <div className="chat-input-wrapper">
        {/* Floating Scroll-to-Bottom Button / Typing Indicator */}
        <button 
          className={`scroll-to-bottom-btn ${(isScrolledUp && !isInlineTypingVisible) ? 'visible' : ''} ${((isGroupMode ? (activeContact.groupTypingNames || []).length > 0 : activeContact.isTyping) && !isInlineTypingVisible) ? 'typing-active' : ''}`} 
          onClick={scrollToBottom} 
          title="Scroll to bottom"
          aria-label="Scroll to bottom"
        >
          <div className="scroll-btn-content">
            <span className="typing-text-wrapper">
              {(() => {
                if (isGroupMode) {
                  const names = activeContact.groupTypingNames || [];
                  if (names.length === 0) return null;
                  if (names.length === 1) return `${names[0]} is typing...`;
                  if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`;
                  return 'Several people are typing...';
                }
                return activeContact.isTyping ? `${activeContact.username} is typing...` : null;
              })()}
            </span>
            <ArrowDown size={18} className={(isGroupMode ? (activeContact.groupTypingNames || []).length > 0 : activeContact.isTyping) ? 'typing-arrow-bounce' : ''} />
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
                {activeReplyInfo.mediaType === 'file' && activeReplyInfo.fileMetadata?.mimeType?.startsWith('image/') ? (
                  <div className="reply-image-thumbnail">
                    <ImagePreviewLoader fileMetadata={activeReplyInfo.fileMetadata} />
                  </div>
                ) : activeReplyInfo.mediaType === 'file' && activeReplyInfo.fileMetadata?.mimeType?.startsWith('video/') ? (
                  <div className="reply-video-thumbnail">
                    <VideoIcon size={14} style={{ color: 'var(--accent-color)' }} />
                  </div>
                ) : activeReplyInfo.mediaType === 'sticker' ? (
                  <div className="reply-sticker-thumbnail">
                    <img src={activeReplyInfo.fileMetadata?.url || activeReplyInfo.text} alt="Sticker" style={{ width: '24px', height: '24px', objectFit: 'contain' }} />
                  </div>
                ) : activeReplyInfo.mediaType === 'gif' ? (
                  <div className="reply-image-thumbnail">
                    <img src={activeReplyInfo.fileMetadata?.thumb || activeReplyInfo.fileMetadata?.url || activeReplyInfo.text} alt="GIF" style={{ width: '24px', height: '24px', objectFit: 'cover', borderRadius: '4px' }} />
                  </div>
                ) : null}
                <div className="reply-preview-text-block">
                  <div className="reply-preview-badge-row">
                    <CornerUpLeft size={13} className="reply-preview-icon" />
                    <span className="reply-preview-label">Replying to {resolveSenderName(activeReplyInfo.sender)}</span>
                  </div>
                  <span className="reply-preview-text">
                    {activeReplyInfo.mediaType === 'file' && activeReplyInfo.fileMetadata?.mimeType?.startsWith('image/')
                      ? 'Photo'
                      : activeReplyInfo.mediaType === 'file' && activeReplyInfo.fileMetadata?.mimeType?.startsWith('video/')
                        ? 'Video'
                        : activeReplyInfo.mediaType === 'sticker'
                          ? 'Sticker'
                          : activeReplyInfo.mediaType === 'gif'
                            ? 'GIF'
                            : activeReplyInfo.text
                    }
                  </span>
                </div>
              </div>
              <button 
                className="reply-preview-close" 
                onClick={(e) => {
                  e.currentTarget.blur();
                  handleCancelReplyWithAnimation(false);
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
              <button
                className="upload-progress-cancel-btn"
                onClick={handleCancelUpload}
                title="Cancel upload"
                aria-label="Cancel upload"
              >
                <X size={14} />
              </button>
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
        <div className={`attachment-preview-bar ${(selectedFiles.length > 0 || isClearingFiles || preparingFilesCount > 0) ? 'glass visible' : ''} ${isClearingFiles ? 'is-exiting' : ''}`}>
          {(selectedFiles.length > 0 || isClearingFiles || preparingFilesCount > 0) && (
            <div className="attachment-preview-inner">
              <div 
                className="multi-file-preview-container"
                onWheel={(e) => {
                  if (e.deltaY !== 0) {
                    e.currentTarget.scrollLeft += e.deltaY;
                  }
                }}
              >
                {preparingFilesCount > 0 && (
                  <div className="file-preview-pill is-preparing" title="Encrypting on this device before sending...">
                    <Loader2 size={13} className="spinner-rotating" />
                    <span className="file-pill-name">
                      Encrypting {preparingFilesCount} file{preparingFilesCount > 1 ? 's' : ''}...
                    </span>
                  </div>
                )}
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

        {/* Separated Pill-Style Input Controls or Removed Notice */}
        {activeContact?.isRemoved ? (
          <div className="chat-removed-banner glass">
            <Ban size={16} style={{ color: '#f87171', flexShrink: 0 }} />
            <span>You have been removed from this group</span>
          </div>
        ) : (
          <div className="chat-input-row">
            <input
              type="file"
              id="file-input"
              multiple
              style={{ display: 'none' }}
              onClick={(e) => { e.target.value = ''; }}
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
                onClick={toggleAttachMenu}
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
            {hasMountedEmojiPicker && (
              <div 
                ref={emojiPickerRef} 
                className={`apple-emoji-popover-wrapper ${isClosingEmojiPicker ? 'is-closing' : ''}`}
                style={{
                  display: (showEmojiPicker || isClosingEmojiPicker) ? 'block' : 'none'
                }}
              >
                <AppleEmojiPicker 
                  key={emojiPickerSession}
                  onSelectEmoji={handleInsertEmoji} 
                  onSelectGif={handleSendGif}
                  onDelete={handleDeleteChar}
                  onClose={closeEmojiPicker}
                />
              </div>
            )}

            {/* 3. Right: Voice Note Mic or Send Button Pill */}
            <div className="input-action-pill-wrapper action-btn-pill-wrapper">
              {uploading ? (
                <button 
                  className="input-circle-btn send-btn is-uploading-spin" 
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
                  className={`input-circle-btn send-btn send-active ${preparingFilesCount > 0 ? 'preparing-attachments' : ''}`} 
                  onPointerDown={(e) => {
                    // Prevent focus transfer away from textarea to keep keyboard up
                    e.preventDefault();
                  }}
                  onClick={() => {
                    handleSendMessage();
                  }} 
                  disabled={(!inputText.trim() && selectedFiles.length === 0) || uploading || preparingFilesCount > 0}
                  title={preparingFilesCount > 0 ? 'Encrypting attachments...' : 'Send Encrypted Message'}
                  aria-label={preparingFilesCount > 0 ? 'Encrypting attachments...' : 'Send Encrypted Message'}
                >
                  {preparingFilesCount > 0
                    ? <Loader2 size={18} className="spinner-rotating" />
                    : <ArrowUp size={18} strokeWidth={2.8} />}
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
        )}
      </div>

      {activeGalleryModal && (
        <AlbumGalleryModal
          items={activeGalleryModal.items}
          initialIndex={activeGalleryModal.initialIndex || 0}
          isExiting={isClosingGalleryModal}
          onClose={() => handleCloseGallery(false)}
        />
      )}
    </div>
  );
});

export default ChatArea;

