import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ShieldAlert, X, ShieldCheck, WifiOff, RefreshCw, Copy } from 'lucide-react';

import Login from './components/Login';
import ZapLogo from './components/ZapLogo';
import { clearMediaCache } from './services/mediaCache';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import CallWindow from './components/CallWindow';
import SettingsView from './components/SettingsView';
import ForwardModal from './components/ForwardModal';
import CreateGroupModal from './components/CreateGroupModal';
import GroupInfoModal from './components/GroupInfoModal';
import GroupCallWindow from './components/GroupCallWindow';
import Dashboard from './components/Dashboard';
import { AppToastContainer, AppConfirmModal } from './components/AppNotification';

import useAuthSession from './hooks/useAuthSession';
import useChatManager from './hooks/useChatManager';
import useGroupManager from './hooks/useGroupManager';
import useWebRTC from './hooks/useWebRTC';
import useGroupCalls from './hooks/useGroupCalls';

import {
  connectSocket,
  disconnectSocket,
  getSocket,
  emitGetContacts,
  emitGetBlockedUsers,
  emitGetUserStatus,
  emitGetChatHistory,
  emitMarkAsRead
} from './services/socket';
import { warmupMediaCache } from './services/mediaCache';

export default function App() {
  const {
    currentUser,
    setCurrentUser,
    isRestoring,
    isPreloaderFading,
    clearUserSession
  } = useAuthSession();

  // In-App Toast & Confirmation Modal State
  const [toasts, setToasts] = useState([]);
  const [confirmModal, setConfirmModal] = useState({ isOpen: false });
  const confirmModalRef = useRef(confirmModal);
  useEffect(() => {
    confirmModalRef.current = confirmModal;
  }, [confirmModal]);

  const recentToastsRef = useRef(new Map());

  const showToast = useCallback((message, type = 'error', title = null, duration = 4000) => {
    if (!message) return;
    const dedupeKey = `${type}:${title || ''}:${message}`;
    const now = Date.now();
    const lastSeen = recentToastsRef.current.get(dedupeKey);
    if (lastSeen && now - lastSeen < 3000) {
      return; // Skip duplicate notification
    }
    recentToastsRef.current.set(dedupeKey, now);

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

  useEffect(() => {
    window.alert = (msg) => showToast(msg, 'error');
    window.showAppToast = showToast;
    window.showAppConfirm = showConfirm;
  }, [showToast, showConfirm]);

  // View Navigation States
  const [showSettings, setShowSettings] = useState(false);
  const [showRecents, setShowRecents] = useState(false);
  const [isNavigatingBack, setIsNavigatingBack] = useState(false);
  const [navigatingBackFrom, setNavigatingBackFrom] = useState(null);
  const isNavigatingBackRef = useRef(false);
  const showSettingsRef = useRef(false);
  const showRecentsRef = useRef(false);
  const settingsOpenTimeoutRef = useRef(null);

  useEffect(() => {
    showSettingsRef.current = showSettings;
  }, [showSettings]);

  useEffect(() => {
    showRecentsRef.current = showRecents;
  }, [showRecents]);

  // Fullscreen & Sidebar Animation States
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isFullscreenRef = useRef(false);
  useEffect(() => {
    isFullscreenRef.current = isFullscreen;
  }, [isFullscreen]);

  const [sidebarMinimized, setSidebarMinimized] = useState(() => {
    return (localStorage.getItem('zap_sidebar_minimized') ?? localStorage.getItem('chatra_sidebar_minimized')) === 'true';
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
    localStorage.setItem('zap_sidebar_minimized', sidebarMinimized);
  }, [sidebarMinimized]);

  // Network Connectivity
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [showConnectingBanner, setShowConnectingBanner] = useState(false);
  const connectingTimerRef = useRef(null);

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

  useEffect(() => {
    if (!isOnline) {
      if (connectingTimerRef.current) clearTimeout(connectingTimerRef.current);
      setShowConnectingBanner(false);
      return;
    }

    if (!isSocketConnected) {
      // Delay showing the connecting banner by 2.5s so normal page reload handshakes never flash
      connectingTimerRef.current = setTimeout(() => {
        setShowConnectingBanner(true);
      }, 2500);
    } else {
      if (connectingTimerRef.current) clearTimeout(connectingTimerRef.current);
      setShowConnectingBanner(false);
    }

    return () => {
      if (connectingTimerRef.current) clearTimeout(connectingTimerRef.current);
    };
  }, [isOnline, isSocketConnected]);

  // Back refs for nested views
  const selectionBackRef = useRef(null);
  const sidebarBackHandlerRef = useRef(null);
  const createGroupBackHandlerRef = useRef(null);
  const groupInfoBackHandlerRef = useRef(null);
  const forwardBackHandlerRef = useRef(null);
  const chatBackHandlerRef = useRef(null);

  // Shared in-memory caches for direct chats and group channels
  const sharedSecrets = useRef({});
  const contactsRef = useRef([]);

  // Group Manager Hook
  const groupManager = useGroupManager({
    currentUser,
    contactsRef,
    sharedSecrets,
    showToast,
    onBackToMenu: () => handleBackToMenu(),
    onClearActiveContact: () => {
      if (chatManager.activeContactRef.current) {
        chatManager.setActiveContact(null);
        chatManager.activeContactRef.current = null;
      }
      if (showSettingsRef.current) {
        setShowSettings(false);
        showSettingsRef.current = false;
      }
      if (showRecentsRef.current) {
        setShowRecents(false);
        showRecentsRef.current = false;
      }
    }
  });

  const {
    groups,
    setGroups,
    groupsRef,
    activeGroup,
    setActiveGroup,
    activeGroupRef,
    lastActiveGroupVmRef,
    lastChatKindRef,
    previousActiveGroupRef,
    showCreateGroup,
    setShowCreateGroup,
    showCreateGroupRef,
    groupInfoGroupId,
    setGroupInfoGroupId,
    groupInfoGroupIdRef,
    groupKeysRef,
    userProfilesRef,
    loadGroups,
    handleSendGroupMessage,
    handleSelectGroup,
    handleCreateGroup,
    handleLeaveGroupById,
    handleDeleteGroupById,
    handleAddMembersToGroup,
    handleRemoveMemberFromGroup,
    handleUpdateGroupInfo,
    handleSetMemberRole,
    patchGroup
  } = groupManager;

  // Direct Messaging / Chat Manager Hook
  const chatManager = useChatManager({
    currentUser,
    setCurrentUser,
    showToast,
    contactsRef,
    sharedSecrets,
    onClearActiveGroup: () => {
      if (activeGroupRef.current) {
        setActiveGroup(null);
        activeGroupRef.current = null;
        lastActiveGroupVmRef.current = null;
      }
      if (showSettingsRef.current) {
        setShowSettings(false);
        showSettingsRef.current = false;
      }
      if (showRecentsRef.current) {
        setShowRecents(false);
        showRecentsRef.current = false;
      }
    },
    groupsRef,
    fetchGroupKey: groupManager.fetchGroupKey,
    encryptGroupPayload: groupManager.encryptGroupMeta,
    emitSendGroupMessage: groupManager.sendGroupSystemMessage,
    patchGroup,
    emitDeleteGroupMessages: (gid, ids) => {
      const socket = getSocket();
      if (socket) socket.emit('delete-group-messages', { groupId: gid, messageIds: ids });
      return Promise.resolve();
    }
  });

  const {
    contacts,
    setContacts,
    activeContact,
    setActiveContact,
    activeContactRef,
    lastActiveContactRef,
    previousActiveContactRef,
    blockedUsers,
    setBlockedUsers,
    blockedUsersRef,
    replyingTo,
    setReplyingTo,
    forwardingMessage,
    setForwardingMessage,
    forwardingMessageRef,
    safetyNumberDisplay,
    showSafetyModal,
    setShowSafetyModal,
    isSafetyModalClosing,
    handleCloseSafetyModal,
    handleVerifyContact,
    lightboxImageSrc,
    setLightboxImageSrc,
    activeLightboxSrc,
    handleSelectContact,
    handleSendMessage,
    handleForwardRequest,
    handleConfirmForward,
    sendCallLogMessage,
    deleteMessagesLocal,
    markAllMessagesAsReadLocal,
    handleAddContact,
    handleSaveContact,
    handleDeleteChat,
    handleBlockContact,
    handleUnblockContact,
    handleRenameContact,
    updateContactProfileAndStatus
  } = chatManager;

  // 1-on-1 WebRTC Hook
  const webrtc = useWebRTC({
    currentUser,
    activeContact,
    contactsRef,
    gcStateRef: useRef('idle'), // Updated below
    showToast,
    onSelectContact: handleSelectContact,
    onSendCallLog: sendCallLogMessage
  });

  const {
    callState,
    callStateRef,
    callMediaType,
    callParty,
    localStream,
    remoteStream,
    isMuted,
    isCameraOff,
    isScreenSharing,
    remoteScreenSharing,
    remoteCameraOff,
    remoteMuted,
    cameraFacingMode,
    isCallMinimized,
    setIsCallMinimized,
    handleInitiateCall,
    handleAcceptCall,
    handleDeclineCall,
    handleHangUp,
    handleToggleMute,
    handleToggleCamera,
    handleSwitchCamera,
    handleToggleScreenShare,
    cleanupCall
  } = webrtc;

  // Group WebRTC Hook
  const groupCalls = useGroupCalls({
    currentUser,
    groupsRef,
    activeGroupRef,
    callStateRef,
    showToast
  });

  const {
    gcState,
    gcGroupId,
    gcMediaType,
    gcRemoteStreams,
    gcPeers,
    gcElapsed,
    gcMinimized,
    setGcMinimized,
    isMuted: gcIsMuted,
    isCameraOff: gcIsCameraOff,
    isScreenSharing: gcIsScreenSharing,
    handleStartGroupCall,
    handleAcceptGroupCall,
    handleDeclineGroupCall,
    handleLeaveGroupCall,
    handleGcToggleMute,
    handleGcToggleCamera,
    handleGcToggleScreenShare,
    gcCleanupAll
  } = groupCalls;

  // Link group call state back to 1-on-1 webrtc
  webrtc.gcStateRef = groupCalls.gcStateRef;

  const showSafetyModalRef = useRef(false);
  useEffect(() => {
    showSafetyModalRef.current = showSafetyModal;
  }, [showSafetyModal]);

  const handleOpenSafetyModal = useCallback(() => {
    if (window.history.state !== 'safety') {
      window.history.pushState('safety', '');
    }
    setShowSafetyModal(true);
  }, [setShowSafetyModal]);

  const handleOpenLightbox = useCallback((src) => {
    if (window.history.state !== 'lightbox') {
      window.history.pushState('lightbox', '');
    }
    setLightboxImageSrc(src);
  }, [setLightboxImageSrc]);

  const handleCloseLightbox = useCallback((isFromPop = false) => {
    if (!isFromPop && window.history.state === 'lightbox') {
      window.__isProgrammaticPop = true;
      window.history.back();
      setTimeout(() => {
        window.__isProgrammaticPop = false;
      }, 100);
    }
    setLightboxImageSrc(null);
  }, [setLightboxImageSrc]);

  // Context-aware back navigation
  const handleBackToMenu = useCallback((isFromPopState = false) => {
    if (isNavigatingBackRef.current) return;
    isNavigatingBackRef.current = true;

    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }

    if (previousActiveContactRef.current && showSettingsRef.current) {
      const prevContact = previousActiveContactRef.current;
      previousActiveContactRef.current = null;
      if (settingsOpenTimeoutRef.current) {
        clearTimeout(settingsOpenTimeoutRef.current);
        settingsOpenTimeoutRef.current = null;
      }
      if (!isFromPopState && window.history.state === 'settings') {
        window.__isProgrammaticPop = true;
        window.history.back();
        setTimeout(() => {
          window.__isProgrammaticPop = false;
        }, 120);
      }
      setActiveContact(prevContact);
      activeContactRef.current = prevContact;
      lastActiveContactRef.current = prevContact;
      lastChatKindRef.current = 'contact';
      if (activeGroupRef.current) {
        setActiveGroup(null);
        activeGroupRef.current = null;
        lastActiveGroupVmRef.current = null;
      }
      setNavigatingBackFrom('settings');
      setIsNavigatingBack(true);
      setTimeout(() => {
        setShowSettings(false);
        showSettingsRef.current = false;
        setShowRecents(false);
        showRecentsRef.current = false;
        setIsNavigatingBack(false);
        setNavigatingBackFrom(null);
        isNavigatingBackRef.current = false;
        if (window.history.state !== 'chat') {
          window.history.pushState('chat', '');
        }
      }, 220);
      return;
    }

    if (previousActiveGroupRef.current && showSettingsRef.current) {
      const prevGroup = previousActiveGroupRef.current;
      previousActiveGroupRef.current = null;
      if (settingsOpenTimeoutRef.current) {
        clearTimeout(settingsOpenTimeoutRef.current);
        settingsOpenTimeoutRef.current = null;
      }
      if (!isFromPopState && window.history.state === 'settings') {
        window.__isProgrammaticPop = true;
        window.history.back();
        setTimeout(() => {
          window.__isProgrammaticPop = false;
        }, 120);
      }
      if (activeContactRef.current) {
        setActiveContact(null);
        activeContactRef.current = null;
        lastActiveContactRef.current = null;
      }
      handleSelectGroup(prevGroup);
      setNavigatingBackFrom('settings');
      setIsNavigatingBack(true);
      setTimeout(() => {
        setShowSettings(false);
        showSettingsRef.current = false;
        setShowRecents(false);
        showRecentsRef.current = false;
        setIsNavigatingBack(false);
        setNavigatingBackFrom(null);
        isNavigatingBackRef.current = false;
        if (window.history.state !== 'chat') window.history.pushState('chat', '');
      }, 220);
      return;
    }

    if (previousActiveContactRef.current && showRecentsRef.current) {
      const prevContact = previousActiveContactRef.current;
      previousActiveContactRef.current = null;
      isNavigatingBackRef.current = false;
      if (!isFromPopState && window.history.state === 'recents') {
        window.__isProgrammaticPop = true;
        window.history.back();
        setTimeout(() => { window.__isProgrammaticPop = false; }, 120);
      } else if (!isFromPopState && (window.history.state === 'chat' || window.history.state === 'settings')) {
        window.history.back();
      }
      handleSelectContact(prevContact);
      return;
    }

    if (previousActiveGroupRef.current && showRecentsRef.current) {
      const prevGroup = previousActiveGroupRef.current;
      previousActiveGroupRef.current = null;
      isNavigatingBackRef.current = false;
      if (!isFromPopState && window.history.state === 'recents') {
        window.__isProgrammaticPop = true;
        window.history.back();
        setTimeout(() => { window.__isProgrammaticPop = false; }, 120);
      } else if (!isFromPopState && (window.history.state === 'chat' || window.history.state === 'settings')) {
        window.history.back();
      }
      handleSelectGroup(prevGroup);
      return;
    }

    if (!isFromPopState) {
      if (window.history.state === 'emoji' || window.history.state === 'attach') {
        window.history.go(-2);
      } else if (window.history.state === 'chat' || window.history.state === 'settings' || window.history.state === 'recents') {
        window.history.back();
      }
    }

    const source = showSettings ? 'settings' : activeContact || activeGroupRef.current ? 'chat' : showRecents ? 'recents' : null;
    if (activeContact) {
      lastActiveContactRef.current = activeContact;
    }
    setNavigatingBackFrom(source);
    setIsNavigatingBack(true);
    setActiveContact(null);
    setActiveGroup(null);
    activeGroupRef.current = null;
    setShowSettings(false);
    setShowRecents(false);
    setGroupInfoGroupId(null);
    activeContactRef.current = null;
    showSettingsRef.current = false;
    showRecentsRef.current = false;
    if (settingsOpenTimeoutRef.current) {
      clearTimeout(settingsOpenTimeoutRef.current);
      settingsOpenTimeoutRef.current = null;
    }
    setTimeout(() => {
      setIsNavigatingBack(false);
      setNavigatingBackFrom(null);
      isNavigatingBackRef.current = false;
    }, 300);
  }, [
    activeContact,
    handleSelectContact,
    handleSelectGroup,
    setActiveContact,
    setActiveGroup,
    setGroupInfoGroupId,
    showRecents,
    showSettings
  ]);

  const openSettingsView = useCallback(() => {
    if (window.history.state !== 'settings') {
      window.history.pushState('settings', '');
    }
    if (activeContactRef.current) {
      previousActiveContactRef.current = activeContactRef.current;
    }
    if (activeGroupRef.current) {
      previousActiveGroupRef.current = activeGroupRef.current;
    }
    setShowRecents(false);
    setShowSettings(true);
    if (settingsOpenTimeoutRef.current) {
      clearTimeout(settingsOpenTimeoutRef.current);
      settingsOpenTimeoutRef.current = null;
    }
    if (activeContactRef.current) {
      settingsOpenTimeoutRef.current = setTimeout(() => {
        if (showSettingsRef.current) setActiveContact(null);
        settingsOpenTimeoutRef.current = null;
      }, 300);
    }
    if (activeGroupRef.current) {
      setTimeout(() => {
        if (showSettingsRef.current) {
          setActiveGroup(null);
          activeGroupRef.current = null;
        }
      }, 300);
    }
  }, [setActiveContact, setActiveGroup]);

  const openRecentsView = useCallback(() => {
    if (window.history.state !== 'recents') {
      window.history.pushState('recents', '');
    }
    if (activeContactRef.current) {
      previousActiveContactRef.current = activeContactRef.current;
    }
    if (activeGroupRef.current) {
      previousActiveGroupRef.current = activeGroupRef.current;
    }
    setShowSettings(false);
    setShowRecents(true);
    if (activeContactRef.current) {
      setTimeout(() => setActiveContact(null), 300);
    }
    if (activeGroupRef.current) {
      setTimeout(() => {
        setActiveGroup(null);
        activeGroupRef.current = null;
      }, 300);
    }
  }, [setActiveContact, setActiveGroup]);

  const handleOpenContactChat = useCallback((contact) => {
    if (settingsOpenTimeoutRef.current) {
      clearTimeout(settingsOpenTimeoutRef.current);
      settingsOpenTimeoutRef.current = null;
    }
    if (isNavigatingBackRef.current) {
      setIsNavigatingBack(false);
      isNavigatingBackRef.current = false;
      setNavigatingBackFrom(null);
    }
    if (showSettingsRef.current) {
      setShowSettings(false);
      showSettingsRef.current = false;
    }
    if (showRecentsRef.current) {
      setShowRecents(false);
      showRecentsRef.current = false;
    }
    handleSelectContact(contact);
  }, [handleSelectContact]);

  const handleOpenGroupChat = useCallback((group) => {
    if (settingsOpenTimeoutRef.current) {
      clearTimeout(settingsOpenTimeoutRef.current);
      settingsOpenTimeoutRef.current = null;
    }
    if (isNavigatingBackRef.current) {
      setIsNavigatingBack(false);
      isNavigatingBackRef.current = false;
      setNavigatingBackFrom(null);
    }
    if (showSettingsRef.current) {
      setShowSettings(false);
      showSettingsRef.current = false;
    }
    if (showRecentsRef.current) {
      setShowRecents(false);
      showRecentsRef.current = false;
    }
    handleSelectGroup(group);
  }, [handleSelectGroup]);

  // Handle native back gestures
  useEffect(() => {
    const handlePopState = () => {
      if (window.__isProgrammaticPop) return;
      if (window.__isZapRecording || window.__isChatraRecording || window.__isPoppingRecording || window.__isPoppingCall || window.__isPoppingFullscreen) {
        window.__isPoppingCall = false;
        window.__isPoppingFullscreen = false;
        return;
      }

      if (confirmModalRef.current?.isOpen) {
        closeConfirm(true);
        return;
      }

      if (sidebarBackHandlerRef.current?.()) return;

      if (chatManager.lightboxRef?.current || lightboxImageSrc) {
        handleCloseLightbox(true);
        return;
      }

      if (showSafetyModalRef.current) {
        handleCloseSafetyModal(true);
        return;
      }

      if (forwardBackHandlerRef.current?.()) return;
      if (createGroupBackHandlerRef.current?.()) return;
      if (groupInfoBackHandlerRef.current?.()) return;

      if (forwardingMessageRef.current) {
        setForwardingMessage(null);
        return;
      }
      if (showCreateGroupRef.current) {
        setShowCreateGroup(false);
        return;
      }
      if (groupInfoGroupIdRef.current !== null) {
        setGroupInfoGroupId(null);
        return;
      }
      
      if (document.fullscreenElement || isFullscreenRef.current) {
        if (document.fullscreenElement) {
          document.exitFullscreen?.().catch(() => {});
        }
        setIsFullscreen(false);
        return;
      }
      
      if (callStateRef.current === 'connected' && !isCallMinimized) {
        setIsCallMinimized(true);
        return;
      }

      if (chatBackHandlerRef.current?.()) return;
      if (selectionBackRef.current?.(true)) return;

      if (activeContactRef.current || activeGroupRef.current || showSettingsRef.current || showRecentsRef.current) {
        handleBackToMenu(true);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [
    callStateRef,
    chatManager.lightboxRef,
    closeConfirm,
    handleBackToMenu,
    handleCloseLightbox,
    handleCloseSafetyModal,
    isCallMinimized,
    lightboxImageSrc,
    setForwardingMessage,
    setGroupInfoGroupId,
    setIsCallMinimized,
    setShowCreateGroup
  ]);

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const chatManagerRef = useRef(chatManager);
  useEffect(() => {
    chatManagerRef.current = chatManager;
  }, [chatManager]);

  const groupManagerRef = useRef(groupManager);
  useEffect(() => {
    groupManagerRef.current = groupManager;
  }, [groupManager]);

  // Socket Connection Setup
  useEffect(() => {
    if (!currentUser?.token) return;

    const socket = connectSocket(currentUser.token);

    socket.on('connect_error', (err) => {
      const msg = err?.message || '';
      const isAuthError = msg.includes('Authentication error') || msg.includes('Invalid token') || msg.includes('jwt');
      const isDbReset = msg.includes('database reset');

      if (isAuthError || isDbReset) {
        const reason = isDbReset
          ? 'Your session has expired because the server database was reset. Please register/login again.'
          : 'Your session has expired. Please log in again.';

        clearUserSession();
        setContacts([]);
        setActiveContact(null);
        setShowSettings(false);
        setGroups([]);
        setActiveGroup(null);
        setShowCreateGroup(false);
        setGroupInfoGroupId(null);
        groupKeysRef.current = {};
        userProfilesRef.current = {};
        sharedSecrets.current = {};
        showToast(reason, 'error', 'Session Ended');
      }
    });

    const syncMessagesForContacts = async (contactList) => {
      if (!currentUser || !contactList || contactList.length === 0) return;
      for (const contact of contactList) {
        try {
          const encryptedHistory = await emitGetChatHistory(contact.username);
          if (!encryptedHistory || encryptedHistory.length === 0) continue;
          const decryptedMessages = await chatManagerRef.current?.decryptMessagesBatch?.(encryptedHistory, contact) || [];
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
              const existingMsgs = c.messages || [];
              const byKey = new Map();
              for (const m of existingMsgs) {
                const key = String(m.id || m.timestamp || (m.mediaType + '_' + m.timestamp));
                byKey.set(key, m);
              }
              for (const m of processedMessages) {
                const key = String(m.id || m.timestamp || (m.mediaType + '_' + m.timestamp));
                byKey.set(key, m);
              }
              const merged = Array.from(byKey.values());
              merged.sort((a, b) => (new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) || ((a.id || 0) - (b.id || 0)));

              const lastMsg = merged.length > 0 ? merged[merged.length - 1] : (c.lastMessage || null);
              const finalUnread = isActive ? 0 : Math.max(c.unreadCount || 0, unreadCount);

              return {
                ...c,
                unreadCount: finalUnread,
                lastMessage: lastMsg,
                messages: merged
              };
            }
            return c;
          }));

          warmupMediaCache(processedMessages);

          if (isActive) {
            setActiveContact(prev => {
              if (prev && prev.username.toLowerCase() === contact.username.toLowerCase()) {
                const existingMsgs = prev.messages || [];
                const byKey = new Map();
                for (const m of existingMsgs) {
                  const key = String(m.id || m.timestamp || (m.mediaType + '_' + m.timestamp));
                  byKey.set(key, m);
                }
                for (const m of processedMessages) {
                  const key = String(m.id || m.timestamp || (m.mediaType + '_' + m.timestamp));
                  byKey.set(key, m);
                }
                const merged = Array.from(byKey.values());
                merged.sort((a, b) => (new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) || ((a.id || 0) - (b.id || 0)));
                const lastMsg = merged.length > 0 ? merged[merged.length - 1] : (prev.lastMessage || null);

                return { ...prev, messages: merged, lastMessage: lastMsg };
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

    const handleConnect = async () => {
      setIsSocketConnected(true);

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
                  unreadCount: sc.unreadCount || 0,
                  isSaved: false
                });
              } else {
                const c = existing.get(key);
                existing.set(key, {
                  ...c,
                  displayName: sc.displayName ?? c.displayName,
                  avatarIcon: sc.avatarIcon ?? c.avatarIcon,
                  status: sc.status || c.status,
                  publicIdentityKey: sc.publicIdentityKey || c.publicIdentityKey,
                  publicSigningKey: sc.publicSigningKey || c.publicSigningKey,
                  unreadCount: typeof sc.unreadCount === 'number' && sc.unreadCount > 0 ? Math.max(c.unreadCount || 0, sc.unreadCount) : c.unreadCount
                });
              }
            }
            return Array.from(existing.values());
          });
        }
      } catch (e) {
        console.warn('Failed to load contacts from server:', e);
      }

      const allContacts = (freshServerContacts.length > 0 ? freshServerContacts : contactsRef.current)
        .filter(c => !currentBlocked.includes(c.username.toLowerCase()));
      allContacts.forEach(async (c) => {
        try {
          const res = await emitGetUserStatus(c.username);
          chatManagerRef.current?.updateContactProfileAndStatus?.(c.username, res.status, res.displayName, res.avatarIcon);
        } catch (e) {
          console.error('Failed to fetch status for contact:', c.username, e);
        }
      });

      const existingUsernames = new Set(contactsRef.current.map(c => c.username.toLowerCase()));
      const newContacts = freshServerContacts.filter(sc => !existingUsernames.has(sc.username.toLowerCase()));

      const groupsPromise = (groupManagerRef.current?.loadGroups?.() || Promise.resolve()).catch(e => {
        console.warn('Failed to load groups on connect:', e);
      });

      if (newContacts.length > 0) {
        await syncMessagesForContacts(newContacts);
      }
      await groupsPromise;
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

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleDisconnect);
      disconnectSocket();
    };
  }, [currentUser?.token, currentUser?.username]);

  // Secure sign out
  const handleLogout = useCallback(() => {
    showConfirm({
      title: 'Sign out of ZAP?',
      message: 'Your encryption keys are stored locally on this device. Make sure you know your password to sign back in.',
      confirmText: 'Sign Out',
      cancelText: 'Cancel',
      isDanger: true,
      onConfirm: () => {
        cleanupCall();
        gcCleanupAll(true);
        disconnectSocket();
        clearUserSession();
        previousActiveContactRef.current = null;
        previousActiveGroupRef.current = null;
        setContacts([]);
        setActiveContact(null);
        setShowSettings(false);
        setShowRecents(false);
        setGroups([]);
        setActiveGroup(null);
        activeGroupRef.current = null;
        setShowCreateGroup(false);
        setGroupInfoGroupId(null);
        groupKeysRef.current = {};
        userProfilesRef.current = {};
        sharedSecrets.current = {};
        clearMediaCache();
      }
    });
  }, [
    cleanupCall,
    clearUserSession,
    gcCleanupAll,
    groupKeysRef,
    setActiveContact,
    setActiveGroup,
    activeGroupRef,
    setContacts,
    setGroupInfoGroupId,
    setGroups,
    setShowCreateGroup,
    sharedSecrets,
    showConfirm,
    userProfilesRef
  ]);

  const isMobileSize = windowWidth <= 768;
  const isAppMinimized = sidebarMinimized && !isMobileSize;
  const activeGroupVm = activeGroup ? {
    ...activeGroup,
    groupTypingNames: (activeGroup.typingUsers || [])
      .filter(u => u.toLowerCase() !== currentUser?.username?.toLowerCase())
      .map(u => {
        const m = (activeGroup.members || []).find(mm => mm.username.toLowerCase() === u.toLowerCase());
        return m?.profile?.displayName || u;
      })
  } : null;

  const getGroupMemberName = useCallback((username) => {
    const g = groupsRef.current.find(gr => gr.id === activeGroupRef.current?.id);
    if (!g) return username;
    const m = (g.members || []).find(mm => mm.username.toLowerCase() === String(username).toLowerCase());
    if (!m) return username;
    if (m.username.toLowerCase() === currentUser?.username?.toLowerCase()) return 'You';
    return m.profile?.displayName || m.username;
  }, [activeGroupRef, currentUser?.username, groupsRef]);

  const keepChatActiveDuringSettingsReturn = isNavigatingBack && navigatingBackFrom === 'settings' && Boolean(activeContact || activeGroupVm);

  return (
    <>
      {isRestoring ? (
        <div className={`app-preloader ${isPreloaderFading ? 'fading-out' : ''}`}>
          <div className="preloader-logo-container">
            <ZapLogo size={56} />
          </div>
          <div className="preloader-bar-bg">
            <div className="preloader-bar" />
          </div>
          <div className="preloader-text">Restoring Secure Session</div>
        </div>
      ) : !currentUser ? (
        <Login onAuthSuccess={setCurrentUser} />
      ) : (
        <div className={`app-container ${((activeContact || activeGroupVm || showSettings || showRecents) && (!isNavigatingBack || keepChatActiveDuringSettingsReturn)) ? 'chat-active' : ''} ${isAppMinimized ? 'sidebar-minimized' : ''} ${isSidebarAnimating ? 'is-sidebar-animating' : ''}`}>
          
          {(!isOnline || showConnectingBanner) && (
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
            groups={groups}
            activeContact={activeContact}
            activeGroup={activeGroup}
            setActiveContact={handleOpenContactChat}
            onSelectGroup={handleOpenGroupChat}
            onOpenCreateGroup={() => setShowCreateGroup(true)}
            onOpenGroupInfo={(group) => setGroupInfoGroupId(group.id)}
            onLeaveGroup={handleLeaveGroupById}
            onDeleteGroup={handleDeleteGroupById}
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
            onShowSettings={openSettingsView}
            onShowRecents={openRecentsView}
          />
          <div className="main-content-pane">
            {(!activeContact && !activeGroup && !showSettings && !(isNavigatingBack && navigatingBackFrom === 'settings')) && (
              <Dashboard
                currentUser={currentUser}
                contacts={contacts}
                onInitiateCall={handleInitiateCall}
                onSelectContact={handleOpenContactChat}
                onShowSettings={openSettingsView}
                onBack={handleBackToMenu}
                showBackButton={showRecents}
              />
            )}

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
                }}
              />
            )}

            {(() => {
              const showGroupNow = Boolean(activeGroupVm) ||
                (isNavigatingBack && navigatingBackFrom === 'chat' && lastChatKindRef.current === 'group');
              const activeVm = showGroupNow
                ? (activeGroupVm || lastActiveGroupVmRef.current)
                : (lastChatKindRef.current === 'group' && !activeContact
                    ? null
                    : (activeContact ||
                        (isNavigatingBack && navigatingBackFrom === 'chat' ? lastActiveContactRef.current : null)));
              if (!activeVm) return null;

              const groupMode = Boolean(activeVm.isGroup);
              return (
                <ChatArea
                  currentUser={currentUser}
                  activeContact={activeVm}
                  isBlocked={!groupMode && Boolean(activeVm.username && blockedUsers.includes(activeVm.username.toLowerCase()))}
                  onUnblockContact={handleUnblockContact}
                  onSendMessage={groupMode ? handleSendGroupMessage : handleSendMessage}
                  onInitiateCall={groupMode ? handleStartGroupCall : handleInitiateCall}
                  currentUserToken={currentUser.token}
                  sharedSecret={groupMode ? null : sharedSecrets.current[activeVm.username?.toLowerCase()]}
                  onBack={handleBackToMenu}
                  isNavigatingBack={isNavigatingBack && navigatingBackFrom === 'chat'}
                  markMessageAsReadLocal={groupMode ? () => {} : (id) => markAllMessagesAsReadLocal(activeVm.username)}
                  markAllMessagesAsReadLocal={groupMode ? () => {} : markAllMessagesAsReadLocal}
                  onImageClick={handleOpenLightbox}
                  onVerifyContact={groupMode ? () => {} : handleVerifyContact}
                  onSaveContact={groupMode ? () => {} : handleSaveContact}
                  onBlockContact={groupMode ? () => {} : handleBlockContact}
                  onDeleteMessages={(ids) => deleteMessagesLocal(ids, groupMode ? activeVm : null)}
                  selectionCancelCallbackRef={selectionBackRef}
                  chatBackHandlerRef={chatBackHandlerRef}
                  onOpenSafetyModal={groupMode ? () => {} : handleOpenSafetyModal}
                  replyingTo={replyingTo}
                  setReplyingTo={setReplyingTo}
                  onForwardMessage={handleForwardRequest}
                  showToast={showToast}
                  onOpenGroupInfo={groupMode ? () => setGroupInfoGroupId(activeVm.id) : null}
                  getGroupMemberName={groupMode ? getGroupMemberName : null}
                />
              );
            })()}
          </div>

          {/* WebRTC 1-on-1 Call Window */}
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

          {/* Mesh Group Call Window */}
          <GroupCallWindow
            visible={gcState !== 'idle'}
            isIncoming={gcState === 'ringing'}
            waitingOut={gcState === 'calling'}
            mediaType={gcMediaType}
            group={groups.find(g => g.id === gcGroupId) || null}
            localStream={localStream}
            remoteUsers={(() => {
              const usernames = new Set([
                ...Object.keys(gcPeers),
                ...Object.keys(gcRemoteStreams)
              ]);
              usernames.delete(currentUser.username.toLowerCase());
              return [...usernames].map((lower) => {
                const member = (groups.find(g => g.id === gcGroupId)?.members || []).find(m => m.username.toLowerCase() === lower);
                return {
                  username: lower,
                  displayName: member?.profile?.displayName || null,
                  avatarIcon: member?.profile?.avatarIcon || null,
                  stream: gcRemoteStreams[lower] || null,
                  state: gcPeers[lower] || { muted: false, cameraOff: false, screenSharing: false }
                };
              });
            })()}
            myUsername={currentUser.username.toLowerCase()}
            elapsed={gcElapsed}
            isMuted={gcIsMuted}
            isCameraOff={gcIsCameraOff}
            isScreenSharing={gcIsScreenSharing}
            minimized={gcMinimized && (gcState === 'connected' || gcState === 'calling')}
            onToggleMinimize={() => setGcMinimized((v) => !v)}
            onAccept={handleAcceptGroupCall}
            onDecline={handleDeclineGroupCall}
            onEnd={handleLeaveGroupCall}
            onToggleMute={handleGcToggleMute}
            onToggleCamera={handleGcToggleCamera}
            onToggleScreenShare={handleGcToggleScreenShare}
          />

          {/* Image Lightbox Modal */}
          <div 
            className={`image-lightbox-overlay ${lightboxImageSrc ? 'visible' : ''}`} 
            onClick={() => handleCloseLightbox()}
          >
            <button className="lightbox-close-btn" onClick={() => handleCloseLightbox()}>
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

          {/* Forward Message Picker */}
          <ForwardModal
            message={forwardingMessage}
            contacts={contacts}
            groups={groups}
            blockedUsers={blockedUsers}
            backHandlerRef={forwardBackHandlerRef}
            onClose={() => setForwardingMessage(null)}
            onConfirm={handleConfirmForward}
          />

          {/* Create Group Modal */}
          {showCreateGroup && (
            <CreateGroupModal
              contacts={contacts}
              currentUser={currentUser}
              blockedUsers={blockedUsers}
              showToast={showToast}
              backHandlerRef={createGroupBackHandlerRef}
              onClose={() => setShowCreateGroup(false)}
              onCreate={handleCreateGroup}
            />
          )}

          {/* Group Info & Member Management */}
          {groupInfoGroupId !== null && (() => {
            const infoGroup = groups.find(g => g.id === groupInfoGroupId);
            if (!infoGroup) return null;
            return (
              <GroupInfoModal
                currentUser={currentUser}
                group={{
                  ...infoGroup,
                  groupId: infoGroup.id,
                  username: `group-${infoGroup.id}`
                }}
                backHandlerRef={groupInfoBackHandlerRef}
                onClose={() => setGroupInfoGroupId(null)}
                onUpdateGroupInfo={handleUpdateGroupInfo}
                onAddMembers={handleAddMembersToGroup}
                onRemoveMember={handleRemoveMemberFromGroup}
                onSetRole={handleSetMemberRole}
                onLeaveGroup={(group) => handleLeaveGroupById(group.id)}
                onDeleteGroup={(group) => handleDeleteGroupById(group.id)}
                showToast={showToast}
              />
            );
          })()}

          {/* Safety Number Modal */}
          {(showSafetyModal || isSafetyModalClosing) && activeContact && (
            <div 
              className={`safety-modal-overlay ${isSafetyModalClosing ? 'closing' : ''}`} 
              onClick={() => handleCloseSafetyModal()}
            >
              <div 
                className={`safety-modal-card glass ${isSafetyModalClosing ? 'closing' : ''}`} 
                onClick={(e) => e.stopPropagation()}
              >
                <div className="safety-modal-header">
                  <div className="safety-header-title-group">
                    <div className={`safety-modal-icon-badge ${activeContact.isVerified ? 'verified' : ''}`}>
                      <ShieldCheck size={20} />
                    </div>
                    <h3>E2EE Safety Number</h3>
                  </div>
                  <button 
                    className="safety-close-btn" 
                    onClick={() => handleCloseSafetyModal()}
                    title="Close (Esc)"
                    aria-label="Close safety number modal"
                  >
                    <X size={17} />
                  </button>
                </div>
                <div className="safety-modal-body">
                  <p className="safety-modal-desc">
                    To verify the cryptographic security of your end-to-end encrypted connection with <strong>{activeContact.displayName || activeContact.username}</strong>, compare the numbers below with the numbers on their screen.
                  </p>
                  
                  <div 
                    className="safety-number-display"
                    onClick={() => {
                      const num = safetyNumberDisplay || 'Calculating...';
                      navigator.clipboard?.writeText(num);
                      if (navigator.vibrate) navigator.vibrate(10);
                      showToast?.('Safety number copied to clipboard', 'info');
                    }}
                    title="Click to copy safety number"
                  >
                    <span className="safety-number-digits">
                      {safetyNumberDisplay || 'Calculating...'}
                    </span>
                    <span className="safety-copy-icon-wrapper" title="Copy">
                      <Copy size={14} className="safety-copy-icon" />
                    </span>
                  </div>
                  
                  <div className="safety-status-row">
                    <span className="safety-status-label">Verification status:</span>
                    <span className={`status-badge ${activeContact.isVerified ? 'verified' : 'unverified'}`}>
                      {activeContact.isVerified ? 'VERIFIED' : 'NOT VERIFIED'}
                    </span>
                  </div>
                  
                  <button 
                    type="button" 
                    className={`safety-toggle-verify-btn ${activeContact.isVerified ? 'unverify' : 'verify'}`}
                    onClick={() => {
                      if (navigator.vibrate) navigator.vibrate(15);
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
      )}

      {/* Floating In-App Toast Notification Stack */}
      <AppToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Custom In-App Action Confirmation Modal */}
      <AppConfirmModal modalState={confirmModal} onClose={closeConfirm} />
    </>
  );
}
