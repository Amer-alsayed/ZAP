import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { 
  Send, Shield, Phone, Video, Paperclip, Mic, X, Play, Pause, 
  FileText, Image, Video as VideoIcon, Download, AlertTriangle,
  ArrowLeft, CornerUpLeft, ArrowDown, PhoneOff, VideoOff, ArrowUp, Plus, ShieldCheck
} from 'lucide-react';
import { uploadEncryptedFile } from '../services/api';
import { bufferToBase64, base64ToBuffer } from '../services/crypto';
import { getSocket } from '../services/socket';
import { renderAvatar } from './Sidebar';

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
// Date Separator Helpers
// ==========================================
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
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
              id={`msg-${msg.id}`} 
              ref={index === messages.length - 1 ? lastMessageRef : null}
              data-unread-id={(!isSent && msg.status < 2) ? msg.id : undefined}
              className={`message-wrapper ${isSent ? 'sent' : 'received'} ${msg.isNew ? 'new-message' : ''} ${(!isSent && msg.isNew) ? 'fused-morph' : ''}`}
            >
              <div className="message-bubble">
                <div className="message-actions-container">
                  <button 
                    className="msg-action-btn" 
                    title="Reply"
                    onClick={() => {
                      setReplyingTo({
                        id: msg.id,
                        sender: msg.sender,
                        text: msg.mediaType ? `[${msg.mediaType}]` : msg.text,
                        mediaType: msg.mediaType || null,
                        fileMetadata: msg.fileMetadata || null
                      });
                      setTimeout(() => textareaRef.current?.focus(), 50);
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
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {isSent && (
                  <span className="message-status-ticks" title={msg.status === 2 ? "Read" : msg.status === 1 ? "Delivered" : "Sent"}>
                    {msg.status === 0 && <span style={{ color: 'var(--text-subtle)', marginLeft: '4px', fontSize: '11px', fontWeight: 'bold' }}>✓</span>}
                    {msg.status === 1 && <span style={{ color: 'var(--text-subtle)', marginLeft: '4px', fontSize: '11px', fontWeight: 'bold' }}>✓✓</span>}
                    {msg.status === 2 && <span style={{ color: '#38BDF8', marginLeft: '4px', fontSize: '11px', fontWeight: 'bold' }}>✓✓</span>}
                  </span>
                )}
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

export default function ChatArea({ 
  currentUser,
  activeContact, 
  onSendMessage, 
  onInitiateCall,
  currentUserToken,
  sharedSecret,
  onBack,
  isNavigatingBack,
  markMessageAsReadLocal,
  onImageClick,
  onVerifyContact,
  onSaveContact,
  onBlockContact,
  onOpenSafetyModal,
  replyingTo,
  setReplyingTo
}) {
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  
  const messagesEndRef = useRef(null);

  const localUnreadCount = activeContact.messages
    ? activeContact.messages.filter(m => m.sender === activeContact.username && m.status < 2).length
    : 0;
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const recordingDurationRef = useRef(0);
  const textareaRef = useRef(null);

  // Audio players reference map (for voice note playing)
  const [playingAudioId, setPlayingAudioId] = useState(null);
  const [audioProgress, setAudioProgress] = useState({}); // msgId -> percentage
  const activeAudioRef = useRef(null);
  
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

  useEffect(() => {
    if (replyingTo) {
      setActiveReplyInfo(replyingTo);
    }
  }, [replyingTo]);

  useEffect(() => {
    if (selectedFile) {
      setActiveFileInfo(selectedFile);
    }
  }, [selectedFile]);



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

    // Unmount cleanup: immediately stop typing if the user closes/leaves the chat
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      const currentSocket = getSocket();
      if (currentSocket && currentSocket.connected && isTypingRef.current && prevContactRef.current) {
        currentSocket.emit('typing', { recipient: prevContactRef.current, isTyping: false });
      }
    };
  }, [activeContact.username]);

  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    // Mark as scrolled up the moment the bottom content (typing indicator) begins to get cut off (20px threshold)
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 20;
    isScrolledUpRef.current = !isAtBottom;
    setIsScrolledUp(!isAtBottom);
  };

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
    isScrolledUpRef.current = false;
    setIsScrolledUp(false);
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

  const scrollToMessage = useCallback((msgId) => {
    const element = document.getElementById(`msg-${msgId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.add('highlight-flash');
      setTimeout(() => {
        element.classList.remove('highlight-flash');
      }, 2000);
    }
  }, []);

  const prevMessageCountRef = useRef(0);
  const messagesContainerRef = useRef(null);
  const messagesBounceWrapperRef = useRef(null);

  // Scroll to bottom synchronously on mount / active contact change (runs before paint)
  useLayoutEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
    prevMessageCountRef.current = activeContact?.messages?.length || 0;
    
    // Reset textarea height to 36px baseline
    if (textareaRef.current) {
      textareaRef.current.style.height = '36px';
    }
  }, [activeContact.username]);

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
    // If there's neither text nor an attached file, do nothing
    if (!inputText.trim() && !selectedFile) return;

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

    if (selectedFile) {
      // Send message with file attachment
      if (!sharedSecret) return;
      setUploading(true);
      const fileToUpload = selectedFile;
      setSelectedFile(null); // Clear selected file immediately

      try {
        // 1. Read file as ArrayBuffer
        const reader = new FileReader();
        const fileBufferPromise = new Promise((resolve) => {
          reader.onload = (e) => resolve(e.target.result);
        });
        reader.readAsArrayBuffer(fileToUpload);
        const fileBuffer = await fileBufferPromise;

        // 2. Generate a one-time session key for AES-GCM file encryption
        const fileSessionKey = await window.crypto.subtle.generateKey(
          { name: 'AES-GCM', length: 256 },
          true,
          ['encrypt', 'decrypt']
        );

        // 3. Encrypt the file data
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encryptedFileBuffer = await window.crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          fileSessionKey,
          fileBuffer
        );

        // 4. Convert encrypted file to Base64
        const encryptedBase64 = bufferToBase64(encryptedFileBuffer);

        // 5. Upload encrypted file to server
        const { fileUrl } = await uploadEncryptedFile(fileToUpload.name, encryptedBase64, currentUserToken);

        // 6. Export session key to JWK
        const fileSessionKeyJwk = await window.crypto.subtle.exportKey('jwk', fileSessionKey);

        // 7. Send the file link, key, and caption
        onSendMessage({
          type: 'file',
          text: captionText || null, // send caption text if present
          fileMetadata: {
            url: fileUrl,
            name: fileToUpload.name,
            size: fileToUpload.size,
            mimeType: fileToUpload.type || 'application/octet-stream',
            keyJwk: fileSessionKeyJwk,
            iv: bufferToBase64(iv)
          },
          replyTo: replyContext
        });
      } catch (err) {
        console.error("Encryption/Upload failed:", err);
        alert("Failed to send encrypted file.");
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
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          if (file.size > 15 * 1024 * 1024) {
            alert("File size limit is 15MB for free hosting.");
            return;
          }
          setSelectedFile(file);
          e.preventDefault();
          break;
        }
      }
    }
  };

  // ==========================================
  // File Attachment Handling & E2EE Upload
  // ==========================================
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (file.size > 15 * 1024 * 1024) {
      alert("File size limit is 15MB for free hosting.");
      return;
    }
    
    setSelectedFile(file);
  };



  // ==========================================
  // E2EE File Download & Decrypt
  // ==========================================
  const downloadAndDecryptFile = useCallback(async (fileMetadata) => {
    const { url, name, keyJwk, iv, mimeType } = fileMetadata;

    try {
      // 1. Fetch the encrypted file from server
      const response = await fetch(url);
      const encryptedBuffer = await response.arrayBuffer();

      // 2. Re-import the session key
      const fileSessionKey = await window.crypto.subtle.importKey(
        'jwk',
        keyJwk,
        { name: 'AES-GCM', length: 256 },
        true,
        ['decrypt']
      );

      // 3. Decrypt the file data
      const ivBuffer = base64ToBuffer(iv);
      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBuffer },
        fileSessionKey,
        encryptedBuffer
      );

      // 4. Create and trigger download
      const blob = new Blob([decryptedBuffer], { type: mimeType });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error(err);
      alert('Failed to decrypt and download file. Key may be invalid.');
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

  const stopRecording = (shouldSend = true) => {
    if (!mediaRecorderRef.current || isRecording === false) return;
    
    clearInterval(recordingTimerRef.current);
    
    if (!shouldSend) {
      mediaRecorderRef.current.onstop = null; // discard
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    } else {
      mediaRecorderRef.current.stop();
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

      // 6. Export session key to JWK
      const audioKeyJwk = await window.crypto.subtle.exportKey('jwk', audioKey);

      // 7. Send the voice note metadata encrypted
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
        }
      });
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
  const togglePlayAudio = useCallback(async (msgId, fileMetadata, seekPercentage = null) => {
    // If it's already the active playing audio AND no seek is requested, just pause it!
    if (playingAudioId === msgId && seekPercentage === null) {
      activeAudioRef.current.pause();
      setPlayingAudioId(null);
      return;
    }

    // If it's already playing and we click to seek:
    if (playingAudioId === msgId && seekPercentage !== null && activeAudioRef.current) {
      const newTime = seekPercentage * activeAudioRef.current.duration;
      if (!isNaN(newTime)) {
        activeAudioRef.current.currentTime = newTime;
        setAudioProgress(prev => ({
          ...prev,
          [msgId]: seekPercentage * 100
        }));
      }
      return;
    }

    // Pause any other active audio
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
    }

    try {
      const { url, keyJwk, iv } = fileMetadata;

      // 1. Fetch and decrypt the audio blob
      const response = await fetch(url);
      const encryptedBuffer = await response.arrayBuffer();

      const audioKey = await window.crypto.subtle.importKey(
        'jwk',
        keyJwk,
        { name: 'AES-GCM', length: 256 },
        true,
        ['decrypt']
      );

      const ivBuffer = base64ToBuffer(iv);
      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBuffer },
        audioKey,
        encryptedBuffer
      );

      const blob = new Blob([decryptedBuffer], { type: 'audio/webm' });
      const localUrl = URL.createObjectURL(blob);

      // 2. Play audio
      const audio = new Audio(localUrl);
      activeAudioRef.current = audio;
      setPlayingAudioId(msgId);

      audio.ontimeupdate = () => {
        const progress = (audio.currentTime / audio.duration) * 100;
        setAudioProgress(prev => ({ ...prev, [msgId]: progress }));
      };

      audio.onended = () => {
        setPlayingAudioId(null);
        setAudioProgress(prev => ({ ...prev, [msgId]: 0 }));
        URL.revokeObjectURL(localUrl);
      };

      audio.playbackRate = playbackRate;

      // If seeking before play, we need to set the currentTime when metadata is loaded!
      if (seekPercentage !== null) {
        audio.onloadedmetadata = () => {
          const newTime = seekPercentage * audio.duration;
          if (!isNaN(newTime)) {
            audio.currentTime = newTime;
          }
        };
        // Update progress state immediately
        setAudioProgress(prev => ({
          ...prev,
          [msgId]: seekPercentage * 100
        }));
      }

      audio.play();
    } catch (err) {
      console.error(err);
      alert('Failed to decrypt and play voice note.');
    }
  }, [playingAudioId, playbackRate]);

  const handlePlaybackRateChange = useCallback((newRate) => {
    setPlaybackRate(newRate);
    if (activeAudioRef.current) {
      activeAudioRef.current.playbackRate = newRate;
    }
  }, []);

  const handleWaveformClick = useCallback((e, msgId, fileMetadata) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const clickPercentage = clickX / width;

    togglePlayAudio(msgId, fileMetadata, clickPercentage);
  }, [togglePlayAudio]);

  // Format recording timer: SS or MM:SS
  const formatTime = (secs) => {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins > 0 ? mins + ':' : ''}${remainder.toString().padStart(2, '0')}`;
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

      return (
        <div className="voice-note-player">
          <button className="play-pause-btn" onClick={() => togglePlayAudio(msg.id, file)}>
            {isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" style={{ marginLeft: '2px' }} />}
          </button>
          <div 
            className="voice-waveform" 
            onClick={(e) => handleWaveformClick(e, msg.id, file)}
            style={{ cursor: 'pointer' }}
          >
            <div className="voice-progress" style={{ width: `${progress}%` }} />
          </div>
          <div className="voice-meta-info" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', minWidth: '36px' }}>
            <span className="voice-duration">
              {isPlaying && activeAudioRef.current
                ? formatTime(Math.round(activeAudioRef.current.currentTime))
                : formatTime(file.duration || 0)
              }
            </span>
            <button 
              className="voice-speed-btn" 
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
  }, [playingAudioId, audioProgress, playbackRate, downloadAndDecryptFile, togglePlayAudio, handlePlaybackRateChange, handleWaveformClick, onImageClick]);

  // Hook for elastic overscroll bounce (rubber-banding)
  useEffect(() => {
    const container = messagesContainerRef.current;
    const wrapper = messagesBounceWrapperRef.current;
    if (!container || !wrapper) return;

    let startY = 0;
    let isDragging = false;
    
    // Physics engine state variables
    let position = 0;
    let velocity = 0;
    const tension = 0.08; // Stiffness of the spring
    const damping = 0.48;  // Critically damped friction coefficient (prevents oscillating back and forth)
    let rafId = null;

    // Reset translations
    wrapper.style.transform = 'translate3d(0px, 0px, 0px)';
    wrapper.style.transition = 'none';

    const updatePhysics = () => {
      if (isDragging) return;

      // Physics equations: Force = -k*x (pullback) - c*v (damping)
      const force = -tension * position;
      const friction = -damping * velocity;
      const acceleration = force + friction;
      
      velocity += acceleration;
      position += velocity;

      // Clamp position visual bounds to protect UI layout
      const maxVisualOverscroll = 85;
      if (Math.abs(position) > maxVisualOverscroll) {
        position = Math.sign(position) * maxVisualOverscroll;
        velocity = 0; // Absorb momentum on hitting boundary wall
      }

      // Apply GPU-accelerated translation
      wrapper.style.transform = `translate3d(0px, ${position}px, 0px)`;

      // Loop frame-by-frame until spring settles
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
      
      // Stop spring loop instantly when finger touches the screen mid-bounce
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

      // Touch drag resistance is non-linear (y^0.75) for a natural stretch feel
      if (atTop && deltaY > 0) {
        if (e.cancelable) e.preventDefault();
        position = Math.sign(deltaY) * Math.pow(Math.abs(deltaY), 0.75);
        wrapper.style.transform = `translate3d(0px, ${position}px, 0px)`;
      } else if (atBottom && deltaY < 0) {
        if (e.cancelable) e.preventDefault();
        position = Math.sign(deltaY) * Math.pow(Math.abs(deltaY), 0.75);
        wrapper.style.transform = `translate3d(0px, ${position}px, 0px)`;
      } else {
        // Shift baseline if returning to normal scrolling boundaries
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

        // INJECT kinetic momentum into velocity only (never modify position directly!).
        // This makes trackpad scroll inputs smoothly compound force, avoiding any stuttering
        // since the coordinates are updated exclusively inside the requestAnimationFrame loop.
        velocity -= e.deltaY * 0.045;

        // Start the physics animation loop if it is idle
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

  return (
    <div className={`chat-area ${isNavigatingBack ? 'navigating-back' : ''}`}>
      {/* Header */}
      <div className="chat-header glass">
        <div className="chat-header-info">
          <button className="back-btn" onClick={onBack} title="Back to menu">
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
            style={activeContact.isVerified ? { color: 'var(--accent-color)' } : {}}
          >
            <ShieldCheck size={20} />
          </button>
          <button 
            className="header-action-btn" 
            onClick={() => onInitiateCall('voice')}
            title="Secure Voice Call"
          >
            <Phone size={20} />
          </button>
          <button 
            className="header-action-btn" 
            onClick={() => onInitiateCall('video')}
            title="Secure Video Call"
          >
            <Video size={20} />
          </button>
        </div>
      </div>

      {/* Unsaved Sender warning banner overlay */}
      {activeContact.isSaved === false && (
        <div className="unsaved-contact-banner glass">
          <div className="banner-content">
            <AlertTriangle size={15} className="warning-icon" style={{ color: 'var(--accent-color)' }} />
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
          <button className="reply-preview-close" onClick={() => setReplyingTo(null)}>
            <X size={16} />
          </button>
        </div>
        
        {/* Attachment preview bar */}
        <div className={`attachment-preview-bar ${selectedFile ? 'glass visible' : ''}`}>
          {activeFileInfo && (
            <div className="attachment-info">
              {activeFileInfo.type?.startsWith('image/') ? <Image size={18} /> : <FileText size={18} />}
              <span>{activeFileInfo.name} ({(activeFileInfo.size / 1024).toFixed(1)} KB)</span>
            </div>
          )}
          <button className="remove-attachment-btn" onClick={() => setSelectedFile(null)}>
            <X size={18} />
          </button>
        </div>

        {/* Input container */}
        <div className={`chat-input-container ${(selectedFile || replyingTo) ? 'with-preview' : ''} glass`}>
          
          <input
            type="file"
            id="file-input"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
          
          <button 
            className="input-action-btn"
            onClick={() => document.getElementById('file-input').click()}
            title="Attach file"
            disabled={isRecording}
          >
            <Plus size={20} strokeWidth={2.5} />
          </button>

          {isRecording ? (
            <div className="recording-banner">
              <div className="recording-dot" />
              <span>Recording Voice Note: {formatTime(recordingDuration)}</span>
              <button onClick={() => stopRecording(false)} style={{ marginLeft: 'auto', color: 'var(--text-subtle)' }}>
                Cancel
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
              className="send-message-btn" 
              onClick={() => stopRecording(true)} 
              title="Stop and Send voice note"
              style={{ backgroundColor: 'var(--danger-color)' }}
            >
              <Mic size={18} />
            </button>
          ) : (inputText.trim() || selectedFile) ? (
            <button 
              className="send-message-btn" 
              onClick={handleSendMessage} 
              disabled={(!inputText.trim() && !selectedFile) || uploading}
              title="Send Encrypted Message"
            >
              <ArrowUp size={16} strokeWidth={3} />
            </button>
          ) : (
            <button 
              className="input-action-btn"
              onClick={startRecording}
              title="Record voice note"
              disabled={uploading}
            >
              <Mic size={20} />
            </button>
          )}

        </div>
      </div>
      

    </div>
  );
}

// ==========================================
// Helper component: Decrypted image loader
// ==========================================
function ImagePreviewLoader({ fileMetadata, onImageClick, onImageLoad }) {
  const [imgSrc, setImgSrc] = useState(null);
  const [error, setError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    let localUrl = null;

    const loadAndDecrypt = async () => {
      try {
        const response = await fetch(fileMetadata.url);
        const encryptedBuffer = await response.arrayBuffer();

        const fileSessionKey = await window.crypto.subtle.importKey(
          'jwk',
          fileMetadata.keyJwk,
          { name: 'AES-GCM', length: 256 },
          true,
          ['decrypt']
        );

        const ivBuffer = base64ToBuffer(fileMetadata.iv);
        const decryptedBuffer = await window.crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: ivBuffer },
          fileSessionKey,
          encryptedBuffer
        );

        if (!active) return;
        const blob = new Blob([decryptedBuffer], { type: fileMetadata.mimeType });
        localUrl = URL.createObjectURL(blob);
        setImgSrc(localUrl);
      } catch (err) {
        console.error(err);
        if (active) setError(true);
      }
    };

    loadAndDecrypt();

    return () => {
      active = false;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [fileMetadata]);

  if (error) return <span style={{ color: 'var(--danger-color)', display: 'flex', alignItems: 'center', gap: '4px' }}><AlertTriangle size={14} /> Image Decryption Failed</span>;

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
          onClick={onImageClick ? () => onImageClick(imgSrc) : undefined}
          onLoad={() => {
            setIsLoaded(true);
            if (onImageLoad) onImageLoad();
          }}
          style={{
            opacity: isLoaded ? 1 : 0,
            pointerEvents: isLoaded ? 'auto' : 'none',
            cursor: onImageClick ? 'zoom-in' : 'default'
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

  useEffect(() => {
    let active = true;
    let localUrl = null;

    const loadAndDecrypt = async () => {
      try {
        const response = await fetch(fileMetadata.url);
        const encryptedBuffer = await response.arrayBuffer();

        const fileSessionKey = await window.crypto.subtle.importKey(
          'jwk',
          fileMetadata.keyJwk,
          { name: 'AES-GCM', length: 256 },
          true,
          ['decrypt']
        );

        const ivBuffer = base64ToBuffer(fileMetadata.iv);
        const decryptedBuffer = await window.crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: ivBuffer },
          fileSessionKey,
          encryptedBuffer
        );

        if (!active) return;
        const blob = new Blob([decryptedBuffer], { type: fileMetadata.mimeType });
        localUrl = URL.createObjectURL(blob);
        setVideoSrc(localUrl);
      } catch (err) {
        console.error(err);
        if (active) setError(true);
      }
    };

    loadAndDecrypt();

    return () => {
      active = false;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [fileMetadata]);

  if (error) return <span style={{ color: 'var(--danger-color)', display: 'flex', alignItems: 'center', gap: '4px' }}><AlertTriangle size={14} /> Video Decryption Failed</span>;
  if (!videoSrc) return <span style={{ color: 'var(--text-subtle)' }}>Decrypting Video...</span>;
  return <video className="message-video" src={videoSrc} controls />;
}
