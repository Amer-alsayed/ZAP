import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ShieldAlert, X, ShieldCheck, WifiOff, RefreshCw } from 'lucide-react';

// ==========================================
// E2EE Safety Fingerprint Helper (Synchronous Hash)
// ==========================================
const getSafetyNumber = (keyA, keyB) => {
  if (!keyA || !keyB) return 'N/A';
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

import Login from './components/Login';
import { clearMediaCache } from './services/mediaCache';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import CallWindow from './components/CallWindow';
import SettingsView from './components/SettingsView';
import { soundEngine } from './services/soundEffects';
import Dashboard from './components/Dashboard';

import { searchUser } from './services/api';
import { 
  deriveSharedSecret, 
  encryptMessage, 
  decryptMessage, 
  signData, 
  verifyDataSignature,
  decryptRestoredPrivateKeys,
  base64ToBuffer
} from './services/crypto';
import { 
  connectSocket, 
  disconnectSocket, 
  emitSendMessage, 
  emitGetChatHistory, 
  emitMarkAsRead,
  emitGetUserStatus,
  subscribeToMessages, 
  unsubscribeFromMessages,
  subscribeToUserStatus,
  unsubscribeFromUserStatus,
  getSocket,
  subscribeToProfileUpdates,
  unsubscribeFromProfileUpdates
} from './services/socket';

export default function App() {
  const [currentUser, setCurrentUser] = useState(null); // { username, token, keys }
  const [restoringSession, setRestoringSession] = useState(true);

  // Restore E2EE session on mount
  useEffect(() => {
    const restoreSession = async () => {
      const token = localStorage.getItem('chatra_token');
      const username = localStorage.getItem('chatra_username');
      const sessionEncKeyBase64 = localStorage.getItem('session_enc_key');
      const encPrivateKeysStr = localStorage.getItem('chatra_encrypted_private_keys');
      const pubIdentityKeyStr = localStorage.getItem('chatra_public_identity_key');
      const pubSigningKeyStr = localStorage.getItem('chatra_public_signing_key');
      const displayName = localStorage.getItem('chatra_display_name') || null;
      const avatarIcon = localStorage.getItem('chatra_avatar_icon') || null;

      if (token && username && sessionEncKeyBase64 && encPrivateKeysStr && pubIdentityKeyStr && pubSigningKeyStr) {
        try {
          // 1. Re-import the backup key from base64
          const rawKeyBytes = base64ToBuffer(sessionEncKeyBase64);
          const backupKey = await window.crypto.subtle.importKey(
            'raw',
            rawKeyBytes,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
          );

          // 2. Decrypt the private keys
          const encryptedPrivateKeys = JSON.parse(encPrivateKeysStr);
          const decryptedKeys = await decryptRestoredPrivateKeys(encryptedPrivateKeys, backupKey);

          // 3. Reconstruct currentUser
          setCurrentUser({
            username,
            token,
            displayName,
            avatarIcon,
            encryptedPrivateKeys,
            keys: {
              publicIdentityKey: JSON.parse(pubIdentityKeyStr),
              publicSigningKey: JSON.parse(pubSigningKeyStr),
              privateIdentityKey: decryptedKeys.identityPrivateKey,
              privateSigningKey: decryptedKeys.signingPrivateKey
            }
          });
          console.log('E2EE Session restored successfully.');
        } catch (err) {
          console.error('Failed to restore session:', err);
          // If decryption fails, clean up token to force login
          localStorage.removeItem('chatra_token');
        }
      }
      setRestoringSession(false);
    };

    restoreSession();
  }, []);

  // Apply theme preferences (glass mode and accent color)
  useEffect(() => {
    const glass = localStorage.getItem('chatra_glass') !== 'false';
    if (!glass) {
      document.body.classList.add('flat-theme');
    } else {
      document.body.classList.remove('flat-theme');
    }

    const savedRgb = localStorage.getItem('chatra_theme_rgb');
    if (savedRgb) {
      document.documentElement.style.setProperty('--accent-rgb', savedRgb);
    }
  }, []);

  // Persist currentUser details to localStorage
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('chatra_username', currentUser.username);
      localStorage.setItem('chatra_token', currentUser.token);
      localStorage.setItem('chatra_public_identity_key', JSON.stringify(currentUser.keys.publicIdentityKey));
      localStorage.setItem('chatra_public_signing_key', JSON.stringify(currentUser.keys.publicSigningKey));
      
      if (currentUser.displayName) {
        localStorage.setItem('chatra_display_name', currentUser.displayName);
      } else {
        localStorage.removeItem('chatra_display_name');
      }
      
      if (currentUser.avatarIcon) {
        localStorage.setItem('chatra_avatar_icon', currentUser.avatarIcon);
      } else {
        localStorage.removeItem('chatra_avatar_icon');
      }
      
      if (currentUser.encryptedPrivateKeys) {
        localStorage.setItem('chatra_encrypted_private_keys', JSON.stringify(currentUser.encryptedPrivateKeys));
      }
    }
  }, [currentUser]);
  const [contacts, setContacts] = useState([]);
  const contactsRef = useRef([]);
  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  const [activeContact, setActiveContact] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showRecents, setShowRecents] = useState(false);

  const [isNavigatingBack, setIsNavigatingBack] = useState(false);

  // E2EE Shared Secrets cache: username -> AES-GCM CryptoKey
  const sharedSecrets = useRef({});

  // WebRTC Call Session tracking refs
  const isCallInitiator = useRef(false);
  const callStartTime = useRef(null);

  // ==========================================
  // WebRTC Call States & Refs
  // ==========================================
  const [callState, setCallStateInternal] = useState('idle'); // idle, calling, incoming, connected
  const callStateRef = useRef('idle');
  const setCallState = (val) => {
    setCallStateInternal(val);
    callStateRef.current = val;
  };

  const [callMediaType, setCallMediaTypeInternal] = useState('voice'); // voice, video
  const callMediaTypeRef = useRef('voice');
  const setCallMediaType = (val) => {
    setCallMediaTypeInternal(val);
    callMediaTypeRef.current = val;
  };

  const [callParty, setCallPartyInternal] = useState('');
  const callPartyRef = useRef('');
  const setCallParty = (val) => {
    setCallPartyInternal(val);
    callPartyRef.current = val;
  };

  const [localStream, setLocalStreamInternal] = useState(null);
  const localStreamRef = useRef(null);
  const setLocalStream = (val) => {
    setLocalStreamInternal(val);
    localStreamRef.current = val;
  };

  const [remoteStream, setRemoteStream] = useState(null);

  // Lifted calling feature states and refs
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [remoteScreenSharing, setRemoteScreenSharing] = useState(false);
  const [remoteCameraOff, setRemoteCameraOff] = useState(false);
  const [remoteMuted, setRemoteMuted] = useState(false);

  const [isCallMinimized, setIsCallMinimized] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);

  // Handle call sound effects for calling, incoming, connected, and idle states
  useEffect(() => {
    if (callState === 'calling' || callState === 'ringing') {
      soundEngine.stopIncomingRingtone();
      soundEngine.startOutgoingRingTone();
    } else if (callState === 'incoming') {
      soundEngine.stopOutgoingRingTone();
      soundEngine.startIncomingRingtone();
    } else if (callState === 'connected') {
      soundEngine.stopOutgoingRingTone();
      soundEngine.stopIncomingRingtone();
      soundEngine.playCallConnected();
    } else if (callState === 'idle') {
      soundEngine.stopOutgoingRingTone();
      soundEngine.stopIncomingRingtone();
    }
  }, [callState]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const isCallMinimizedRef = useRef(false);
  const replyingToRef = useRef(null);

  useEffect(() => {
    isCallMinimizedRef.current = isCallMinimized;
  }, [isCallMinimized]);

  useEffect(() => {
    replyingToRef.current = replyingTo;
  }, [replyingTo]);

  const dummyTrackRef = useRef(null);
  const originalVideoTrackRef = useRef(null);

  const [lightboxImageSrc, setLightboxImageSrc] = useState(null);
  const [activeLightboxSrc, setActiveLightboxSrc] = useState(null);
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [isSafetyModalClosing, setIsSafetyModalClosing] = useState(false);

  const handleCloseSafetyModal = () => {
    setIsSafetyModalClosing(true);
    setTimeout(() => {
      setShowSafetyModal(false);
      setIsSafetyModalClosing(false);
    }, 250);
  };
  const [sidebarMinimized, setSidebarMinimized] = useState(() => {
    return localStorage.getItem('chatra_sidebar_minimized') === 'true';
  });
  const [isSidebarAnimating, setIsSidebarAnimating] = useState(false);
  const sidebarAnimTimerRef = useRef(null);

  const handleToggleSidebar = useCallback(() => {
    if (sidebarAnimTimerRef.current) clearTimeout(sidebarAnimTimerRef.current);
    setIsSidebarAnimating(true);
    setSidebarMinimized(prev => !prev);
    sidebarAnimTimerRef.current = setTimeout(() => {
      setIsSidebarAnimating(false);
    }, 380);
  }, []);

  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize, { passive: true });
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    localStorage.setItem('chatra_sidebar_minimized', sidebarMinimized);
  }, [sidebarMinimized]);
  const lightboxRef = useRef(null);
  useEffect(() => {
    lightboxRef.current = lightboxImageSrc;
    if (lightboxImageSrc) {
      setActiveLightboxSrc(lightboxImageSrc);
    }
  }, [lightboxImageSrc]);

  // Network & Socket Connectivity tracking state
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSocketConnected, setIsSocketConnected] = useState(true);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleOpenSafetyModal = useCallback(() => {
    setShowSafetyModal(true);
  }, []);

  const handleOpenLightbox = (src) => {
    setLightboxImageSrc(src);
    if (window.history.state !== 'lightbox') {
      window.history.pushState('lightbox', '');
    }
  };

  const handleCloseLightbox = (e) => {
    if (e && typeof e.stopPropagation === 'function') {
      e.stopPropagation();
    }
    setLightboxImageSrc(null);
    if (window.history.state === 'lightbox') {
      window.history.replaceState(activeContactRef.current ? 'chat' : null, '');
    }
  };

  const peerConnectionRef = useRef(null);
  const pendingOfferRef = useRef(null);
  const iceCandidatesQueue = useRef([]);

  const pcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.services.mozilla.com:3478' },
      { urls: 'stun:stun.nextcloud.com:443' },
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelay',
        credential: 'openrelay'
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelay',
        credential: 'openrelay'
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelay',
        credential: 'openrelay'
      }
    ]
  };

  // Load contacts list on login & restore active chat state synchronously
  useEffect(() => {
    if (currentUser) {
      const stored = localStorage.getItem(`contacts_${currentUser.username}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        
        // Deduplicate loaded contacts by lowercase username (heals old corrupt data)
        const uniqueContacts = [];
        const seen = new Set();
        for (const contact of parsed) {
          const lowerName = contact.username.toLowerCase();
          if (!seen.has(lowerName)) {
            seen.add(lowerName);
            uniqueContacts.push(contact);
          }
        }

        // Reset online status on load
        const sanitized = uniqueContacts.map(c => ({ ...c, status: 'offline', messages: c.messages || [] }));
        setContacts(sanitized);
      }
    }
  }, [currentUser]);

  // Persist contacts when they change
  useEffect(() => {
    if (currentUser && contacts.length > 0) {
      // Deduplicate before saving to localStorage
      const uniqueContacts = [];
      const seen = new Set();
      for (const contact of contacts) {
        const lowerName = contact.username.toLowerCase();
        if (!seen.has(lowerName)) {
          seen.add(lowerName);
          uniqueContacts.push(contact);
        }
      }
      try {
        localStorage.setItem(`contacts_${currentUser.username}`, JSON.stringify(uniqueContacts));
      } catch (err) {
        console.warn('LocalStorage quota exceeded while persisting chat history:', err.message);
      }
    }
  }, [contacts, currentUser]);

  // Sync active contact messages
  const activeContactRef = useRef(null);
  const showSettingsRef = useRef(false);
  const showRecentsRef = useRef(false);
  const previousActiveContactRef = useRef(null);
  const hasRestoredNavRef = useRef(false);

  useEffect(() => {
    activeContactRef.current = activeContact;
    if (activeContact) {
      // Mark read
      emitMarkAsRead(activeContact.username);
      setContacts(prev => prev.map(c => 
        c.username === activeContact.username ? { ...c, unreadCount: 0 } : c
      ));
    }
  }, [activeContact]);

  const showSafetyModalRef = useRef(false);

  useEffect(() => {
    showSettingsRef.current = showSettings;
  }, [showSettings]);

  useEffect(() => {
    showRecentsRef.current = showRecents;
  }, [showRecents]);

  useEffect(() => {
    showSafetyModalRef.current = showSafetyModal;
  }, [showSafetyModal]);



  // Handle native back gestures (Android back button & mobile browser back)
  useEffect(() => {
    const handlePopState = (e) => {
      // 0. Ignore popstate if it's from voice recording
      if (window.__isChatraRecording || window.__isPoppingRecording) {
        return;
      }

      // 1. Close lightbox viewer if active
      if (lightboxRef.current) {
        setLightboxImageSrc(null);
        return;
      }

      // 2. Close safety verification modal if active
      if (showSafetyModalRef.current) {
        handleCloseSafetyModal();
        return;
      }
      
      // 3. Exit fullscreen mode if active
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
        return;
      }
      
      // 4. Minimize full-screen WebRTC call if active
      if (callStateRef.current === 'connected' && !isCallMinimizedRef.current) {
        setIsCallMinimized(true);
        return;
      }
      
      // 5. Dismiss active message reply banner if active
      if (replyingToRef.current) {
        setReplyingTo(null);
        return;
      }

      // 6. Return to sidebar / contacts list if we are inside a chat, settings, or recents view
      if (activeContactRef.current || showSettingsRef.current || showRecentsRef.current) {
        handleBackToMenu(true);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Sync document level fullscreen events with state
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Manage history state 'reply' when message reply mode is active
  useEffect(() => {
    if (replyingTo) {
      if (window.history.state !== 'reply') {
        window.history.pushState('reply', '');
      }
    }
  }, [replyingTo]);

  // Push history state 'call-maximized' when active call window is maximized
  useEffect(() => {
    const isMaximizedCallActive = callState === 'connected' && !isCallMinimized;
    if (isMaximizedCallActive) {
      if (window.history.state !== 'call-maximized' && window.history.state !== 'fullscreen') {
        window.history.pushState('call-maximized', '');
      }
    } else {
      if (window.history.state === 'call-maximized') {
        window.history.back();
      }
    }
  }, [callState, isCallMinimized]);

  // Push history state 'fullscreen' when fullscreen mode is active
  useEffect(() => {
    if (isFullscreen) {
      if (window.history.state !== 'fullscreen') {
        window.history.pushState('fullscreen', '');
      }
    } else {
      if (window.history.state === 'fullscreen') {
        window.history.back();
      }
    }
  }, [isFullscreen]);


  // ==========================================
  // Socket.io Connection & Events Setup
  // ==========================================
  useEffect(() => {
    if (!currentUser) return;

    // Connect WebSocket
    const socket = connectSocket(currentUser.token);

    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err);

      const msg = err?.message || '';

      // Authentication errors: token is invalid or expired (e.g. server restarted with new JWT secret)
      // Force a clean logout so the user can log back in and get a fresh token.
      const isAuthError = msg.includes('Authentication error') || msg.includes('Invalid token') || msg.includes('jwt');
      const isDbReset = msg.includes('database reset');

      if (isAuthError || isDbReset) {
        const reason = isDbReset
          ? 'Your session has expired because the server database was reset. Please register/login again.'
          : 'Your session has expired. Please log in again.';

        localStorage.removeItem('session_enc_key');
        localStorage.removeItem('chatra_username');
        localStorage.removeItem('chatra_token');
        localStorage.removeItem('chatra_encrypted_private_keys');
        localStorage.removeItem('chatra_public_identity_key');
        localStorage.removeItem('chatra_public_signing_key');
        localStorage.removeItem('chatra_display_name');
        localStorage.removeItem('chatra_avatar_icon');
        setCurrentUser(null);
        setContacts([]);
        setActiveContact(null);
        setShowSettings(false);
        sharedSecrets.current = {};
        alert(reason);
      }
    });

    const syncOfflineMessages = async () => {
      if (!currentUser) return;
      const list = contactsRef.current;
      for (const contact of list) {
        try {
          const encryptedHistory = await emitGetChatHistory(contact.username);
          const decryptedMessages = await decryptMessagesBatch(encryptedHistory, contact);
          const isActive = activeContactRef.current && 
            activeContactRef.current.username.toLowerCase() === contact.username.toLowerCase();

          let unreadCount = 0;
          const processedMessages = decryptedMessages.map(m => {
            const isReceived = m.sender.toLowerCase() === contact.username.toLowerCase();
            if (isReceived) {
              if (isActive) {
                return { ...m, status: 2 };
              } else if (m.status < 2) {
                unreadCount++;
              }
            }
            return m;
          });

          setContacts(prev => prev.map(c => {
            if (c.username.toLowerCase() === contact.username.toLowerCase()) {
              return {
                ...c,
                unreadCount: unreadCount,
                messages: processedMessages
              };
            }
            return c;
          }));

          if (isActive) {
            setActiveContact(prev => {
              if (prev && prev.username.toLowerCase() === contact.username.toLowerCase()) {
                return {
                  ...prev,
                  messages: processedMessages
                };
              }
              return prev;
            });
            emitMarkAsRead(contact.username);
          }
        } catch (err) {
          console.error('Failed to background sync chat history for:', contact.username, err);
        }
      }
    };

    const handleConnect = () => {
      setIsSocketConnected(true);
      contactsRef.current.forEach(async (c) => {
        try {
          const res = await emitGetUserStatus(c.username);
          updateContactProfileAndStatus(c.username, res.status, res.displayName, res.avatarIcon);
        } catch (e) {
          console.error('Failed to fetch status for contact:', c.username, e);
        }
      });
      syncOfflineMessages();
    };

    const handleDisconnect = () => {
      setIsSocketConnected(false);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleDisconnect);
    if (socket.connected) {
      handleConnect();
    }

    // Subscribe to incoming E2EE messages
    const handleIncomingMessage = async (msg) => {
      try {
        if (processAndAppendMessageRef.current) {
          await processAndAppendMessageRef.current(msg, false);
          soundEngine.playMessageReceived();
        }
      } catch (err) {
        console.error('Failed to process incoming message:', err);
      }
    };
    subscribeToMessages(handleIncomingMessage);

    // Subscribe to online status changes
    const handleStatusChange = ({ username, status }) => {
      if (status === 'online') {
        soundEngine.playUserOnline();
      }
      updateContactProfileAndStatus(username, status);
    };
    subscribeToUserStatus(handleStatusChange);

    // Subscribe to realtime profile updates
    const handleProfileUpdate = ({ username, displayName, avatarIcon }) => {
      updateContactProfileAndStatus(username, undefined, displayName, avatarIcon);
    };
    subscribeToProfileUpdates(handleProfileUpdate);

    // Subscribe to typing indicators
    socket.on('user-typing', ({ username, isTyping }) => {
      setContacts(prev => prev.map(c => 
        c.username.toLowerCase() === username.toLowerCase() ? { ...c, isTyping } : c
      ));
      if (activeContactRef.current?.username.toLowerCase() === username.toLowerCase()) {
        setActiveContact(prev => prev ? { ...prev, isTyping } : null);
      }
    });

    // Subscribe to message status tick indicators (delivered and read)
    socket.on('messages-delivered', ({ recipient }) => {
      setContacts(prev => prev.map(c => {
        if (c.username.toLowerCase() === recipient.toLowerCase()) {
          return {
            ...c,
            messages: c.messages.map(m => 
              m.sender.toLowerCase() === currentUser.username.toLowerCase() && m.status === 0
                ? { ...m, status: 1 } 
                : m
            )
          };
        }
        return c;
      }));
      if (activeContactRef.current?.username.toLowerCase() === recipient.toLowerCase()) {
        setActiveContact(prev => prev ? {
          ...prev,
          messages: prev.messages.map(m => 
            m.sender.toLowerCase() === currentUser.username.toLowerCase() && m.status === 0
              ? { ...m, status: 1 }
              : m
          )
        } : null);
      }
    });

    socket.on('messages-read', ({ reader }) => {
      setContacts(prev => prev.map(c => {
        if (c.username.toLowerCase() === reader.toLowerCase()) {
          return {
            ...c,
            messages: c.messages.map(m => 
              m.sender.toLowerCase() === currentUser.username.toLowerCase() && m.status < 2
                ? { ...m, status: 2 } 
                : m
            )
          };
        }
        return c;
      }));
      if (activeContactRef.current?.username.toLowerCase() === reader.toLowerCase()) {
        setActiveContact(prev => prev ? {
          ...prev,
          messages: prev.messages.map(m => 
            m.sender.toLowerCase() === currentUser.username.toLowerCase() && m.status < 2
              ? { ...m, status: 2 }
              : m
          )
        } : null);
      }
    });

    // ==========================================
    // WebRTC Socket Signaling listeners
    // ==========================================
    socket.on('call-made', async ({ from, offer, mediaType }) => {
      console.log(`Received call offer from ${from} (${mediaType})`);
      if (callStateRef.current !== 'idle') {
        console.log(`Busy: Auto-declining incoming call from ${from} since active callState is ${callStateRef.current}`);
        socket.emit('hang-up', { to: from });
        return;
      }
      pendingOfferRef.current = offer;
      isCallInitiator.current = false;
      setCallMediaType(mediaType);
      setCallParty(from);
      setCallState('incoming');
    });

    socket.on('answer-made', async ({ answer, from }) => {
      console.log(`Received call answer from ${from}`);
      if (peerConnectionRef.current) {
        try {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
          
          // Flush any ICE candidates queued before remoteDescription was set
          while (iceCandidatesQueue.current.length > 0) {
            const cand = iceCandidatesQueue.current.shift();
            try {
              await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(cand));
            } catch (e) {
              console.error('Error adding queued ICE candidate on caller:', e);
            }
          }

          callStartTime.current = Date.now();
          setCallState('connected');
        } catch (err) {
          console.error('Error setting remote description from answer:', err);
          cleanupCall(true, 'Connection failed');
        }
      }
    });

    socket.on('call-ringing', ({ from }) => {
      console.log(`Call is ringing on ${from}'s device`);
      setCallState('ringing');
    });

    socket.on('ice-candidate-relay', async ({ candidate, from }) => {
      console.log(`Received ICE candidate from ${from}`);
      if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription) {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        iceCandidatesQueue.current.push(candidate);
      }
    });

    socket.on('call-ended', ({ from, reason }) => {
      console.log(`Call hung up by ${from}, reason: ${reason}`);
      cleanupCall(true, reason);
    });

    socket.on('call-media-updated', ({ from, mediaType, screenSharing, cameraOff, muted }) => {
      console.log(`Call media updated by ${from}. mediaType: ${mediaType}, screenSharing: ${screenSharing}, cameraOff: ${cameraOff}, muted: ${muted}`);
      setCallMediaType(mediaType);
      setRemoteScreenSharing(screenSharing);
      setRemoteCameraOff(!!cameraOff);
      setRemoteMuted(!!muted);
    });

    socket.on('call-error', ({ message }) => {
      alert(message);
      cleanupCall(true);
    });
    return () => {
      unsubscribeFromMessages(handleIncomingMessage);
      unsubscribeFromUserStatus(handleStatusChange);
      unsubscribeFromProfileUpdates(handleProfileUpdate);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleDisconnect);
      socket.off('user-typing');
      socket.off('messages-delivered');
      socket.off('messages-read');
      socket.off('call-made');
      socket.off('call-ringing');
      socket.off('answer-made');
      socket.off('ice-candidate-relay');
      socket.off('call-ended');
      socket.off('call-error');
      disconnectSocket();
    };
  }, [currentUser?.username, currentUser?.token]);

  const updateContactProfileAndStatus = (username, status, displayName = undefined, avatarIcon = undefined) => {
    setContacts(prev => prev.map(c => {
      if (c.username.toLowerCase() === username.toLowerCase()) {
        const changes = {};
        if (status !== undefined && c.status !== status) changes.status = status;
        if (displayName !== undefined && c.displayName !== displayName) changes.displayName = displayName;
        if (avatarIcon !== undefined && c.avatarIcon !== avatarIcon) changes.avatarIcon = avatarIcon;
        
        if (Object.keys(changes).length === 0) return c;
        return { ...c, ...changes };
      }
      return c;
    }));
    if (activeContactRef.current?.username.toLowerCase() === username.toLowerCase()) {
      setActiveContact(prev => {
        if (!prev) return prev;
        const changes = {};
        if (status !== undefined && prev.status !== status) changes.status = status;
        if (displayName !== undefined && prev.displayName !== displayName) changes.displayName = displayName;
        if (avatarIcon !== undefined && prev.avatarIcon !== avatarIcon) changes.avatarIcon = avatarIcon;
        
        if (Object.keys(changes).length === 0) return prev;
        return { ...prev, ...changes };
      });
    }
  };

  // ==========================================
  // E2EE Helper: Get or Derive Shared Secret
  // ==========================================
  const getSharedSecret = async (contact) => {
    const usernameKey = contact.username.toLowerCase();
    if (sharedSecrets.current[usernameKey]) {
      return sharedSecrets.current[usernameKey];
    }

    // Derive new key using ECDH Diffie-Hellman
    const secret = await deriveSharedSecret(
      currentUser.keys.privateIdentityKey,
      contact.publicIdentityKey
    );
    sharedSecrets.current[usernameKey] = secret;
    return secret;
  };

  // Pre-derive E2EE session key in background as soon as activeContact is selected
  useEffect(() => {
    if (activeContact && currentUser?.keys?.privateIdentityKey && activeContact.publicIdentityKey) {
      getSharedSecret(activeContact).catch(err => console.error('Key pre-derivation error:', err));
    }
  }, [activeContact, currentUser]);

  // ==========================================
  // E2EE Sending Messaging Flow
  // ==========================================
  const handleSendMessage = async (msgContent) => {
    if (!activeContact || !currentUser) return;
    const recipient = activeContact.username;

    try {
      // 1. Get E2EE Symmetric shared key
      const sharedSecret = await getSharedSecret(activeContact);

      // 2. Encrypt the payload string (contains text or file details)
      const payloadString = JSON.stringify(msgContent);
      const { ciphertext, iv } = await encryptMessage(payloadString, sharedSecret);

      // 3. Sign the ciphertext with our private signing key
      const signature = await signData(ciphertext, currentUser.keys.privateSigningKey);

      // 4. Send encrypted payload via WebSockets
      const ack = await emitSendMessage(recipient, ciphertext, iv, signature);

      // 5. Append locally (instantly decrypt it back or just use the local message object)
      const localMsg = {
        id: ack.messageId,
        sender: currentUser.username,
        recipient,
        timestamp: ack.timestamp,
        text: msgContent.text || '',
        mediaType: msgContent.type !== 'text' ? msgContent.type : null,
        fileMetadata: msgContent.fileMetadata || null,
        status: ack.status,
        replyTo: msgContent.replyTo || null,
        isNew: true
      };

      appendMessageToContact(recipient, localMsg);
    } catch (err) {
      console.error('E2EE encryption/sending failed:', err);
      alert(`Failed to send message: ${err.message || 'Unknown error'}`);
    }
  };

  // ==========================================
  // E2EE Receiving & Decryption Messaging Flow
  // ==========================================
  const processAndAppendMessage = async (msg, isHistorical = false) => {
    const isSentByMe = msg.sender.toLowerCase() === currentUser.username.toLowerCase();
    const chatPartner = isSentByMe ? msg.recipient : msg.sender;

    // 1. Find or fetch contact details (public keys)
    let contact = contacts.find(c => c.username.toLowerCase() === chatPartner.toLowerCase());
    let contactKeys = null;

    if (!contact) {
      // Fetch public keys from server database (Prevents identity spoofing)
      try {
        const publicKeys = await searchUser(chatPartner, currentUser.token);
        contactKeys = publicKeys;
        contact = {
          username: publicKeys.username,
          publicIdentityKey: publicKeys.publicIdentityKey,
          publicSigningKey: publicKeys.publicSigningKey
        };

        // Dynamically fetch and update online status for the newly discovered contact
        const socket = getSocket();
        if (socket && socket.connected) {
          emitGetUserStatus(publicKeys.username)
            .then(res => {
              if (res) {
                updateContactProfileAndStatus(publicKeys.username, res.status, res.displayName, res.avatarIcon);
              }
            })
            .catch(e => console.error('Failed to fetch status for dynamic contact:', e));
        }
      } catch (err) {
        console.error('Could not fetch public keys for unknown sender:', chatPartner, err);
        return;
      }
    }

    try {
      // 2. Derive shared secret key
      const secret = await getSharedSecret(contact);

      // 3. Verify digital signature using sender's public signing key
      const senderPubKey = msg.sender.toLowerCase() === currentUser.username.toLowerCase()
        ? currentUser.keys.publicSigningKey
        : contact.publicSigningKey;

      const isSignatureValid = await verifyDataSignature(
        msg.ciphertext,
        msg.signature,
        senderPubKey
      );

      if (!isSignatureValid) {
        console.error('WARNING: E2EE Signature Verification FAILED! Message tampered.');
        appendMessageToContact(chatPartner, {
          id: msg.id,
          sender: msg.sender,
          recipient: msg.recipient,
          timestamp: msg.timestamp,
          text: '⚠️ ERROR: Message failed cryptographic integrity verification.',
          mediaType: 'text',
          status: msg.delivered
        }, false, contactKeys);
        return;
      }

      // 4. Decrypt E2EE ciphertext
      const decryptedString = await decryptMessage(msg.ciphertext, secret, msg.iv);
      const decryptedPayload = JSON.parse(decryptedString);

      // 5. Format and append message
      const decryptedMsg = {
        id: msg.id,
        sender: msg.sender,
        recipient: msg.recipient,
        timestamp: msg.timestamp,
        text: decryptedPayload.text || '',
        mediaType: decryptedPayload.type !== 'text' ? decryptedPayload.type : null,
        fileMetadata: decryptedPayload.fileMetadata || null,
        status: msg.delivered,
        replyTo: decryptedPayload.replyTo || null,
        isNew: !isHistorical
      };

      appendMessageToContact(chatPartner, decryptedMsg, !isSentByMe && !isHistorical, contactKeys);
    } catch (err) {
      console.error('Decryption failed for message ID:', msg.id, err);
      appendMessageToContact(chatPartner, {
        id: msg.id,
        sender: msg.sender,
        recipient: msg.recipient,
        timestamp: msg.timestamp,
        text: '❌ Decryption Failed: Secure keys mismatch.',
        mediaType: 'text',
        status: msg.delivered
      }, false, contactKeys);
    }
  };

  const processAndAppendMessageRef = useRef(null);
  processAndAppendMessageRef.current = processAndAppendMessage;

  // Append a message to a contact's list in React state
  const appendMessageToContact = (contactName, msg, incrementUnread = false, contactKeys = null) => {
    setContacts(prev => {
      const exists = prev.some(c => c.username.toLowerCase() === contactName.toLowerCase());

      if (exists) {
        return prev.map(c => {
          if (c.username.toLowerCase() === contactName.toLowerCase()) {
            if (msg.id && c.messages.some(m => m.id === msg.id)) return c;

            const isCurrentActive = activeContactRef.current?.username.toLowerCase() === contactName.toLowerCase();
            return {
              ...c,
              unreadCount: incrementUnread && !isCurrentActive ? (c.unreadCount || 0) + 1 : c.unreadCount,
              messages: [...c.messages, msg]
            };
          }
          return c;
        });
      } else {
        // If the contact does not exist in state, create them atomically
        if (!contactKeys) return prev;

        return [...prev, {
          username: contactKeys.username,
          publicIdentityKey: contactKeys.publicIdentityKey,
          publicSigningKey: contactKeys.publicSigningKey,
          status: 'offline',
          unreadCount: incrementUnread ? 1 : 0,
          messages: [msg],
          isSaved: false
        }];
      }
    });

    // Update active contact view if matching
    if (activeContactRef.current?.username.toLowerCase() === contactName.toLowerCase()) {
      setActiveContact(prev => {
        if (!prev) return null;
        if (prev.messages.some(m => m.id === msg.id)) return prev;
        return { ...prev, messages: [...prev.messages, msg] };
      });
      // Acknowledge read if open
      if (!isHistoricalRead(msg)) {
        emitMarkAsRead(contactName);
      }
    }

    // Schedule clearing of the isNew flag so it doesn't re-animate on subsequent updates
    if (msg.isNew) {
      setTimeout(() => {
        setContacts(prev => prev.map(c => {
          if (c.username.toLowerCase() === contactName.toLowerCase()) {
            return {
              ...c,
              messages: c.messages.map(m => m.id === msg.id ? { ...m, isNew: false } : m)
            };
          }
          return c;
        }));
        if (activeContactRef.current?.username.toLowerCase() === contactName.toLowerCase()) {
          setActiveContact(prev => {
            if (!prev) return null;
            if (!prev.messages.some(m => m.id === msg.id && m.isNew)) return prev;
            return {
              ...prev,
              messages: prev.messages.map(m => m.id === msg.id ? { ...m, isNew: false } : m)
            };
          });
        }
      }, 1000);
    }
  };

  const isHistoricalRead = (msg) => {
    return msg.sender.toLowerCase() === currentUser.username.toLowerCase();
  };

  // ==========================================
  // Fetching Chat History (Phase 4)
  // ==========================================
  const decryptMessagesBatch = async (encryptedMsgs, contact) => {
    const decryptedMsgs = [];
    const secret = await getSharedSecret(contact);

    for (const msg of encryptedMsgs) {
      try {
        const senderPubKey = msg.sender.toLowerCase() === currentUser.username.toLowerCase()
          ? currentUser.keys.publicSigningKey
          : contact.publicSigningKey;

        const isSignatureValid = await verifyDataSignature(
          msg.ciphertext,
          msg.signature,
          senderPubKey
        );

        if (!isSignatureValid) {
          decryptedMsgs.push({
            id: msg.id,
            sender: msg.sender,
            recipient: msg.recipient,
            timestamp: msg.timestamp,
            text: '⚠️ ERROR: Message failed cryptographic integrity verification.',
            mediaType: 'text',
            status: msg.delivered
          });
          continue;
        }

        const decryptedString = await decryptMessage(msg.ciphertext, secret, msg.iv);
        const decryptedPayload = JSON.parse(decryptedString);

        decryptedMsgs.push({
          id: msg.id,
          sender: msg.sender,
          recipient: msg.recipient,
          timestamp: msg.timestamp,
          text: decryptedPayload.text || '',
          mediaType: decryptedPayload.type !== 'text' ? decryptedPayload.type : null,
          fileMetadata: decryptedPayload.fileMetadata || null,
          status: msg.delivered,
          replyTo: decryptedPayload.replyTo || null
        });
      } catch (err) {
        console.error('Decryption failed for message ID:', msg.id, err);
        decryptedMsgs.push({
          id: msg.id,
          sender: msg.sender,
          recipient: msg.recipient,
          timestamp: msg.timestamp,
          text: '❌ Decryption Failed: Secure keys mismatch.',
          mediaType: 'text',
          status: msg.delivered
        });
      }
    }
    return decryptedMsgs;
  };

  const handleSelectContact = async (contact) => {
    if (window.history.state !== 'chat') {
      window.history.pushState('chat', '');
    }
    setShowSettings(false);
    setShowRecents(false);

    // 1. Instantly display active contact screen with cached messages to avoid blank page delays
    const cachedContact = contacts.find(c => c.username.toLowerCase() === contact.username.toLowerCase());
    const targetContact = cachedContact || contact;
    setActiveContact(targetContact);

    try {
      // 2. Fetch conversation history from SQLite in the background
      const encryptedHistory = await emitGetChatHistory(contact.username);

      // 3. Decrypt the batch of messages in memory
      const decryptedMessages = await decryptMessagesBatch(encryptedHistory, contact);

      // Mark all received messages as read since we are opening the chat
      const readMessages = decryptedMessages.map(m => 
        m.sender.toLowerCase() === contact.username.toLowerCase()
          ? { ...m, status: 2 }
          : m
      );

      // 4. Update the state with the fully loaded messages in a single batch update
      setContacts(prev => prev.map(c => {
        if (c.username.toLowerCase() === contact.username.toLowerCase()) {
          return {
            ...c,
            unreadCount: 0,
            messages: readMessages
          };
        }
        return c;
      }));

      // 5. Update active contact view dynamically with decrypted messages once resolved
      setActiveContact(prev => {
        if (prev && prev.username.toLowerCase() === contact.username.toLowerCase()) {
          return {
            ...prev,
            messages: readMessages
          };
        }
        return prev;
      });

      // 6. Send mark-as-read acknowledgement to the server
      emitMarkAsRead(contact.username);
    } catch (err) {
      console.error('Failed to fetch chat history from DB:', err);
    }
  };

  const markMessageAsReadLocal = useCallback((msgId) => {
    const targetId = typeof msgId === 'string' && !isNaN(msgId) ? Number(msgId) : msgId;
    setContacts(prev => prev.map(c => {
      return {
        ...c,
        messages: c.messages.map(m => m.id === targetId ? { ...m, status: 2 } : m)
      };
    }));
    setActiveContact(prev => {
      if (!prev) return null;
      return {
        ...prev,
        messages: prev.messages.map(m => m.id === targetId ? { ...m, status: 2 } : m)
      };
    });
  }, []);

  const markAllMessagesAsReadLocal = useCallback((contactUsername) => {
    if (!contactUsername) return;
    const lowerUser = contactUsername.toLowerCase();
    setContacts(prev => prev.map(c => {
      if (c.username.toLowerCase() === lowerUser) {
        return {
          ...c,
          unreadCount: 0,
          messages: c.messages.map(m => m.sender.toLowerCase() === lowerUser ? { ...m, status: 2 } : m)
        };
      }
      return c;
    }));
    setActiveContact(prev => {
      if (!prev || prev.username.toLowerCase() !== lowerUser) return prev;
      return {
        ...prev,
        unreadCount: 0,
        messages: prev.messages.map(m => m.sender.toLowerCase() === lowerUser ? { ...m, status: 2 } : m)
      };
    });
    emitMarkAsRead(contactUsername);
  }, []);

  // Add Contact manual search handler
  const handleAddContact = async (contact) => {
    const existing = contacts.find(c => c.username.toLowerCase() === contact.username.toLowerCase());
    if (existing) {
      setContacts(prev => prev.map(c => c.username.toLowerCase() === contact.username.toLowerCase() ? { ...c, isSaved: true } : c));
      setActiveContact({ ...existing, isSaved: true });
    } else {
      const savedContact = { ...contact, isSaved: true, messages: [] };
      setContacts(prev => [...prev, savedContact]);
      setActiveContact(savedContact);
    }

    // Dynamically query online status for the newly added contact immediately
    const socket = getSocket();
    if (socket && socket.connected) {
      try {
        const res = await emitGetUserStatus(contact.username);
        updateContactProfileAndStatus(contact.username, res.status, res.displayName, res.avatarIcon);
      } catch (e) {
        console.error(e);
      }
    }
  };

  // Helper: Verify / Unverify safety numbers
  const handleVerifyContact = (username, isVerified) => {
    setContacts(prev => prev.map(c => 
      c.username.toLowerCase() === username.toLowerCase() ? { ...c, isVerified } : c
    ));
    if (activeContactRef.current?.username.toLowerCase() === username.toLowerCase()) {
      setActiveContact(prev => prev ? { ...prev, isVerified } : null);
    }
  };

  // Helper: Save contact (removes unsaved warning banner)
  const handleSaveContact = (username) => {
    setContacts(prev => prev.map(c => 
      c.username.toLowerCase() === username.toLowerCase() ? { ...c, isSaved: true } : c
    ));
    if (activeContactRef.current?.username.toLowerCase() === username.toLowerCase()) {
      setActiveContact(prev => prev ? { ...prev, isSaved: true } : null);
    }
  };

  // Helper: Block/Delete contact
  const handleBlockContact = (username) => {
    if (window.confirm(`Delete conversation and remove @${username}?`)) {
      if (username) {
        delete sharedSecrets.current[username.toLowerCase()];
      }
      setContacts(prev => prev.filter(c => c.username.toLowerCase() !== username.toLowerCase()));
      if (activeContactRef.current?.username.toLowerCase() === username.toLowerCase()) {
        setActiveContact(null);
      }
    }
  };

  // ==========================================
  // WebRTC P2P Voice & Video Call Logic
  // ==========================================
  const setupPeerConnection = (targetUser, stream) => {
    const pc = new RTCPeerConnection(pcConfig);
    peerConnectionRef.current = pc;

    // Add local tracks
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    // Handle remote track
    pc.ontrack = (event) => {
      console.log('Received remote media track');
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      }
    };

    // ICE Candidates dispatching
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const socket = getSocket();
        if (socket) {
          socket.emit('ice-candidate', {
            to: targetUser,
            candidate: event.candidate
          });
        }
      }
    };

    // Monitor WebRTC ICE Connection State
    pc.oniceconnectionstatechange = () => {
      console.log(`ICE Connection State: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
        console.warn('WebRTC ICE Connection state failed or closed. Cleaning up call.');
        cleanupCall(true, 'Connection lost');
      }
    };

    return pc;
  };

  const createDummyVideoTrack = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, 640, 480);
      ctx.fillStyle = '#cccccc';
      ctx.font = '24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Voice Call', 320, 240);
      const stream = canvas.captureStream(1); // 1 FPS to keep CPU/GPU usage practically zero
      const track = stream.getVideoTracks()[0];
      track.enabled = false;
      return track;
    } catch (e) {
      console.error('Failed to create dummy canvas track:', e);
      return null;
    }
  };
  const optimizeSDP = (sdp) => {
    try {
      const quality = localStorage.getItem('chatra_call_quality') || 'medium';
      let audioBitrate = 64000; // Medium
      let isStereo = '1';
      let minVideoBitrate = 1500;
      let maxVideoBitrate = 4000;
      let startVideoBitrate = 2500;

      if (quality === 'high') {
        audioBitrate = 128000;
        isStereo = '1';
        minVideoBitrate = 2500;
        maxVideoBitrate = 6000;
        startVideoBitrate = 4000;
      } else if (quality === 'low') {
        audioBitrate = 24000;
        isStereo = '0';
        minVideoBitrate = 300;
        maxVideoBitrate = 1000;
        startVideoBitrate = 500;
      }

      // Find the payload type of Opus and force high quality voice params on its fmtp line
      const opusMatch = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
      let modified = sdp;
      if (opusMatch) {
        const opusPayloadType = opusMatch[1];
        const fmtpRegex = new RegExp(`(a=fmtp:${opusPayloadType} [^\r\n]*)`, 'i');
        if (modified.match(fmtpRegex)) {
          // Edit existing fmtp line to set optimal parameters
          modified = modified.replace(
            fmtpRegex,
            `$1;stereo=${isStereo};sprop-stereo=${isStereo};maxaveragebitrate=${audioBitrate};cbr=1;useinbandfec=1;minptime=10;ptime=10`
          );
        } else {
          // If no fmtp line exists for Opus, append one right after the rtpmap line
          const rtpmapRegex = new RegExp(`(a=rtpmap:${opusPayloadType} opus\\/48000\\/2[^\r\n]*)`, 'i');
          modified = modified.replace(
            rtpmapRegex,
            `$1\r\na=fmtp:${opusPayloadType} stereo=${isStereo};sprop-stereo=${isStereo};maxaveragebitrate=${audioBitrate};cbr=1;useinbandfec=1;minptime=10;ptime=10`
          );
        }
      }
      
      // Force higher starting bitrates for video streams in SDP
      if (modified.includes('m=video')) {
        modified = modified.replace(
          /a=rtpmap:(\d+) (VP8|VP9|H264)\/90000/gi,
          `a=rtpmap:$1 $2/90000\r\na=fmtp:$1 x-google-min-bitrate=${minVideoBitrate};x-google-max-bitrate=${maxVideoBitrate};x-google-start-bitrate=${startVideoBitrate}`
        );
      }
      return modified;
    } catch (e) {
      console.warn("Failed to optimize SDP:", e);
      return sdp;
    }
  };

  const optimizeSenderParameters = async (sender, isScreenShare) => {
    try {
      const quality = localStorage.getItem('chatra_call_quality') || 'medium';
      const parameters = sender.getParameters();
      if (!parameters.encodings) {
        parameters.encodings = [{}];
      }

      let maxBitrate = 1800000; // Medium camera
      let priority = 'medium';

      if (isScreenShare) {
        if (quality === 'high') {
          maxBitrate = 6000000; // 6 Mbps for crisp 1080p60 screen share
          priority = 'high';
        } else if (quality === 'low') {
          maxBitrate = 1000000; // 1 Mbps for low bandwidth screen share
          priority = 'low';
        } else {
          maxBitrate = 4000000; // 4 Mbps for medium 30fps screen share
          priority = 'high';
        }
      } else {
        if (quality === 'high') {
          maxBitrate = 3500000; // 3.5 Mbps for HD 1080p camera
          priority = 'high';
        } else if (quality === 'low') {
          maxBitrate = 500000; // 500 Kbps for low bandwidth camera
          priority = 'low';
        } else {
          maxBitrate = 1800000; // 1.8 Mbps for standard HD camera
          priority = 'medium';
        }
      }

      parameters.encodings[0].maxBitrate = maxBitrate;
      parameters.encodings[0].priority = priority;
      parameters.encodings[0].networkPriority = priority;
      await sender.setParameters(parameters);
    } catch (e) {
      console.warn("Failed to set RtpSender parameters:", e);
    }
  };

  const getAudioConstraints = () => {
    return {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1, // Optimize mono channel for low latency and high quality voice WebRTC
      sampleRate: 48000, // 48kHz studio audio
      latency: { ideal: 0.005, max: 0.02 } // 5ms low-latency target
    };
  };

  const getVideoConstraints = () => {
    const quality = localStorage.getItem('chatra_call_quality') || 'medium';
    if (quality === 'high') {
      return {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
      };
    } else if (quality === 'low') {
      return {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 15 }
      };
    } else {
      // Medium
      return {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      };
    }
  };

  const getScreenShareConstraints = () => {
    const quality = localStorage.getItem('chatra_call_quality') || 'medium';
    if (quality === 'high') {
      return {
        frameRate: { ideal: 60, max: 60 },
        width: { ideal: 1920, max: 2560 },
        height: { ideal: 1080, max: 1440 },
        displaySurface: 'monitor'
      };
    } else if (quality === 'low') {
      return {
        frameRate: { ideal: 15, max: 15 },
        width: { ideal: 1280, max: 1280 },
        height: { ideal: 720, max: 720 },
        displaySurface: 'monitor'
      };
    } else {
      // Medium
      return {
        frameRate: { ideal: 30, max: 30 },
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        displaySurface: 'monitor'
      };
    }
  };
  const handleInitiateCall = async (media, targetUser = null) => {
    const target = targetUser || (activeContact ? activeContact.username : null);
    if (!target) return;

    if (callStateRef.current !== 'idle') {
      alert('You are already in a call. Please hang up or decline the active call first.');
      return;
    }

    if (target.toLowerCase() === currentUser.username.toLowerCase()) {
      alert('You cannot place a call to yourself.');
      return;
    }
    
    if (targetUser) {
      const contactObj = contacts.find(c => c.username === target);
      if (contactObj) handleSelectContact(contactObj);
    }
    
    isCallInitiator.current = true;
    setCallMediaType(media);
    setCallParty(target);
    setCallState('calling');
    setIsMuted(false);
    setIsCameraOff(media === 'voice');
    setIsScreenSharing(false);
    setRemoteScreenSharing(false);
    setRemoteCameraOff(media === 'voice');

    try {
      let stream;
      if (media === 'video') {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: getAudioConstraints(),
          video: getVideoConstraints()
        });
        dummyTrackRef.current = null;
      } else {
        // Voice call: get audio track and append dummy canvas video track
        stream = await navigator.mediaDevices.getUserMedia({
          audio: getAudioConstraints(),
          video: false
        });
        const dummyTrack = createDummyVideoTrack();
        if (dummyTrack) {
          stream.addTrack(dummyTrack);
          dummyTrackRef.current = dummyTrack;
        }
      }
      setLocalStream(stream);

      const pc = setupPeerConnection(target, stream);
      const offer = await pc.createOffer();
      offer.sdp = optimizeSDP(offer.sdp);
      await pc.setLocalDescription(offer);

      // Configure high quality video encoding parameters if initiated as video
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && media === 'video') {
        if ('contentHint' in videoTrack) videoTrack.contentHint = 'motion';
        const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
          await optimizeSenderParameters(videoSender, false);
        }
      }

      const socket = getSocket();
      if (socket) {
        socket.emit('call-user', {
          to: target,
          offer,
          mediaType: media
        });
      }
    } catch (err) {
      console.error('Call media setup failed:', err);
      alert('Could not access media devices (camera/microphone).');
      cleanupCall();
    }
  };

  const handleAcceptCall = async () => {
    if (!callParty || !pendingOfferRef.current) return;
    setCallState('connected');
    callStartTime.current = Date.now();
    setIsMuted(false);
    setIsCameraOff(callMediaType === 'voice');
    setIsScreenSharing(false);
    setRemoteScreenSharing(false);
    setRemoteCameraOff(callMediaType === 'voice');

    try {
      let stream;
      if (callMediaType === 'video') {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: getAudioConstraints(),
          video: getVideoConstraints()
        });
        dummyTrackRef.current = null;
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: getAudioConstraints(),
          video: false
        });
        const dummyTrack = createDummyVideoTrack();
        if (dummyTrack) {
          stream.addTrack(dummyTrack);
          dummyTrackRef.current = dummyTrack;
        }
      }
      setLocalStream(stream);

      const pc = setupPeerConnection(callParty, stream);
      await pc.setRemoteDescription({
        type: 'offer',
        sdp: optimizeSDP(pendingOfferRef.current.sdp)
      });

      const answer = await pc.createAnswer();
      answer.sdp = optimizeSDP(answer.sdp);
      await pc.setLocalDescription(answer);

      // Configure high quality video encoding parameters if accepted as video
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && callMediaType === 'video') {
        if ('contentHint' in videoTrack) videoTrack.contentHint = 'motion';
        const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
          await optimizeSenderParameters(videoSender, false);
        }
      }

      const socket = getSocket();
      if (socket) {
        socket.emit('make-answer', {
          to: callParty,
          answer
        });
      }

      // Flush queued ICE candidates
      while (iceCandidatesQueue.current.length > 0) {
        const cand = iceCandidatesQueue.current.shift();
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      }
    } catch (err) {
      console.error('Failed to accept call:', err);
      alert('Failed to connect call devices.');
      handleDeclineCall();
    }
  };

  const handleDeclineCall = () => {
    const socket = getSocket();
    if (socket && callParty) {
      socket.emit('hang-up', { to: callParty, reason: 'declined' });
    }
    cleanupCall();
  };

  const handleHangUp = () => {
    const socket = getSocket();
    if (socket && callParty) {
      socket.emit('hang-up', { to: callParty });
    }
    cleanupCall();
  };

  const handleToggleMute = () => {
    setIsMuted(prev => {
      const nextMute = !prev;
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach(track => {
          track.enabled = !nextMute;
        });
      }

      // Notify partner of our mute state change so they reload remoteAudio Ref
      const socket = getSocket();
      if (socket && callPartyRef.current) {
        socket.emit('call-media-update', { 
          to: callPartyRef.current, 
          mediaType: callMediaTypeRef.current, 
          screenSharing: isScreenSharing,
          cameraOff: isCameraOff,
          muted: nextMute
        });
      }

      return nextMute;
    });
  };

  const handleToggleCamera = async () => {
    const stream = localStreamRef.current;
    if (!stream) return;

    if (!isCameraOff) {
      // Camera is ON -> turn it OFF
      stream.getVideoTracks().forEach(track => {
        track.enabled = false;
      });
      setIsCameraOff(true);
      
      if (isScreenSharing) {
        await handleStopScreenShare();
      }

      // Notify partner
      const socket = getSocket();
      if (socket && callPartyRef.current) {
        socket.emit('call-media-update', { 
          to: callPartyRef.current, 
          mediaType: callMediaTypeRef.current, 
          screenSharing: false,
          cameraOff: true
        });
      }
      return;
    }

    // Camera is OFF -> turn it ON
    try {
      let cameraTrack;
      if (dummyTrackRef.current) {
        // Upgrade from voice call: fetch real camera track
        const camStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: getVideoConstraints()
        });
        cameraTrack = camStream.getVideoTracks()[0];
        if (cameraTrack && 'contentHint' in cameraTrack) {
          cameraTrack.contentHint = 'motion';
        }
        
        // Stop and remove dummy canvas track
        dummyTrackRef.current.stop();
        stream.removeTrack(dummyTrackRef.current);
        dummyTrackRef.current = null;
        
        // Add real camera track
        stream.addTrack(cameraTrack);
        
        // Find video sender and replace track
        if (peerConnectionRef.current) {
          const senders = peerConnectionRef.current.getSenders();
          const videoSender = senders.find(s => s.track && s.track.kind === 'video');
          if (videoSender) {
            await videoSender.replaceTrack(cameraTrack);
            await optimizeSenderParameters(videoSender, false);
          }
        }
        
        setCallMediaType('video');
        
        // Notify partner
        const socket = getSocket();
        if (socket && callPartyRef.current) {
          socket.emit('call-media-update', { 
            to: callPartyRef.current, 
            mediaType: 'video', 
            screenSharing: isScreenSharing,
            cameraOff: false
          });
        }
      } else {
        // Just enable the existing camera track
        stream.getVideoTracks().forEach(track => {
          track.enabled = true;
          if ('contentHint' in track) {
            track.contentHint = 'motion';
          }
        });
        
        if (peerConnectionRef.current) {
          const senders = peerConnectionRef.current.getSenders();
          const videoSender = senders.find(s => s.track && s.track.kind === 'video');
          if (videoSender) {
            await optimizeSenderParameters(videoSender, false);
          }
        }
        
        setCallMediaType('video');
        const socket = getSocket();
        if (socket && callPartyRef.current) {
          socket.emit('call-media-update', { 
            to: callPartyRef.current, 
            mediaType: 'video', 
            screenSharing: isScreenSharing,
            cameraOff: false
          });
        }
      }
      
      setIsCameraOff(false);
    } catch (err) {
      console.error("Failed to enable camera:", err);
      alert("Could not access camera device.");
    }
  };

  const handleToggleScreenShare = async () => {
    const stream = localStreamRef.current;
    if (!stream || !peerConnectionRef.current) return;

    if (!navigator.mediaDevices?.getDisplayMedia) {
      alert("Screen sharing is not supported by your current browser/device (requires iOS 13+ Safari, Android Chrome 119+, or a desktop browser, served over a secure HTTPS connection).");
      return;
    }

    if (isScreenSharing) {
      await handleStopScreenShare();
      return;
    }

    try {
      // 1. Request screen capture. Try with ideal constraints first, fallback to true if it fails (e.g. on Android/strict browsers)
      let screenStream;
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: getScreenShareConstraints(),
          audio: false
        });
      } catch (err) {
        console.warn("Screen share failed with ideal constraints, trying simple video:true fallback", err);
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false
        });
      }
      const screenTrack = screenStream.getVideoTracks()[0];
      
      // 2. Set content hint to 'detail' for maximum text sharpness
      if (screenTrack && 'contentHint' in screenTrack) {
        screenTrack.contentHint = 'detail';
      }

      // Store current video track (camera or dummy)
      const currentVideoTrack = stream.getVideoTracks()[0];
      if (currentVideoTrack) {
        originalVideoTrackRef.current = currentVideoTrack;
        stream.removeTrack(currentVideoTrack);
      }

      // Add screen track to localStream
      stream.addTrack(screenTrack);

      // Replace track on peer connection and optimize bitrate/priority
      const senders = peerConnectionRef.current.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');
      if (videoSender) {
        await videoSender.replaceTrack(screenTrack);
        await optimizeSenderParameters(videoSender, true);
      }

      setIsScreenSharing(true);
      setCallMediaType('video');
      setIsCameraOff(false);

      // Notify partner
      const socket = getSocket();
      if (socket && callPartyRef.current) {
        socket.emit('call-media-update', { 
          to: callPartyRef.current, 
          mediaType: 'video', 
          screenSharing: true,
          cameraOff: false
        });
      }

      screenTrack.onended = () => {
        handleStopScreenShare();
      };
    } catch (err) {
      console.error("Screen sharing activation failed:", err);
      alert("Failed to start screen sharing: " + (err.message || err.toString()));
      setIsScreenSharing(false);
    }
  };

  const handleStopScreenShare = async () => {
    const stream = localStreamRef.current;
    if (stream) {
      const screenTrack = stream.getVideoTracks()[0];
      if (screenTrack) {
        screenTrack.stop();
        stream.removeTrack(screenTrack);
      }
    }

    if (!peerConnectionRef.current) {
      setIsScreenSharing(false);
      return;
    }

    let restoredTrack = originalVideoTrackRef.current;
    if (!restoredTrack) {
      restoredTrack = createDummyVideoTrack();
      dummyTrackRef.current = restoredTrack;
    } else {
      originalVideoTrackRef.current = null;
    }

    stream.addTrack(restoredTrack);

    const senders = peerConnectionRef.current.getSenders();
    const videoSender = senders.find(s => s.track && s.track.kind === 'video');
    if (videoSender) {
      await videoSender.replaceTrack(restoredTrack);
      await optimizeSenderParameters(videoSender, false);
    }

    setIsScreenSharing(false);

    const isVoice = !!dummyTrackRef.current;
    const newMediaType = isVoice ? 'voice' : 'video';
    setCallMediaType(newMediaType);
    setIsCameraOff(isVoice);

    const socket = getSocket();
    if (socket && callPartyRef.current) {
      socket.emit('call-media-update', { 
        to: callPartyRef.current, 
        mediaType: newMediaType, 
        screenSharing: false,
        cameraOff: isVoice
      });
    }
  };

  const sendCallLogMessage = async (partnerName, mediaType, status, duration) => {
    if (!currentUser) return;
    const contact = contactsRef.current.find(c => c.username.toLowerCase() === partnerName.toLowerCase());
    if (!contact) return;

    try {
      const sharedSecret = await getSharedSecret(contact);
      const msgContent = {
        text: JSON.stringify({
          callType: mediaType,
          status: status,
          duration: duration
        }),
        type: 'call'
      };

      const payloadString = JSON.stringify(msgContent);
      const { ciphertext, iv } = await encryptMessage(payloadString, sharedSecret);
      const signature = await signData(ciphertext, currentUser.keys.privateSigningKey);
      const ack = await emitSendMessage(contact.username, ciphertext, iv, signature);

      const localMsg = {
        id: ack.messageId,
        sender: currentUser.username,
        recipient: contact.username,
        timestamp: ack.timestamp,
        text: msgContent.text,
        mediaType: 'call',
        fileMetadata: null,
        status: ack.status,
        replyTo: null,
        isNew: true
      };

      appendMessageToContact(contact.username, localMsg);
    } catch (err) {
      console.error('Failed to send E2EE call log message:', err);
    }
  };

  const cleanupCall = (initiatedByRemote = false, reason = null) => {
    // 1. Send E2EE call log if we are the initiator of this call session
    if (isCallInitiator.current && callPartyRef.current) {
      let status = 'completed';
      let duration = 0;

      if (callStateRef.current === 'connected') {
        if (callStartTime.current) {
          duration = Math.round((Date.now() - callStartTime.current) / 1000);
        }
      } else {
        if (reason === 'declined') {
          status = 'declined';
        } else {
          status = initiatedByRemote ? 'missed' : 'cancelled';
        }
      }

      sendCallLogMessage(callPartyRef.current, callMediaTypeRef.current, status, duration);
    }

    // 2. Reset WebRTC connections and stream state
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    if (dummyTrackRef.current) {
      dummyTrackRef.current.stop();
      dummyTrackRef.current = null;
    }
    if (originalVideoTrackRef.current) {
      originalVideoTrackRef.current.stop();
      originalVideoTrackRef.current = null;
    }
    setRemoteStream(null);
    setCallState('idle');
    setCallParty('');
    pendingOfferRef.current = null;
    iceCandidatesQueue.current = [];
    callStartTime.current = null;
    isCallInitiator.current = false;
    
    soundEngine.stopOutgoingRingTone();
    soundEngine.stopIncomingRingtone();
    soundEngine.playCallEnded();
    
    setIsMuted(false);
    setIsCameraOff(false);
    setIsScreenSharing(false);
    setRemoteScreenSharing(false);
    setRemoteCameraOff(false);
    setRemoteMuted(false);
  };

  // Secure sign out
  const handleLogout = () => {
    if (window.confirm("Sign out? Your keys are stored client-side. Make sure you know your password to log back in!")) {
      cleanupCall();
      disconnectSocket();
      localStorage.removeItem('session_enc_key');
      localStorage.removeItem('chatra_username');
      localStorage.removeItem('chatra_token');
      localStorage.removeItem('chatra_encrypted_private_keys');
      localStorage.removeItem('chatra_public_identity_key');
      localStorage.removeItem('chatra_public_signing_key');
      localStorage.removeItem('chatra_display_name');
      localStorage.removeItem('chatra_avatar_icon');
      clearMediaCache();
      localStorage.removeItem('chatra_active_view');
      localStorage.removeItem('chatra_active_contact');
      previousActiveContactRef.current = null;
      setCurrentUser(null);
      setContacts([]);
      setActiveContact(null);
      setShowSettings(false);
      setShowRecents(false);
      sharedSecrets.current = {};
    }
  };

  const handleBackToMenu = (isFromPopState = false) => {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }

    if (!isFromPopState && (window.history.state === 'chat' || window.history.state === 'settings' || window.history.state === 'recents')) {
      window.history.back();
    }

    // Context-aware back navigation: Return directly to active chat if Settings/Recents was opened from a chat
    if (previousActiveContactRef.current && (showSettingsRef.current || showRecentsRef.current)) {
      const prevContact = previousActiveContactRef.current;
      previousActiveContactRef.current = null;
      handleSelectContact(prevContact);
      return;
    }

    setIsNavigatingBack(true);
    setTimeout(() => {
      setActiveContact(null);
      setShowSettings(false);
      setShowRecents(false);
      setIsNavigatingBack(false);
    }, 320); // Smooth 320ms slide-back transition
  };

  return (
    <>
      {restoringSession ? (
        <div className="app-preloader">
          <div className="preloader-logo-container">
            <div className="preloader-glow"></div>
            <svg className="preloader-logo" viewBox="0 0 24 24" fill="none" stroke="#007acc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <path d="m9 11 2 2 4-4" stroke="#30d158" strokeWidth="2"/>
            </svg>
          </div>
          <div className="preloader-bar-bg">
            <div className="preloader-bar"></div>
          </div>
          <div className="preloader-text">Restoring E2EE session...</div>
        </div>
      ) : !currentUser ? (
        <Login onAuthSuccess={setCurrentUser} />
      ) : (
        (() => {
          const isMobileSize = windowWidth <= 768;
          const isAppMinimized = sidebarMinimized && !isMobileSize;
          return (
            <div className={`app-container ${((activeContact || showSettings || showRecents) && !isNavigatingBack) ? 'chat-active' : ''} ${isAppMinimized ? 'sidebar-minimized' : ''} ${isSidebarAnimating ? 'is-sidebar-animating' : ''}`}>
              
              {/* Network & Server Connectivity Status Bar */}
              {(!isOnline || !isSocketConnected) && (
                <div className={`connectivity-banner ${!isOnline ? 'offline' : 'connecting'}`}>
                  {!isOnline ? (
                    <>
                      <WifiOff size={16} />
                      <span>No Internet Connection — Reconnecting when Wi-Fi is restored...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw size={16} className="spin-icon" />
                      <span>Connecting to Chatra Server...</span>
                    </>
                  )}
                </div>
              )}

              <Sidebar
                currentUser={currentUser}
                contacts={contacts}
                activeContact={activeContact}
                setActiveContact={handleSelectContact}
                addContact={handleAddContact}
                onLogout={handleLogout}
                isMinimized={isAppMinimized}
                onToggleMinimize={handleToggleSidebar}
                showSettings={showSettings}
                showRecents={showRecents}
                isNavigatingBack={isNavigatingBack}
            onShowSettings={() => {
              if (window.history.state !== 'settings') {
                window.history.pushState('settings', '');
              }
              if (activeContactRef.current) {
                previousActiveContactRef.current = activeContactRef.current;
              }
              setShowRecents(false);
              setShowSettings(true);
              // Unmount ChatArea quietly underneath after SettingsView has faded in on top
              if (activeContactRef.current) {
                setTimeout(() => setActiveContact(null), 300);
              }
            }}
            onShowRecents={() => {
              if (window.history.state !== 'recents') {
                window.history.pushState('recents', '');
              }
              if (activeContactRef.current) {
                previousActiveContactRef.current = activeContactRef.current;
              }
              setShowSettings(false);
              setShowRecents(true);
              if (activeContactRef.current) {
                setTimeout(() => setActiveContact(null), 300);
              }
            }}
          />
          <div className="main-content-pane">
            <Dashboard
              currentUser={currentUser}
              contacts={contacts}
              onInitiateCall={handleInitiateCall}
              onSelectContact={handleSelectContact}
              onShowSettings={() => {
                if (window.history.state !== 'settings') {
                  window.history.pushState('settings', '');
                }
                if (activeContactRef.current) {
                  previousActiveContactRef.current = activeContactRef.current;
                }
                setShowRecents(false);
                setShowSettings(true);
                if (activeContactRef.current) {
                  setTimeout(() => setActiveContact(null), 300);
                }
              }}
              onBack={handleBackToMenu}
              showBackButton={showRecents}
            />

            {(showSettings || (isNavigatingBack && !activeContact && !showRecents)) && (
              <SettingsView
                currentUser={currentUser}
                onBack={handleBackToMenu}
                onLogout={handleLogout}
                isNavigatingBack={isNavigatingBack}
                onProfileUpdate={(newProfile) => {
                  setCurrentUser(prev => prev ? { ...prev, ...newProfile } : null);
                  // Apply updated call quality parameters dynamically if in an active call
                  if (peerConnectionRef.current && callState === 'connected') {
                    try {
                      const senders = peerConnectionRef.current.getSenders();
                      senders.forEach(sender => {
                        if (sender && sender.track && sender.track.kind === 'video') {
                          optimizeSenderParameters(sender, isScreenSharingRef.current);
                        }
                      });
                    } catch (e) {
                      console.warn("Failed to apply updated quality parameters live:", e);
                    }
                  }
                }}
              />
            )}

            {(activeContact || (isNavigatingBack && activeContact)) && (
              <ChatArea
                currentUser={currentUser}
                activeContact={activeContact}
                onSendMessage={handleSendMessage}
                onInitiateCall={handleInitiateCall}
                currentUserToken={currentUser.token}
                sharedSecret={sharedSecrets.current[activeContact?.username.toLowerCase()]}
                onBack={handleBackToMenu}
                isNavigatingBack={isNavigatingBack}
                markMessageAsReadLocal={markMessageAsReadLocal}
                markAllMessagesAsReadLocal={markAllMessagesAsReadLocal}
                onImageClick={handleOpenLightbox}
                onVerifyContact={handleVerifyContact}
                onSaveContact={handleSaveContact}
                onBlockContact={handleBlockContact}
                onOpenSafetyModal={handleOpenSafetyModal}
                replyingTo={replyingTo}
                setReplyingTo={setReplyingTo}
              />
            )}
          </div>

          {/* WebRTC P2P calling panel overlays */}
          <CallWindow
            callState={callState}
            mediaType={
              callState === 'connected'
                ? ((!isCameraOff || isScreenSharing || !remoteCameraOff || remoteScreenSharing) ? 'video' : 'voice')
                : callMediaType
            }
            callerName={callParty}
            callContact={contacts.find(c => c.username.toLowerCase() === callParty?.toLowerCase()) || { username: callParty }}
            localStream={localStream}
            remoteStream={remoteStream}
            onAccept={handleAcceptCall}
            onDecline={handleDeclineCall}
            onHangUp={handleHangUp}
            isMuted={isMuted}
            isCameraOff={isCameraOff}
            isScreenSharing={isScreenSharing}
            remoteScreenSharing={remoteScreenSharing}
            remoteCameraOff={remoteCameraOff}
            remoteMuted={remoteMuted}
            onToggleMute={handleToggleMute}
            onToggleCamera={handleToggleCamera}
            onToggleScreenShare={handleToggleScreenShare}
            isCallMinimized={isCallMinimized}
            setIsCallMinimized={setIsCallMinimized}
          />

          {/* Fullscreen Image Lightbox Modal */}
          <div 
            className={`image-lightbox-overlay ${lightboxImageSrc ? 'visible' : ''}`} 
            onClick={handleCloseLightbox}
          >
            <button className="lightbox-close-btn" onClick={handleCloseLightbox}>
              <X size={24} />
            </button>
            {activeLightboxSrc && (
              <img src={activeLightboxSrc} className="lightbox-image" alt="Decrypted Preview" onClick={(e) => e.stopPropagation()} />
            )}
          </div>

          {/* E2EE Safety Number verification modal (Root level to overlap Sidebar) */}
          {(showSafetyModal || isSafetyModalClosing) && activeContact && (
            <div 
              className={`safety-modal-overlay glass-modal-overlay ${isSafetyModalClosing ? 'closing' : ''}`} 
              onClick={handleCloseSafetyModal}
            >
              <div className="safety-modal-card glass" onClick={(e) => e.stopPropagation()}>
                <div className="safety-modal-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ShieldCheck size={22} style={{ color: 'var(--accent-color)' }} />
                    <h3>E2EE Safety Number</h3>
                  </div>
                  <button className="safety-close-btn" onClick={handleCloseSafetyModal}>
                    <X size={18} />
                  </button>
                </div>
                <div className="safety-modal-body">
                  <p>
                    To verify the cryptographic security of your end-to-end encrypted connection with <strong>{activeContact.displayName || activeContact.username}</strong>, compare the numbers below with the numbers on their screen.
                  </p>
                  
                  <div className="safety-number-display">
                    {getSafetyNumber(currentUser.keys.publicIdentityKey, activeContact.publicIdentityKey)}
                  </div>
                  
                  <div className="safety-status-row">
                    <span>Verification status:</span>
                    {activeContact.isVerified ? (
                      <span className="status-badge verified">Verified</span>
                    ) : (
                      <span className="status-badge unverified">Not Verified</span>
                    )}
                  </div>
                  
                  <button 
                    type="button" 
                    className={`safety-toggle-verify-btn ${activeContact.isVerified ? 'unverify' : 'verify'}`}
                    onClick={() => {
                      handleVerifyContact(activeContact.username, !activeContact.isVerified);
                    }}
                  >
                    {activeContact.isVerified ? 'Mark as Unverified' : 'Mark as Verified'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
          );
        })()
      )}
    </>
  );
}
