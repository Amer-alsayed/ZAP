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
import ZapLogo from './components/ZapLogo';
import { clearMediaCache } from './services/mediaCache';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import CallWindow from './components/CallWindow';
import SettingsView from './components/SettingsView';
import ForwardModal from './components/ForwardModal';
import { soundEngine } from './services/soundEffects';
import Dashboard from './components/Dashboard';
import { applyThemeTokens } from './utils/themeTokens';
import { AppToastContainer, AppConfirmModal } from './components/AppNotification';

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
  emitDeleteMessages,
  emitDeleteChat,
  emitBlockUser,
  emitUnblockUser,
  emitGetBlockedUsers,
  emitGetChatHistory, 
  emitGetContacts,
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
import { warmupMediaCache } from './services/mediaCache';

export default function App() {
  const [currentUser, setCurrentUser] = useState(null); // { username, token, keys }
  const [restoringSession, setRestoringSession] = useState(true);
  const [isPreloaderFading, setIsPreloaderFading] = useState(false);

  // In-App Toast & Confirmation Modal State
  const [toasts, setToasts] = useState([]);
  const [confirmModal, setConfirmModal] = useState({ isOpen: false });
  const confirmModalRef = useRef(confirmModal);
  useEffect(() => {
    confirmModalRef.current = confirmModal;
  }, [confirmModal]);

  const showToast = useCallback((message, type = 'error', title = null, duration = 4000) => {
    if (!message) return;
    const id = 'toast_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const newToast = { id, message, type, title };
    setToasts(prev => [...prev, newToast]);

    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, duration);
    }
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showConfirm = useCallback((options) => {
    if (window.history.state !== 'confirm-modal') {
      window.history.pushState('confirm-modal', '');
    }
    setConfirmModal({
      isOpen: true,
      ...options
    });
  }, []);

  const closeConfirm = useCallback((isFromPopState = false) => {
    if (!isFromPopState && (window.history.state === 'confirm-modal' || window.history.state?.view === 'confirm-modal')) {
      window.__isProgrammaticPop = true;
      window.history.back();
      setTimeout(() => {
        window.__isProgrammaticPop = false;
      }, 100);
    }
    setConfirmModal(prev => ({ ...prev, isOpen: false }));
  }, []);

  // Gracefully intercept window.alert and expose toast helpers
  useEffect(() => {
    window.alert = (msg) => showToast(msg, 'error');
    window.showAppToast = showToast;
    window.showAppConfirm = showConfirm;
  }, [showToast, showConfirm]);

  // Restore E2EE session on mount
  useEffect(() => {
    const restoreSession = async () => {
      const savedRgb = localStorage.getItem('chatra_theme_rgb');
      if (savedRgb) {
        applyThemeTokens(savedRgb);
      }

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
      setIsPreloaderFading(true);
      setTimeout(() => {
        setRestoringSession(false);
        setIsPreloaderFading(false);
      }, 400);
    };

    restoreSession();
  }, []);

  // On mobile/touch devices, immediately blur clicked buttons to prevent lingering focus/hover states
  useEffect(() => {
    const handleTouchEnd = (e) => {
      if (e.target.closest('button, [role="button"], .back-btn, .header-action-btn, .sidebar-settings-btn, .sidebar-calls-btn, .input-circle-btn, .scroll-to-bottom-btn')) {
        setTimeout(() => {
          if (document.activeElement && (document.activeElement.tagName === 'BUTTON' || document.activeElement.getAttribute('role') === 'button')) {
            document.activeElement.blur();
          }
        }, 50);
      }
    };
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => window.removeEventListener('touchend', handleTouchEnd);
  }, []);

  // Apply theme preferences (glass mode and accent color) synchronously on boot
  useEffect(() => {
    const savedRgb = localStorage.getItem('chatra_theme_rgb');
    if (savedRgb) {
      applyThemeTokens(savedRgb);
    }

    const glass = localStorage.getItem('chatra_glass') !== 'false';
    if (!glass) {
      document.body.classList.add('flat-theme');
    } else {
      document.body.classList.remove('flat-theme');
    }
  }, []);

  // Persist currentUser details to localStorage and apply theme
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

      // Apply and persist theme color from server (cross-device sync)
      if (currentUser.themeColor) {
        localStorage.setItem('chatra_theme_rgb', currentUser.themeColor);
        applyThemeTokens(currentUser.themeColor);
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

  const [blockedUsers, setBlockedUsers] = useState([]);
  const blockedUsersRef = useRef([]);
  useEffect(() => {
    blockedUsersRef.current = blockedUsers;
  }, [blockedUsers]);

  // Load blocked users from server upon authentication
  useEffect(() => {
    if (currentUser) {
      emitGetBlockedUsers()
        .then(list => {
          if (Array.isArray(list)) {
            setBlockedUsers(list.map(u => u.toLowerCase()));
          }
        })
        .catch(err => console.warn('Failed to load blocked users:', err));
    } else {
      setBlockedUsers([]);
    }
  }, [currentUser]);

  const [activeContact, setActiveContact] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showRecents, setShowRecents] = useState(false);

  const [isNavigatingBack, setIsNavigatingBack] = useState(false);
  const [navigatingBackFrom, setNavigatingBackFrom] = useState(null);
  const lastActiveContactRef = useRef(null);

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
  const [cameraFacingMode, setCameraFacingMode] = useState('user'); // 'user' (front) | 'environment' (back)
  const cameraDeviceIdRef = useRef(null);
  const selfieCameraDeviceIdRef = useRef(null);
  const mainRearCameraDeviceIdRef = useRef(null);

  const [isCallMinimized, setIsCallMinimized] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [forwardingMessage, setForwardingMessage] = useState(null);

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
  const isFullscreenRef = useRef(false);

  useEffect(() => {
    isFullscreenRef.current = isFullscreen;
  }, [isFullscreen]);

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
  const chatBackHandlerRef = useRef(null);

  const handleCloseSafetyModal = (isFromPop = false) => {
    setIsSafetyModalClosing(true);
    if (!isFromPop && window.history.state === 'safety') {
      window.__isProgrammaticPop = true;
      window.history.back();
      setTimeout(() => {
        window.__isProgrammaticPop = false;
      }, 100);
    }
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
      window.__isMediaModalOpen = true;
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
    } else {
      window.__isMediaModalOpen = false;
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
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
    if (window.history.state !== 'safety') {
      window.history.pushState('safety', '');
    }
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
      window.__isProgrammaticPop = true;
      window.history.back();
      setTimeout(() => {
        window.__isProgrammaticPop = false;
      }, 100);
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
        try {
          const parsed = JSON.parse(stored);
          const blocked = blockedUsersRef.current;
          
          // Deduplicate loaded contacts by lowercase username and filter blocked users
          const uniqueContacts = [];
          const seen = new Set();
          for (const contact of parsed) {
            const lowerName = contact.username.toLowerCase();
            if (!seen.has(lowerName) && !blocked.includes(lowerName)) {
              seen.add(lowerName);
              uniqueContacts.push(contact);
            }
          }

          // Reset online status on load
          const sanitized = uniqueContacts.map(c => ({ ...c, status: 'offline', messages: c.messages || [] }));
          setContacts(sanitized);
        } catch (e) {
          console.warn('Failed to parse cached contacts:', e);
        }
      }
    }
  }, [currentUser]);

  // Persist contacts when they change
  useEffect(() => {
    if (currentUser) {
      const blocked = blockedUsersRef.current;
      // Deduplicate and filter blocked contacts before saving to localStorage
      const uniqueContacts = [];
      const seen = new Set();
      for (const contact of contacts) {
        const lowerName = contact.username.toLowerCase();
        if (!seen.has(lowerName) && !blocked.includes(lowerName)) {
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
  const selectionBackRef = useRef(null);
  const sidebarBackHandlerRef = useRef(null);

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
      // 0. Ignore popstate if this event was triggered by programmatic history.back()
      if (window.__isProgrammaticPop) {
        return;
      }

      // 0b. Ignore popstate if it's from voice recording, call termination, or fullscreen exit
      if (window.__isChatraRecording || window.__isPoppingRecording || window.__isPoppingCall || window.__isPoppingFullscreen) {
        window.__isPoppingCall = false;
        window.__isPoppingFullscreen = false;
        return;
      }

      // 0c. Close confirmation modal if active (e.g. logout or delete confirmation)
      if (confirmModalRef.current?.isOpen) {
        closeConfirm(true);
        return;
      }

      // 0d. Let active Sidebar internal layers (Contact Action Dialog: rename, delete, block) consume the back event
      if (sidebarBackHandlerRef.current?.()) {
        return;
      }

      // 1. Close lightbox viewer if active
      if (lightboxRef.current) {
        setLightboxImageSrc(null);
        return;
      }

      // 2. Close safety verification modal if active
      if (showSafetyModalRef.current) {
        handleCloseSafetyModal(true);
        return;
      }
      
      // 3. Exit fullscreen mode if active
      if (document.fullscreenElement || isFullscreenRef.current) {
        if (document.fullscreenElement) {
          document.exitFullscreen?.().catch(() => {});
        }
        setIsFullscreen(false);
        return;
      }
      
      // 4. Minimize full-screen WebRTC call if active
      if (callStateRef.current === 'connected' && !isCallMinimizedRef.current) {
        setIsCallMinimized(true);
        return;
      }

      // 5. Let active ChatArea internal layers (Album Gallery, Emoji Picker, Attach Menu, Recording, Selection, Reply, Files) consume the back event
      if (chatBackHandlerRef.current?.()) {
        return;
      }

      // 6. Selection fallback if chatBackHandlerRef wasn't hooked
      if (selectionBackRef.current?.(true)) {
        return;
      }

      // 7. Return to sidebar / contacts list if we are inside a chat, settings, or recents view
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

  // Push history state 'call-maximized' when active call window is maximized
  useEffect(() => {
    const isMaximizedCallActive = callState === 'connected' && !isCallMinimized;
    if (isMaximizedCallActive) {
      if (window.history.state !== 'call-maximized') {
        window.history.pushState('call-maximized', '');
      }
    } else {
      if (window.history.state === 'call-maximized') {
        window.__isPoppingCall = true;
        window.history.back();
        setTimeout(() => {
          window.__isPoppingCall = false;
        }, 100);
      }
    }
  }, [callState, isCallMinimized]);


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
        showToast(reason, 'error', 'Session Ended');
      }
    });

    // Sync messages for a given list of contacts (populates sidebar previews)
    const syncMessagesForContacts = async (contactList) => {
      if (!currentUser || !contactList || contactList.length === 0) return;
      for (const contact of contactList) {
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
              return { ...c, unreadCount, messages: processedMessages };
            }
            return c;
          }));

          warmupMediaCache(processedMessages);

          if (isActive) {
            setActiveContact(prev => {
              if (prev && prev.username.toLowerCase() === contact.username.toLowerCase()) {
                return { ...prev, messages: processedMessages };
              }
              return prev;
            });
            emitMarkAsRead(contact.username);
          }
        } catch (err) {
          console.error('Failed to sync chat history for:', contact.username, err);
        }
      }
    };

    const syncOfflineMessages = async () => {
      await syncMessagesForContacts(contactsRef.current);
    };

    const handleConnect = async () => {
      setIsSocketConnected(true);

      // Auto-load blocked users list from server upon connection
      let currentBlocked = [];
      try {
        const blockedList = await emitGetBlockedUsers();
        if (Array.isArray(blockedList)) {
          currentBlocked = blockedList.map(u => u.toLowerCase());
          setBlockedUsers(currentBlocked);
        }
      } catch (e) {
        console.warn('Failed to load blocked users on connect:', e);
      }

      // Auto-load all contacts from server (cross-device sync), strictly excluding blocked users
      let freshServerContacts = [];
      try {
        freshServerContacts = await emitGetContacts();
        if (freshServerContacts && freshServerContacts.length > 0) {
          freshServerContacts = freshServerContacts.filter(sc => !currentBlocked.includes(sc.username.toLowerCase()));
          setContacts(prev => {
            const existing = new Map(
              prev
                .filter(c => !currentBlocked.includes(c.username.toLowerCase()))
                .map(c => [c.username.toLowerCase(), c])
            );
            for (const sc of freshServerContacts) {
              const key = sc.username.toLowerCase();
              if (currentBlocked.includes(key)) continue;
              if (!existing.has(key)) {
                existing.set(key, {
                  username: sc.username,
                  displayName: sc.displayName || null,
                  avatarIcon: sc.avatarIcon || null,
                  publicIdentityKey: sc.publicIdentityKey,
                  publicSigningKey: sc.publicSigningKey,
                  status: sc.status || 'offline',
                  messages: [],
                  unreadCount: 0
                });
              } else {
                const c = existing.get(key);
                existing.set(key, {
                  ...c,
                  displayName: sc.displayName ?? c.displayName,
                  avatarIcon: sc.avatarIcon ?? c.avatarIcon,
                  status: sc.status || c.status,
                  publicIdentityKey: sc.publicIdentityKey || c.publicIdentityKey,
                  publicSigningKey: sc.publicSigningKey || c.publicSigningKey
                });
              }
            }
            return Array.from(existing.values());
          });
        }
      } catch (e) {
        console.warn('Failed to load contacts from server:', e);
      }

      // Refresh status & profile for each non-blocked contact
      const allContacts = (freshServerContacts.length > 0 ? freshServerContacts : contactsRef.current)
        .filter(c => !currentBlocked.includes(c.username.toLowerCase()));
      allContacts.forEach(async (c) => {
        try {
          const res = await emitGetUserStatus(c.username);
          updateContactProfileAndStatus(c.username, res.status, res.displayName, res.avatarIcon);
        } catch (e) {
          console.error('Failed to fetch status for contact:', c.username, e);
        }
      });

      // Sync full message history for all non-blocked contacts (populates sidebar previews)
      const existingUsernames = new Set(contactsRef.current.map(c => c.username.toLowerCase()));
      const newContacts = freshServerContacts.filter(sc => !existingUsernames.has(sc.username.toLowerCase()));
      // Sync new contacts immediately with their fetched profile data
      await syncMessagesForContacts(newContacts);
      // Sync existing contacts
      await syncOfflineMessages();
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
        if (!msg || !msg.sender) return;
        if (blockedUsersRef.current.includes(msg.sender.toLowerCase())) {
          return; // Strictly ignore incoming messages from blocked users
        }
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
      if (blockedUsersRef.current.includes(username.toLowerCase())) {
        return;
      }
      if (status === 'online') {
        soundEngine.playUserOnline();
      }
      updateContactProfileAndStatus(username, status);
    };
    subscribeToUserStatus(handleStatusChange);

    // Subscribe to realtime profile updates
    const handleProfileUpdate = ({ username, displayName, avatarIcon }) => {
      if (blockedUsersRef.current.includes(username.toLowerCase())) {
        return;
      }
      updateContactProfileAndStatus(username, undefined, displayName, avatarIcon);
    };
    subscribeToProfileUpdates(handleProfileUpdate);

    // Subscribe to typing indicators
    socket.on('user-typing', ({ username, isTyping }) => {
      if (blockedUsersRef.current.includes(username.toLowerCase())) {
        return;
      }
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

    socket.on('messages-deleted', ({ messageIds = [] }) => {
      // Normalize IDs because SQLite/socket payloads and locally decrypted
      // messages can represent the same ID as either a number or a string.
      const ids = new Set(messageIds.map(id => String(id)));
      setContacts(prev => prev.map(c => ({
        ...c,
        messages: c.messages.map(m => ids.has(String(m.id)) ? { ...m, isDeleting: true, isCollapsing: false } : m)
      })));
      setActiveContact(prev => prev ? {
        ...prev,
        messages: prev.messages.map(m => ids.has(String(m.id)) ? { ...m, isDeleting: true, isCollapsing: false } : m)
      } : prev);

      window.setTimeout(() => {
        setContacts(prev => prev.map(c => ({
          ...c,
          messages: c.messages.map(m => ids.has(String(m.id)) ? { ...m, isCollapsing: true } : m)
        })));
        setActiveContact(prev => prev ? {
          ...prev,
          messages: prev.messages.map(m => ids.has(String(m.id)) ? { ...m, isCollapsing: true } : m)
        } : prev);
      }, 500);

      window.setTimeout(() => {
        setContacts(prev => prev.map(c => ({
          ...c,
          messages: c.messages.filter(m => !ids.has(String(m.id)))
        })));
        setActiveContact(prev => prev ? {
          ...prev,
          messages: prev.messages.filter(m => !ids.has(String(m.id)))
        } : prev);
      }, 1150);
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
          const answerDesc = answer?.sdp 
            ? new RTCSessionDescription(answer) 
            : new RTCSessionDescription({ type: 'answer', sdp: answer });
          await peerConnectionRef.current.setRemoteDescription(answerDesc);
          
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
      if (reason === 'offline') {
        showToast(`${from} is currently offline.`, 'info', 'User Offline');
      } else if (reason === 'declined') {
        showToast(`${from} declined the call.`, 'info', 'Call Declined');
      } else if (reason === 'busy') {
        showToast(`${from} is on another call.`, 'info', 'User Busy');
      } else if (reason === 'user_unavailable') {
        showToast(`${from} is unavailable.`, 'info', 'User Unavailable');
      }
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
      showToast(message, 'warning', 'Call Alert');
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
      socket.off('messages-deleted');
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

    if (currentUser?.username?.toLowerCase() === username.toLowerCase()) {
      setCurrentUser(prev => {
        if (!prev) return prev;
        const changes = {};
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

    if (blockedUsersRef.current.includes(recipient.toLowerCase())) {
      showToast(`You have blocked @${recipient}. Unblock them to send messages.`, 'warning', 'Contact Blocked');
      return;
    }

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
      showToast(`Failed to send message: ${err.message || 'Unknown error'}`, 'error');
    }
  };

  // ==========================================
  // Message Forwarding Flow
  // ==========================================
  const handleForwardRequest = (message) => {
    if (!message) return;
    setForwardingMessage(message);
  };

  const handleConfirmForward = async (targetUsername) => {
    const message = forwardingMessage;
    if (!message || !currentUser || !targetUsername) return;

    const contact = contactsRef.current.find(c => c.username.toLowerCase() === String(targetUsername).toLowerCase());
    if (!contact) {
      showToast('Contact not found.', 'error', 'Forward Failed');
      return;
    }

    if (blockedUsersRef.current.includes(contact.username.toLowerCase())) {
      showToast(`You have blocked @${contact.username}. Unblock them to forward messages.`, 'warning', 'Contact Blocked');
      return;
    }

    try {
      // Media files carry their own AES session key inside fileMetadata, so the
      // stored ciphertext can be safely re-shared by forwarding its metadata.
      const hasMedia = Boolean(message.fileMetadata && message.mediaType && message.mediaType !== 'call');

      const msgContent = {
        type: hasMedia ? 'file' : 'text',
        text: message.text || '',
        forwarded: true
      };
      if (hasMedia) {
        msgContent.fileMetadata = message.fileMetadata;
      }

      const sharedSecret = await getSharedSecret(contact);
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
        mediaType: hasMedia ? 'file' : null,
        fileMetadata: hasMedia ? message.fileMetadata : null,
        status: ack.status,
        replyTo: null,
        forwarded: true,
        isNew: true
      };

      appendMessageToContact(contact.username, localMsg);
      showToast(`Message forwarded to @${contact.username}`, 'success');
    } catch (err) {
      console.error('E2EE forwarding failed:', err);
      showToast(`Failed to forward message: ${err.message || 'Unknown error'}`, 'error');
    } finally {
      setForwardingMessage(null);
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
        forwarded: decryptedPayload.forwarded || null,
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
  const normalizeMessageTimestamp = (ts) => {
    if (!ts) return new Date().toISOString();
    if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(ts)) {
      return ts.replace(' ', 'T') + 'Z';
    }
    return ts;
  };

  const decryptMessagesBatch = async (encryptedMsgs, contact) => {
    const decryptedMsgs = [];
    const secret = await getSharedSecret(contact);

    for (const msg of encryptedMsgs) {
      const normTimestamp = normalizeMessageTimestamp(msg.timestamp);
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
            timestamp: normTimestamp,
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
          timestamp: normTimestamp,
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
          timestamp: normTimestamp,
          text: '❌ Decryption Failed: Secure keys mismatch.',
          mediaType: 'text',
          status: msg.delivered
        });
      }
    }
    decryptedMsgs.sort((a, b) => (new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) || ((a.id || 0) - (b.id || 0)));
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
    lastActiveContactRef.current = targetContact;
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

      warmupMediaCache(readMessages);

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

  const deleteMessagesLocal = useCallback((messageIds) => {
    if (!messageIds || messageIds.length === 0) return;
    const ids = new Set(messageIds.map(id => String(id)));

    // Phase 1: Mark all selected messages as deleting locally (disappears for current user)
    setContacts(prev => prev.map(c => ({
      ...c,
      messages: c.messages.map(m => ids.has(String(m.id)) ? { ...m, isDeleting: true } : m)
    })));
    setActiveContact(prev => prev ? {
      ...prev,
      messages: prev.messages.map(m => ids.has(String(m.id)) ? { ...m, isDeleting: true, isCollapsing: false } : m)
    } : prev);

    // Emit remote deletion to server for all selected messages (sent or received)
    emitDeleteMessages(messageIds).catch(err => console.warn('Failed to delete messages remotely:', err));

    // Phase 2: collapse the now-invisible row before removing it from React.
    window.setTimeout(() => {
      setContacts(prev => prev.map(c => ({
        ...c,
        messages: c.messages.map(m => ids.has(String(m.id)) ? { ...m, isCollapsing: true } : m)
      })));
      setActiveContact(prev => prev ? {
        ...prev,
        messages: prev.messages.map(m => ids.has(String(m.id)) ? { ...m, isCollapsing: true } : m)
      } : prev);
    }, 500);

    // Remove only after the layout space has fully collapsed.
    window.setTimeout(() => {
      setContacts(prev => prev.map(c => ({ ...c, messages: c.messages.filter(m => !ids.has(String(m.id))) })));
      setActiveContact(prev => prev ? { ...prev, messages: prev.messages.filter(m => !ids.has(String(m.id))) } : prev);
    }, 1150);
  }, [currentUser?.username]);

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

  const isNavigatingBackRef = useRef(false);

  const handleBackToMenu = (isFromPopState = false) => {
    if (isNavigatingBackRef.current) return;
    isNavigatingBackRef.current = true;

    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }

    if (!isFromPopState && (window.history.state === 'chat' || window.history.state === 'settings' || window.history.state === 'recents')) {
      window.history.back();
    }

    // Context-aware back navigation: Return directly to active chat if Settings/Recents was opened from a chat
    if (previousActiveContactRef.current && showSettingsRef.current) {
      const prevContact = previousActiveContactRef.current;
      previousActiveContactRef.current = null;
      // Play the shared slide-fade exit on settings before landing back in the chat
      if (!isFromPopState && window.history.state === 'settings') {
        window.__isProgrammaticPop = true;
        window.history.back();
        setTimeout(() => {
          window.__isProgrammaticPop = false;
        }, 100);
      }
      setNavigatingBackFrom('settings');
      setIsNavigatingBack(true);
      setTimeout(() => {
        setIsNavigatingBack(false);
        setNavigatingBackFrom(null);
        isNavigatingBackRef.current = false;
        handleSelectContact(prevContact);
      }, 220);
      return;
    }

    if (previousActiveContactRef.current && showRecentsRef.current) {
      const prevContact = previousActiveContactRef.current;
      previousActiveContactRef.current = null;
      isNavigatingBackRef.current = false;
      handleSelectContact(prevContact);
      return;
    }

    const source = showSettings ? 'settings' : activeContact ? 'chat' : showRecents ? 'recents' : null;
    if (activeContact) {
      lastActiveContactRef.current = activeContact;
    }
    setNavigatingBackFrom(source);
    setIsNavigatingBack(true);
    setActiveContact(null);
    setShowSettings(false);
    setShowRecents(false);
    activeContactRef.current = null;
    showSettingsRef.current = false;
    showRecentsRef.current = false;
    setTimeout(() => {
      setIsNavigatingBack(false);
      setNavigatingBackFrom(null);
      isNavigatingBackRef.current = false;
    }, 300); // Smooth 300ms slide-back transition
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

  // Helper: Delete entire conversation / chat
  const handleDeleteChat = useCallback(async (username) => {
    if (!username) return;
    const lower = username.toLowerCase();
    delete sharedSecrets.current[lower];
    setContacts(prev => prev.filter(c => c.username.toLowerCase() !== lower));
    if (activeContactRef.current?.username.toLowerCase() === lower) {
      handleBackToMenu();
    }
    try {
      await emitDeleteChat(username);
    } catch (err) {
      console.warn('Failed to delete chat remotely:', err);
    }
  }, []);

  // Helper: Block contact and delete chat
  const handleBlockContact = useCallback(async (username) => {
    if (!username) return;
    const lower = username.toLowerCase();
    delete sharedSecrets.current[lower];
    setBlockedUsers(prev => prev.includes(lower) ? prev : [...prev, lower]);
    setContacts(prev => {
      const filtered = prev.filter(c => c.username.toLowerCase() !== lower);
      const curUser = localStorage.getItem('chatra_username');
      if (curUser) {
        localStorage.setItem(`contacts_${curUser}`, JSON.stringify(filtered));
      }
      return filtered;
    });
    if (activeContactRef.current?.username.toLowerCase() === lower) {
      handleBackToMenu();
    }
    try {
      await emitBlockUser(username);
      await emitDeleteChat(username);
    } catch (err) {
      console.warn('Failed to block contact remotely:', err);
    }
  }, []);

  // Helper: Unblock contact
  const handleUnblockContact = useCallback(async (username) => {
    if (!username) return;
    const lower = username.toLowerCase();
    setBlockedUsers(prev => prev.filter(u => u !== lower));
    try {
      await emitUnblockUser(username);
    } catch (err) {
      console.warn('Failed to unblock contact remotely:', err);
      showToast(`Failed to unblock @${username}: ${err.message || 'Error'}`, 'error');
    }
  }, []);

  // Helper: Rename contact locally (custom nickname)
  const handleRenameContact = useCallback((username, newCustomName) => {
    if (!username) return;
    const lower = username.toLowerCase();
    const cleanName = newCustomName && newCustomName.trim() ? newCustomName.trim() : null;

    setContacts(prev => {
      const updated = prev.map(c => {
        if (c.username.toLowerCase() === lower) {
          return { ...c, customName: cleanName };
        }
        return c;
      });
      const curUser = localStorage.getItem('chatra_username');
      if (curUser) {
        localStorage.setItem(`contacts_${curUser}`, JSON.stringify(updated));
      }
      return updated;
    });

    if (activeContactRef.current?.username.toLowerCase() === lower) {
      setActiveContact(prev => prev ? { ...prev, customName: cleanName } : null);
    }
  }, []);

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
          maxBitrate = 3000000; // 3 Mbps for crisp 1080p30 screen share
          priority = 'high';
        } else if (quality === 'low') {
          maxBitrate = 800000; // 800 Kbps for low bandwidth screen share
          priority = 'low';
        } else {
          maxBitrate = 2000000; // 2 Mbps for balanced 30fps screen share
          priority = 'high';
        }
      } else {
        if (quality === 'high') {
          maxBitrate = 3000000; // 3 Mbps for HD 1080p camera
          priority = 'high';
        } else if (quality === 'low') {
          maxBitrate = 500000; // 500 Kbps for low bandwidth camera
          priority = 'low';
        } else {
          maxBitrate = 1500000; // 1.5 Mbps for standard HD camera
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
        aspectRatio: { ideal: 16 / 9 },
        frameRate: { ideal: 30 }
      };
    } else if (quality === 'low') {
      return {
        width: { ideal: 640 },
        height: { ideal: 480 },
        aspectRatio: { ideal: 4 / 3 },
        frameRate: { ideal: 15 }
      };
    } else {
      // Medium
      return {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        aspectRatio: { ideal: 16 / 9 },
        frameRate: { ideal: 30 }
      };
    }
  };

  const getScreenShareConstraints = () => {
    const quality = localStorage.getItem('chatra_call_quality') || 'medium';
    if (quality === 'high') {
      return {
        frameRate: { ideal: 30, max: 30 },
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        displaySurface: 'monitor',
        selfBrowserSurface: 'exclude'
      };
    } else if (quality === 'low') {
      return {
        frameRate: { ideal: 15, max: 15 },
        width: { ideal: 1280, max: 1280 },
        height: { ideal: 720, max: 720 },
        displaySurface: 'monitor',
        selfBrowserSurface: 'exclude'
      };
    } else {
      // Medium
      return {
        frameRate: { ideal: 30, max: 30 },
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        displaySurface: 'monitor',
        selfBrowserSurface: 'exclude'
      };
    }
  };
  const handleInitiateCall = async (media, targetUser = null) => {
    const target = targetUser || (activeContact ? activeContact.username : null);
    if (!target) return;

    if (callStateRef.current !== 'idle') {
      showToast('You are already in a call. Please hang up or decline the active call first.', 'warning', 'Active Call');
      return;
    }

    if (target.toLowerCase() === currentUser.username.toLowerCase()) {
      showToast('You cannot place a call to yourself.', 'warning');
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast('Calling is not supported by your current browser.', 'error', 'Unsupported Browser');
      return;
    }

    // 1. Pre-flight Hardware Verification: Check device availability before initiating call state or ringing
    try {
      if (navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasAudio = devices.some(d => d.kind === 'audioinput');
        const hasVideo = devices.some(d => d.kind === 'videoinput');

        // Check audio input device (required for any call)
        if (devices.length > 0 && !hasAudio) {
          showToast('No microphone found on this device. Please connect a microphone to place calls.', 'warning', 'Microphone Missing');
          return;
        }

        // Check video input device when initiating a video call
        if (media === 'video' && devices.length > 0 && !hasVideo) {
          showToast('No camera found on this device. You can make a voice call instead.', 'warning', 'No Camera Found');
          return;
        }
      }
    } catch (e) {
      console.warn('Pre-flight enumerateDevices check skipped:', e);
    }

    // 2. Pre-acquire media stream FIRST before mutating call state or sending network offers
    let stream;
    try {
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
    } catch (err) {
      console.error('Call media pre-flight capture failed:', err);
      if (stream) {
        try { stream.getTracks().forEach(t => t.stop()); } catch (e) {}
      }

      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        if (media === 'video') {
          showToast('No camera found on this device. You can make a voice call instead.', 'warning', 'No Camera Found');
        } else {
          showToast('No microphone found on this device. Please connect a microphone to place calls.', 'warning', 'No Microphone Found');
        }
      } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        showToast('Camera/Microphone permission was denied. Please allow access in your browser settings.', 'error', 'Permission Denied');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        showToast('Your camera or microphone is currently in use by another application.', 'error', 'Hardware In Use');
      } else {
        showToast(`Could not access media devices: ${err.message || 'Unknown device error'}`, 'error', 'Device Error');
      }
      return; // Return cleanly without creating a ghost call or cancelled call log!
    }

    // 3. Hardware is verified and media stream is ready -> Activate call state and transmit offer
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
    setLocalStream(stream);

    try {
      const pc = setupPeerConnection(target, stream);
      const offer = await pc.createOffer();
      offer.sdp = optimizeSDP(offer.sdp);
      await pc.setLocalDescription(offer);

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
      console.error('Call offer setup failed:', err);
      showToast('Could not establish call connection.', 'error', 'Connection Error');
      cleanupCall();
    }
  };

  const handleAcceptCall = async () => {
    if (!callParty || !pendingOfferRef.current) return;

    let stream;
    let effectiveMediaType = callMediaType;
    try {
      if (callMediaType === 'video') {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: getAudioConstraints(),
            video: getVideoConstraints()
          });
          dummyTrackRef.current = null;
        } catch (videoErr) {
          console.warn('Could not acquire camera on video call accept, gracefully falling back to voice-only:', videoErr);
          // Gracefully fallback to voice call if receiving device has no camera
          stream = await navigator.mediaDevices.getUserMedia({
            audio: getAudioConstraints(),
            video: false
          });
          const dummyTrack = createDummyVideoTrack();
          if (dummyTrack) {
            stream.addTrack(dummyTrack);
            dummyTrackRef.current = dummyTrack;
          }
          effectiveMediaType = 'voice';
          showToast('No camera found on this device. Joined call as voice-only.', 'info', 'Voice Fallback');
        }
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
    } catch (err) {
      console.error('Failed to acquire audio/video on accept:', err);
      showToast('Could not access microphone to accept call.', 'error', 'Permission Required');
      handleDeclineCall();
      return;
    }

    setCallState('connected');
    callStartTime.current = Date.now();
    setIsMuted(false);
    setIsCameraOff(effectiveMediaType === 'voice');
    setIsScreenSharing(false);
    setRemoteScreenSharing(false);
    setRemoteCameraOff(effectiveMediaType === 'voice');
    setLocalStream(stream);

    try {
      const pc = setupPeerConnection(callParty, stream);
      await pc.setRemoteDescription({
        type: 'offer',
        sdp: optimizeSDP(pendingOfferRef.current.sdp)
      });

      const answer = await pc.createAnswer();
      answer.sdp = optimizeSDP(answer.sdp);
      await pc.setLocalDescription(answer);

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && effectiveMediaType === 'video') {
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
      showToast('Failed to connect call devices.', 'error', 'Call Error');
      handleDeclineCall();
    }
  };

  const handleDeclineCall = () => {
    const target = callPartyRef.current || callParty;
    const socket = getSocket();
    if (socket && target) {
      socket.emit('hang-up', { to: target, reason: 'declined' });
    }
    cleanupCall();
  };

  const handleHangUp = () => {
    const target = callPartyRef.current || callParty;
    const socket = getSocket();
    if (socket && target) {
      socket.emit('hang-up', { to: target });
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
      // 1. Camera is ON -> Turn it completely OFF and physically release the hardware sensor
      const oldVideoTracks = stream.getVideoTracks();
      oldVideoTracks.forEach(track => {
        try { track.stop(); } catch (e) {}
        try { stream.removeTrack(track); } catch (e) {}
      });

      // 2. Insert a lightweight dummy black video track so WebRTC sender remains alive
      const dummyTrack = createDummyVideoTrack();
      if (dummyTrack) {
        dummyTrackRef.current = dummyTrack;
        stream.addTrack(dummyTrack);
        if (peerConnectionRef.current) {
          const senders = peerConnectionRef.current.getSenders();
          const videoSender = senders.find(s => s && s.track && s.track.kind === 'video');
          if (videoSender) {
            try { await videoSender.replaceTrack(dummyTrack); } catch (e) {}
          }
        }
      }

      setIsCameraOff(true);
      setLocalStream(new MediaStream(stream.getTracks()));
      
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

    // 2. Camera is OFF -> Turn it ON by acquiring a fresh hardware camera track
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: getVideoConstraints()
      });
      const cameraTrack = camStream.getVideoTracks()[0];
      if (!cameraTrack) throw new Error('No camera track available.');

      if ('contentHint' in cameraTrack) {
        cameraTrack.contentHint = 'motion';
      }

      // Stop and remove dummy canvas track
      if (dummyTrackRef.current) {
        try { dummyTrackRef.current.stop(); } catch (e) {}
        try { stream.removeTrack(dummyTrackRef.current); } catch (e) {}
        dummyTrackRef.current = null;
      }

      // Clean up any extra video tracks in stream
      stream.getVideoTracks().forEach(track => {
        if (track !== cameraTrack) {
          try { track.stop(); } catch (e) {}
          try { stream.removeTrack(track); } catch (e) {}
        }
      });

      // Add real camera track to stream
      stream.addTrack(cameraTrack);

      // Find video sender and replace track
      if (peerConnectionRef.current) {
        const senders = peerConnectionRef.current.getSenders();
        const videoSender = senders.find(s => s && s.track && s.track.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(cameraTrack);
          await optimizeSenderParameters(videoSender, false);
        }
      }

      setCallMediaType('video');
      setIsCameraOff(false);
      setLocalStream(new MediaStream(stream.getTracks()));

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
    } catch (err) {
      console.error("Failed to enable camera:", err);
      showToast("Could not access camera device.", "error", "Camera Error");
    }
  };

  const handleSwitchCamera = async () => {
    const stream = localStreamRef.current;
    if (!stream || isCameraOff) return;

    const oldVideoTracks = stream.getVideoTracks();

    try {
      const currentTrack = oldVideoTracks[0];
      const currentDeviceId = currentTrack?.getSettings?.().deviceId || cameraDeviceIdRef.current;

      // 1. Enumerate video input devices
      let videoDevices = [];
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        videoDevices = devices.filter(d => d.kind === 'videoinput');
      } catch (e) {
        console.warn('enumerateDevices failed:', e);
      }

      // 2. Stop old video tracks FIRST to unlock hardware camera sensor on mobile (Android Chrome / iOS Safari)
      oldVideoTracks.forEach(track => {
        try { track.stop(); } catch (e) {}
        try { stream.removeTrack(track); } catch (e) {}
      });

      // Cycle actual camera devices instead of toggling only user/environment.
      // Labels are frequently empty before permission, so deviceId is the
      // source of truth and labels only influence the preferred ordering.
      const labelOf = device => (device.label || '').toLowerCase();
      const isFront = device => /front|user|selfie|facing front/.test(labelOf(device));
      const allRearDevices = videoDevices.filter(device => !isFront(device));
      const frontDevices = videoDevices.filter(isFront);

      if (cameraFacingMode === 'user' && currentDeviceId) {
        selfieCameraDeviceIdRef.current = currentDeviceId;
      }

      let targetDeviceId = null;

      if (cameraFacingMode === 'user') {
        // Toggling from Front (Selfie) to Rear (Main 1.0x) Camera:
        // On multi-camera Android devices (e.g. Samsung/Pixel):
        // videoDevices[0] = Selfie (Option 1)
        // videoDevices[1] = Ultra-wide 0.5x (Option 2)
        // videoDevices[2] = Main Camera 1.0x (Option 3) -> TARGETED DIRECTLY!
        if (videoDevices.length >= 3) {
          targetDeviceId = videoDevices[2].deviceId;
        } else if (allRearDevices.length > 1) {
          targetDeviceId = allRearDevices[allRearDevices.length - 1].deviceId;
        } else if (allRearDevices.length > 0) {
          targetDeviceId = allRearDevices[0].deviceId;
        } else if (videoDevices.length > 1) {
          targetDeviceId = videoDevices[1].deviceId;
        }

        if (targetDeviceId) mainRearCameraDeviceIdRef.current = targetDeviceId;
      } else {
        // Toggling from Rear back to Front (Selfie) Camera:
        const frontCam = frontDevices[0] || videoDevices[0];
        targetDeviceId = selfieCameraDeviceIdRef.current || frontCam?.deviceId;
      }

      const targetDevice = videoDevices.find(device => device.deviceId === targetDeviceId) || null;
      const nextFacingMode = targetDevice && isFront(targetDevice) ? 'user' : 'environment';
      const videoConstraintConfig = targetDeviceId
        ? {
            deviceId: { ideal: targetDeviceId },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            aspectRatio: { ideal: 16 / 9 }
          }
        : {
            facingMode: { ideal: nextFacingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            aspectRatio: { ideal: 16 / 9 }
          };

      let newStream;
      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: videoConstraintConfig
        });
      } catch (e1) {
        try {
          newStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: targetDeviceId ? { deviceId: targetDeviceId } : { facingMode: nextFacingMode }
          });
        } catch (e2) {
          newStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: nextFacingMode }
          });
        }
      }

      const newVideoTrack = newStream.getVideoTracks()[0];
      if (!newVideoTrack) throw new Error('No new video track produced.');

      if ('contentHint' in newVideoTrack) {
        newVideoTrack.contentHint = 'motion';
      }
      cameraDeviceIdRef.current = targetDeviceId;
      if (nextFacingMode === 'user') selfieCameraDeviceIdRef.current = cameraDeviceIdRef.current;
      else mainRearCameraDeviceIdRef.current = cameraDeviceIdRef.current;

      // 4. Attach new track to localStream
      stream.addTrack(newVideoTrack);

      // 5. Replace track on WebRTC PeerConnection sender
      if (peerConnectionRef.current) {
        const senders = peerConnectionRef.current.getSenders();
        const videoSender = senders.find(s => s && s.track && s.track.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(newVideoTrack);
          await optimizeSenderParameters(videoSender, isScreenSharing);
        }
      }

      setCameraFacingMode(nextFacingMode);
      setLocalStream(new MediaStream(stream.getTracks()));
    } catch (err) {
      console.error('Failed to switch camera:', err);

      // Gracefully restore front camera track if switching failed
      try {
        const restoreStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'user' }
        });
        const restoreTrack = restoreStream.getVideoTracks()[0];
        if (restoreTrack) {
          stream.addTrack(restoreTrack);
          if (peerConnectionRef.current) {
            const videoSender = peerConnectionRef.current.getSenders().find(s => s && s.track && s.track.kind === 'video');
            if (videoSender) await videoSender.replaceTrack(restoreTrack);
          }
          setLocalStream(new MediaStream(stream.getTracks()));
        }
      } catch (e) {}

      showToast('Could not switch camera. Your device may be using a single camera or another application is locking camera access.', 'warning', 'Camera Switch');
    }
  };

  const handleToggleScreenShare = async () => {
    const stream = localStreamRef.current;
    if (!stream || !peerConnectionRef.current) return;

    if (!navigator.mediaDevices?.getDisplayMedia) {
      showToast("Screen sharing is not supported by your current browser/device (requires iOS 13+ Safari, Android Chrome 119+, or a desktop browser over HTTPS).", "warning", "Screen Share");
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
      setLocalStream(new MediaStream(stream.getTracks()));

      // Notify partner
      const socket = getSocket();
      if (socket && callPartyRef.current) {
        socket.emit('call-media-update', { 
          to: callPartyRef.current, 
          mediaType: 'video', 
          screenSharing: true,
          cameraOff: isCameraOff
        });
      }

      screenTrack.onended = () => {
        handleStopScreenShare();
      };
    } catch (err) {
      console.error("Screen sharing activation failed:", err);
      showToast("Failed to start screen sharing: " + (err.message || err.toString()), "error", "Screen Share Error");
      setIsScreenSharing(false);
    }
  };

  const handleStopScreenShare = async () => {
    const stream = localStreamRef.current;
    if (stream) {
      const screenTracks = stream.getVideoTracks();
      screenTracks.forEach(t => {
        try { t.stop(); } catch (e) {}
        try { stream.removeTrack(t); } catch (e) {}
      });
    }

    if (!peerConnectionRef.current) {
      setIsScreenSharing(false);
      return;
    }

    let restoredTrack = originalVideoTrackRef.current;
    if (!restoredTrack || restoredTrack.readyState === 'ended' || isCameraOff) {
      if (restoredTrack) {
        try { restoredTrack.stop(); } catch (e) {}
      }
      originalVideoTrackRef.current = null;
      restoredTrack = createDummyVideoTrack();
      dummyTrackRef.current = restoredTrack;
    } else {
      originalVideoTrackRef.current = null;
    }

    if (stream && restoredTrack) {
      stream.addTrack(restoredTrack);
    }

    const senders = peerConnectionRef.current.getSenders();
    const videoSender = senders.find(s => s.track && s.track.kind === 'video');
    if (videoSender && restoredTrack) {
      try {
        await videoSender.replaceTrack(restoredTrack);
        await optimizeSenderParameters(videoSender, false);
      } catch (e) {}
    }

    setIsScreenSharing(false);
    if (stream) {
      setLocalStream(new MediaStream(stream.getTracks()));
    }

    const isVoice = !!dummyTrackRef.current || isCameraOff;
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

    // 2. Reset WebRTC connections and stop ALL hardware media tracks (Microphone, Camera, Screen)
    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.getSenders().forEach(s => {
          if (s.track) {
            try { s.track.stop(); } catch (e) {}
          }
        });
      } catch (e) {}
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        try { track.stop(); } catch (e) {}
      });
      setLocalStream(null);
    }
    if (dummyTrackRef.current) {
      try { dummyTrackRef.current.stop(); } catch (e) {}
      dummyTrackRef.current = null;
    }
    if (originalVideoTrackRef.current) {
      try { originalVideoTrackRef.current.stop(); } catch (e) {}
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
    setCameraFacingMode('user');
  };

  // Secure sign out with in-app confirmation modal
  const handleLogout = () => {
    showConfirm({
      title: 'Sign out of ZAP?',
      message: 'Your encryption keys are stored locally on this device. Make sure you know your password to sign back in.',
      confirmText: 'Sign Out',
      cancelText: 'Cancel',
      isDanger: true,
      onConfirm: () => {
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
    });
  };

  return (
    <>
      {restoringSession ? (
        <div className={`app-preloader ${isPreloaderFading ? 'fading-out' : ''}`}>
          <div className="preloader-logo-container">
            <div className="preloader-glow"></div>
            <ZapLogo size={64} glow className="preloader-logo" />
          </div>
          <div className="preloader-bar-bg">
            <div className="preloader-bar"></div>
          </div>
          <div className="preloader-text">Restoring secure session...</div>
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
                      <span>Connecting to ZAP Server...</span>
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
                onRenameContact={handleRenameContact}
                onDeleteChat={handleDeleteChat}
                onBlockChat={handleBlockContact}
                onUnblockContact={handleUnblockContact}
                blockedUsers={blockedUsers}
                onLogout={handleLogout}
                isMinimized={isAppMinimized}
                onToggleMinimize={handleToggleSidebar}
                showSettings={showSettings}
                showRecents={showRecents}
                isNavigatingBack={isNavigatingBack}
                sidebarBackHandlerRef={sidebarBackHandlerRef}
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

                {(showSettings || (isNavigatingBack && navigatingBackFrom === 'settings')) && (
                  <SettingsView
                    currentUser={currentUser}
                    onBack={handleBackToMenu}
                    onLogout={handleLogout}
                    blockedUsers={blockedUsers}
                    onUnblockUser={handleUnblockContact}
                    isNavigatingBack={isNavigatingBack}
                    onProfileUpdate={(newProfile) => {
                      setCurrentUser(prev => prev ? { ...prev, ...newProfile } : null);
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

                {(activeContact || (isNavigatingBack && navigatingBackFrom === 'chat')) && (
                  <ChatArea
                    currentUser={currentUser}
                    activeContact={activeContact || lastActiveContactRef.current}
                    isBlocked={(activeContact || lastActiveContactRef.current) && blockedUsers.includes((activeContact || lastActiveContactRef.current).username.toLowerCase())}
                    onUnblockContact={handleUnblockContact}
                    onSendMessage={handleSendMessage}
                    onInitiateCall={handleInitiateCall}
                    currentUserToken={currentUser.token}
                    sharedSecret={sharedSecrets.current[(activeContact || lastActiveContactRef.current)?.username.toLowerCase()]}
                    onBack={handleBackToMenu}
                    isNavigatingBack={isNavigatingBack}
                    markMessageAsReadLocal={markMessageAsReadLocal}
                    markAllMessagesAsReadLocal={markAllMessagesAsReadLocal}
                    onImageClick={handleOpenLightbox}
                    onVerifyContact={handleVerifyContact}
                    onSaveContact={handleSaveContact}
                    onBlockContact={handleBlockContact}
                    onDeleteMessages={deleteMessagesLocal}
                    selectionCancelCallbackRef={selectionBackRef}
                    chatBackHandlerRef={chatBackHandlerRef}
                    onOpenSafetyModal={handleOpenSafetyModal}
                    replyingTo={replyingTo}
                    setReplyingTo={setReplyingTo}
                    onForwardMessage={handleForwardRequest}
                    showToast={showToast}
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
                onSwitchCamera={handleSwitchCamera}
                cameraFacingMode={cameraFacingMode}
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
              <img 
                src={activeLightboxSrc} 
                className="lightbox-image" 
                alt="Decrypted Preview" 
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                onClick={(e) => e.stopPropagation()} 
              />
            )}
          </div>

          {/* Forward Message Contact Picker */}
          <ForwardModal
            message={forwardingMessage}
            contacts={contacts}
            blockedUsers={blockedUsers}
            onClose={() => setForwardingMessage(null)}
            onConfirm={handleConfirmForward}
          />

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

      {/* Floating In-App Toast Notification Stack */}
      <AppToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Custom In-App Action Confirmation Modal */}
      <AppConfirmModal modalState={confirmModal} onClose={closeConfirm} />
    </>
  );
}
