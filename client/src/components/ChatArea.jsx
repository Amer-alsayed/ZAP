import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { 
  Send, Shield, Phone, Video, Paperclip, Mic, X, Play, Pause, 
  FileText, Image, Video as VideoIcon, Download, AlertTriangle,
  ArrowLeft, CornerUpLeft, ArrowDown, PhoneOff, VideoOff, ArrowUp, Plus, ShieldCheck, Trash2, Camera, Music
} from 'lucide-react';
import { uploadEncryptedFile } from '../services/api';
import { bufferToBase64, base64ToBuffer } from '../services/crypto';
import { getSocket } from '../services/socket';
import { renderAvatar } from './Sidebar';
import { loadOrFetchDecryptedMedia, setCachedMedia } from '../services/mediaCache';
import { soundEngine } from '../services/soundEffects';

// ==========================================
// E2EE Safety Fingerprint Helper (Synchronous Hash)
// ==========================================
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
}) => {
  const [swipeState, setSwipeState] = useState({ msgId: null, offset: 0, isSwiping: false });
  const swipeStartRef = useRef(null);

  const hasJustReceivedMessage = justReceivedId !== null && 
    messages && 
    messages.length > 0 && 
    messages[messages.length - 1].id === justReceivedId;

  return (
    <>
      {messages && messages.map((msg, index) => {
        const isSent = msg.sender === activeContactUsername ? false : true;
        const showDateSeparator = shouldShowDateSeparator(messages, index);

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
                    <span className="system-call-log-text">{statusText}</span>
                    {status === 'completed' && (
                      <span className="system-call-duration">({formatCallDuration(callData.duration)})</span>
                    )}
                    <span className="system-call-time">
                      {formatMessageTime(msg.timestamp)}
                    </span>
                  </div>
                </div>
              </div>
            </React.Fragment>
          );
        }

        return (
          <React.Fragment key={msg.id}>
            {showDateSeparator && (
              <div className="date-separator">
                <span>{formatSeparatorDate(msg.timestamp)}</span>
              </div>
            )}
            <div 
              className={`message-row ${isSent ? 'sent' : 'received'}`}
              onTouchStart={(e) => {
                // Only process touch drag gestures on true touch devices (coarse pointer)
                if (window.matchMedia && !window.matchMedia('(pointer: coarse)').matches) return;
                const touch = e.touches[0];
                swipeStartRef.current = { x: touch.clientX, y: touch.clientY, msgId: msg.id };
                setSwipeState({ msgId: msg.id, offset: 0, isSwiping: true });
              }}
              onTouchMove={(e) => {
                if (!swipeStartRef.current || swipeStartRef.current.msgId !== msg.id) return;
                const touch = e.touches[0];
                const deltaX = touch.clientX - swipeStartRef.current.x;
                const deltaY = touch.clientY - swipeStartRef.current.y;

                // Only trigger horizontal right swipe if user is swiping right and not scrolling vertically
                if (deltaX > 0 && Math.abs(deltaX) > Math.abs(deltaY)) {
                  const clampedOffset = Math.min(deltaX * 0.6, 75);
                  setSwipeState({ msgId: msg.id, offset: clampedOffset, isSwiping: true });
                }
              }}
              onTouchEnd={() => {
                if (swipeStartRef.current?.msgId === msg.id) {
                  if (swipeState.offset >= 30) { // Extremely responsive 30px swipe threshold
                    setReplyingTo({
                      id: msg.id,
                      sender: msg.sender,
                      text: msg.mediaType ? `[${msg.mediaType}]` : msg.text,
                      mediaType: msg.mediaType || null,
                      fileMetadata: msg.fileMetadata || null
                    });
                    if (window.navigator && window.navigator.vibrate) {
                      try { window.navigator.vibrate(15); } catch (err) {}
                    }
                    // Guarantee keyboard popup on repeated mobile drags
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
                swipeStartRef.current = null;
                setSwipeState({ msgId: null, offset: 0, isSwiping: false });
              }}
            >
              <div 
                id={`msg-${msg.id}`} 
                ref={index === messages.length - 1 ? lastMessageRef : null}
                data-unread-id={(!isSent && msg.status < 2) ? msg.id : undefined}
                className={`message-wrapper ${isSent ? 'sent' : 'received'} ${msg.isNew ? 'new-message' : ''} ${(!isSent && msg.isNew) ? 'fused-morph' : ''}`}
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
                <div className="message-bubble">
                  <div className="message-actions-container">
                    <button 
                      className="msg-action-btn" 
                      title="Reply"
                      aria-label="Reply to message"
                      onClick={() => {
                        setReplyingTo({
                          id: msg.id,
                          sender: msg.sender,
                          text: msg.mediaType ? `[${msg.mediaType}]` : msg.text,
                          mediaType: msg.mediaType || null,
                          fileMetadata: msg.fileMetadata || null
                        });
                        setTimeout(() => {
                          if (textareaRef.current) {
                            textareaRef.current.focus({ preventScroll: false });
                            textareaRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                          }
                        }, 50);
                      }}
                    >
                      <CornerUpLeft size={12} />
                    </button>
                  </div>
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
                  {renderMessageContent(msg, index === messages.length - 1)}
                </div>
                <div className="message-meta">
                  <span>
                    {formatMessageTime(msg.timestamp)}
                  </span>
                  {isSent && (
                    <span className="message-status-ticks" title={msg.status === 2 ? "Read" : msg.status === 1 ? "Delivered" : "Sent"}>
                      {msg.status === 0 && <span style={{ color: 'var(--text-subtle)', marginLeft: '4px', fontSize: '11px', fontWeight: 'bold' }}>✓</span>}
                      {msg.status === 1 && <span style={{ color: 'var(--text-subtle)', marginLeft: '4px', fontSize: '11px', fontWeight: 'bold' }}>✓✓</span>}
                      {msg.status === 2 && <span style={{ color: 'var(--accent-color)', marginLeft: '4px', fontSize: '11px', fontWeight: 'bold' }}>✓✓</span>}
                    </span>
                  )}
                </div>
              </div>
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
    </>
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
  onOpenSafetyModal,
  replyingTo,
  setReplyingTo
}) {
  const [inputText, setInputText] = useState('');
  const [swipeState, setSwipeState] = useState({ msgId: null, offset: 0, isSwiping: false });
  const swipeStartRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const attachMenuRef = useRef(null);
  const attachBtnRef = useRef(null);

  // Close attach popover menu on outside click or Escape key
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        attachMenuRef.current && 
        !attachMenuRef.current.contains(e.target) &&
        attachBtnRef.current &&
        !attachBtnRef.current.contains(e.target)
      ) {
        setShowAttachMenu(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setShowAttachMenu(false);
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
    setShowAttachMenu(false);
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

  // Immediately lift the fusion block if the partner resumes typing
  useEffect(() => {
    if (activeContact?.isTyping) {
      setJustReceivedId(null);
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
    } else if (activeContact?.isTyping) {
      // Pin scroll to bottom dynamically at 60/120fps during the 300ms transition
      if (isLastMessageVisible) {
        const startTime = performance.now();
        let frameId;
        
        const keepScrollAtBottom = (now) => {
          if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
          }
          if (now - startTime < 350) {
            frameId = requestAnimationFrame(keepScrollAtBottom);
          }
        };
        
        frameId = requestAnimationFrame(keepScrollAtBottom);
        return () => cancelAnimationFrame(frameId);
      }
    } else if (currentCount > prevMessageCountRef.current) {
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
    }
    prevMessageCountRef.current = currentCount;
  }, [activeContact?.messages?.length, activeContact?.isTyping]);

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
    e.target.style.height = '36px';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;

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
      textareaRef.current.style.height = '36px';
    }

    if (selectedFiles.length > 0) {
      // Batch send files sequentially
      setUploading(true);
      const filesToUpload = [...selectedFiles];
      setSelectedFiles([]); // Clear queue immediately

      try {
        for (let idx = 0; idx < filesToUpload.length; idx++) {
          const fileToUpload = filesToUpload[idx];
          
          // 1. Read file as ArrayBuffer safely (supporting Android content URI files)
          let fileBuffer;
          try {
            if (typeof fileToUpload.arrayBuffer === 'function') {
              fileBuffer = await fileToUpload.arrayBuffer();
            } else {
              const reader = new FileReader();
              const fileBufferPromise = new Promise((resolve, reject) => {
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = (err) => reject(err || new Error('Device read failed'));
              });
              reader.readAsArrayBuffer(fileToUpload);
              fileBuffer = await fileBufferPromise;
            }
          } catch (readErr) {
            console.error('File read error:', readErr);
            throw new Error(`Device permissions blocked reading "${fileToUpload.name}". Please re-select the file.`);
          }

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

          // 4. Base64 convert
          const encryptedBase64 = bufferToBase64(encryptedFileBuffer);

          // 5. Upload encrypted file payload
          const { fileUrl } = await uploadEncryptedFile(fileToUpload.name, encryptedBase64, currentUserToken);

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
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    
    const validFiles = [];
    for (const f of files) {
      if (f.size > 15 * 1024 * 1024) {
        alert(`File "${f.name}" exceeds 15MB limit.`);
      } else {
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
      mediaRecorderRef.current.start();
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
    } else {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch (e) {}
      }
    }
    
    setIsRecording(false);
  };

  const processAndSendVoiceNote = async (audioBlob) => {
    setUploading(true);
    try {
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
      const extension = audioBlob.type.includes('ogg') ? 'ogg' : audioBlob.type.includes('mp4') ? 'mp4' : 'webm';
      const { fileUrl } = await uploadEncryptedFile(`voice-note.${extension}`, encryptedBase64, currentUserToken);

      // Save original voice blob in local IndexedDB so sender keeps voice note permanently
      setCachedMedia(fileUrl, audioBlob, audioBlob.type || 'audio/webm');

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

      onSendMessage({
        type: 'voice',
        fileMetadata: {
          url: fileUrl,
          name: 'Voice Note',
          size: audioBlob.size,
          mimeType: audioBlob.type || 'audio/webm',
          keyJwk: audioKeyJwk,
          iv: bufferToBase64(iv),
          duration: recordingDurationRef.current
        },
        replyTo: replyContext
      });
      setReplyingTo(null);
      soundEngine.playMessageSent();
    } catch (err) {
      console.error(err);
      alert('Failed to send encrypted voice note.');
    } finally {
      setUploading(false);
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
      console.error(err);
      alert('Failed to decrypt and play voice note.');
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

  // Render message bubble content based on 
  const renderMessageContent = useCallback((msg, isLast) => {
    if (msg.mediaType === 'file') {
      const file = msg.fileMetadata;
      const isImage = file.mimeType.startsWith('image/');
      const isVideo = file.mimeType.startsWith('video/');

      let element;
      if (isImage) {
        element = <ImagePreviewLoader fileMetadata={file} onImageClick={onImageClick} onImageLoad={isLast ? handleImageLoad : undefined} />;
      } else if (isVideo) {
        element = <VideoPreviewLoader fileMetadata={file} />;
      } else {
        element = (
          <div className="file-attachment-card">
            <FileText size={28} className="file-icon" />
            <div className="file-info">
              <div className="file-name" title={file.name}>{file.name}</div>
              <div className="file-size">{(file.size / 1024).toFixed(1)} KB</div>
            </div>
            <button 
              className="file-download-btn" 
              onClick={() => downloadAndDecryptFile(file)}
              title="Download & Decrypt File"
              aria-label="Download & Decrypt File"
            >
              <Download size={16} />
            </button>
          </div>
        );
      }

      return (
        <div className="media-container">
          {element}
          {msg.text && <p className="media-caption">{msg.text}</p>}
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
        <div className="voice-note-player">
          <button 
            className="play-pause-btn" 
            onClick={() => togglePlayAudio(msg.id, file)}
            title={isPlaying ? "Pause voice note" : "Play voice note"}
            aria-label={isPlaying ? "Pause voice note" : "Play voice note"}
          >
            {isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" style={{ marginLeft: '2px' }} />}
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
                // Navigate/seek audio without auto-playing if currently paused
                togglePlayAudio(msg.id, file, seekPct, false);
              }}
              style={{
                background: `linear-gradient(to right, var(--accent-color) ${progress}%, rgba(255, 255, 255, 0.15) ${progress}%)`
              }}
            />
          </div>

          <div className="voice-meta-info">
            <span className="voice-duration">
              {formatTime(currentTimeSec)} / {formatTime(totalDuration)}
            </span>
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

    // Default plaintext
    return msg.text;
  }, [playingAudioId, audioProgress, playbackRate, downloadAndDecryptFile, togglePlayAudio, handlePlaybackRateChange, onImageClick]);

  // Native 120fps GPU compositor scrolling enabled

  return (
    <div className={`chat-area ${isNavigatingBack ? 'navigating-back' : ''}`}>
      {/* Header */}
      <div className="chat-header glass">
        <div className="chat-header-info">
          <button className="back-btn" onClick={onBack} title="Back to menu" aria-label="Back to menu">
            <ArrowLeft size={18} />
          </button>
          {renderAvatar(activeContact.username, activeContact.displayName, activeContact.avatarIcon)}
          <div className="chat-header-name">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeContact.displayName || activeContact.username}
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
        <div className="chat-header-actions">
          <button 
            className={`header-action-btn ${activeContact.isVerified ? 'verified' : ''}`}
            onClick={onOpenSafetyModal}
            title="E2EE Verification & Safety"
            aria-label="E2EE Verification & Safety"
            style={activeContact.isVerified ? { color: 'var(--accent-color)' } : {}}
          >
            <ShieldCheck size={20} />
          </button>
          <button 
            className="header-action-btn" 
            onClick={() => onInitiateCall('voice')}
            title="Secure Voice Call"
            aria-label="Secure Voice Call"
          >
            <Phone size={20} />
          </button>
          <button 
            className="header-action-btn" 
            onClick={() => onInitiateCall('video')}
            title="Secure Video Call"
            aria-label="Secure Video Call"
          >
            <Video size={20} />
          </button>
        </div>
      </div>

      {/* Unsaved Sender warning banner overlay */}
      {activeContact.isSaved === false && (
        <div className="unsaved-contact-banner glass">
          <div className="banner-content">
            <AlertTriangle size={15} className="warning-icon" />
            <span>
              <strong>@{activeContact.username}</strong> is not in your contacts.
            </span>
          </div>
          <div className="banner-actions">
            <button 
              className="banner-btn add-btn"
              onClick={() => onSaveContact(activeContact.username)}
            >
              Add Chat
            </button>
            <button 
              className="banner-btn block-btn"
              onClick={() => onBlockContact(activeContact.username)}
            >
              Delete
            </button>
          </div>
        </div>
      )}



      {/* Messages */}
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
          />
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input controls */}
      <div className="chat-input-wrapper">
        {/* Floating Scroll-to-Bottom Button / Typing Indicator */}
        <button 
          className={`scroll-to-bottom-btn glass ${(!isLastMessageVisible && !isInlineTypingVisible) ? 'visible' : ''} ${(activeContact.isTyping && !isInlineTypingVisible) ? 'typing-active' : ''}`} 
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
        
        <div className={`reply-preview-bar ${replyingTo ? 'glass visible' : ''}`}>
          {activeReplyInfo && (
            <div className="reply-preview-info">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {activeReplyInfo.mediaType === 'file' && activeReplyInfo.fileMetadata?.mimeType?.startsWith('image/') && (
                  <div className="reply-image-thumbnail">
                    <ImagePreviewLoader fileMetadata={activeReplyInfo.fileMetadata} />
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span className="reply-preview-label">Replying to {activeReplyInfo.sender}</span>
                  <span className="reply-preview-text">
                    {activeReplyInfo.mediaType === 'file' && activeReplyInfo.fileMetadata?.mimeType?.startsWith('image/')
                      ? 'Photo'
                      : activeReplyInfo.text
                    }
                  </span>
                </div>
              </div>
            </div>
          )}
          <button 
            className="reply-preview-close" 
            onClick={(e) => {
              e.currentTarget.blur();
              setReplyingTo(null);
            }} 
            title="Cancel reply" 
            aria-label="Cancel reply"
          >
            <X size={16} />
          </button>
        </div>
        
        {/* Attachment preview / uploading progress bar */}
        <div className={`attachment-preview-bar ${(selectedFiles.length > 0 || uploading) ? 'glass visible' : ''}`}>
          {uploading ? (
            <div className="attachment-info" style={{ color: 'var(--accent-color)' }}>
              <Shield size={18} className="shield-shimmer" />
              <span>Encrypting & uploading {selectedFiles.length > 1 ? `${selectedFiles.length} attachments` : 'attachment'}...</span>
            </div>
          ) : selectedFiles.length > 0 ? (
            <div className="multi-file-preview-container">
              {selectedFiles.map((file, idx) => (
                <div key={`${file.name}-${idx}`} className="file-preview-pill">
                  {file.type?.startsWith('image/') ? <Image size={14} /> : <FileText size={14} />}
                  <span className="file-pill-name">{file.name}</span>
                  <button 
                    className="remove-pill-btn" 
                    onClick={() => setSelectedFiles(prev => prev.filter((_, i) => i !== idx))}
                    title="Remove file"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              <button className="clear-all-files-btn" onClick={() => setSelectedFiles([])}>Clear All</button>
            </div>
          ) : null}
        </div>

        {/* Input container */}
        <div className={`chat-input-container ${(selectedFiles.length > 0 || replyingTo) ? 'with-preview' : ''} ${isRecording ? 'is-recording-mode' : ''} glass`}>
          
          <input
            type="file"
            id="file-input"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />

          {showAttachMenu && !isRecording && (
            <div ref={attachMenuRef} className="attach-menu-popover glass">
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
          
          {!isRecording && (
            <button 
              ref={attachBtnRef}
              className={`input-action-btn ${showAttachMenu ? 'active-menu' : ''}`}
              onClick={() => setShowAttachMenu(prev => !prev)}
              title={showAttachMenu ? "Cancel media sharing" : "Share media or files"}
              aria-label={showAttachMenu ? "Cancel media sharing" : "Share media or files"}
              disabled={isRecording}
            >
              <Plus size={20} strokeWidth={2.5} />
            </button>
          )}

          {isRecording ? (
            <div className="recording-banner">
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
              <button className="recording-cancel-btn" onClick={() => stopRecording(false)} title="Cancel recording" aria-label="Cancel recording">
                <Trash2 size={18} />
              </button>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              className="message-textarea"
              placeholder="Write a secure message..."
              value={inputText}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              disabled={uploading}
            />
          )}

          {isRecording ? (
            <button 
              className="send-message-btn voice-send" 
              onClick={() => stopRecording(true)} 
              title="Stop and send voice note"
              aria-label="Stop and send voice note"
            >
              <ArrowUp size={18} strokeWidth={2.5} />
            </button>
          ) : (inputText.trim() || selectedFiles.length > 0) ? (
            <button 
              className="send-message-btn" 
              onClick={handleSendMessage} 
              disabled={(!inputText.trim() && selectedFiles.length === 0) || uploading}
              title="Send Encrypted Message"
              aria-label="Send Encrypted Message"
            >
              <ArrowUp size={16} strokeWidth={3} />
            </button>
          ) : (
            <button 
              className="voice-record-btn idle"
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

function ImagePreviewLoader({ fileMetadata, onImageClick, onImageLoad }) {
  const fileUrl = fileMetadata?.url;
  
  const [imgSrc, setImgSrc] = useState(() => {
    if (fileUrl && globalMediaSessionCache.has(fileUrl)) {
      return globalMediaSessionCache.get(fileUrl).thumbUrl;
    }
    return null;
  });
  const [error, setError] = useState(null);
  const [isLoaded, setIsLoaded] = useState(() => {
    return fileUrl ? globalMediaSessionCache.has(fileUrl) : false;
  });
  const fullResUrlRef = useRef(
    fileUrl && globalMediaSessionCache.has(fileUrl)
      ? globalMediaSessionCache.get(fileUrl).fullUrl
      : null
  );

  useEffect(() => {
    if (!fileUrl) return;

    // Instant hit from global session cache (0ms)
    if (globalMediaSessionCache.has(fileUrl)) {
      const cached = globalMediaSessionCache.get(fileUrl);
      setImgSrc(cached.thumbUrl);
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
        
        const fullUrl = URL.createObjectURL(fullBlob);

        // Downscale for in-chat message bubble preview
        const thumbBlob = await createThumbnailBlob(fullBlob, 480);
        if (!active) return;

        const thumbUrl = (thumbBlob === fullBlob) ? fullUrl : URL.createObjectURL(thumbBlob);

        const cacheEntry = { fullUrl, thumbUrl };
        globalMediaSessionCache.set(fileUrl, cacheEntry);

        fullResUrlRef.current = fullUrl;
        setImgSrc(thumbUrl);
      } catch (err) {
        if (active) setError(err.message || 'Media loading failed');
      }
    };

    loadAndDecrypt();

    return () => {
      active = false;
    };
  }, [fileUrl]);

  if (error) return <span style={{ color: 'var(--text-muted, #a0aec0)', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', padding: '6px 10px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '6px' }}><AlertTriangle size={14} style={{ color: '#e53e3e' }} /> {error}</span>;

  return (
    <div className="image-loader-container">
      {/* Skeleton loader stays visible until image is fully loaded & decoded */}
      {!isLoaded && (
        <div className="image-skeleton-loader">
          <Shield size={20} className="shield-shimmer" />
          <span>Decrypting secure media...</span>
        </div>
      )}
      
      {/* Image tag is mounted if imgSrc exists, but remains hidden until fully loaded */}
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
            opacity: isLoaded ? 1 : 0,
            pointerEvents: isLoaded ? 'auto' : 'none',
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
