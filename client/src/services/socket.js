import { io } from 'socket.io-client';
import { BASE_URL } from './baseUrl.js';
import {
  getAccessToken,
  getValidAccessToken,
  refreshAccessToken,
  SessionInvalidError
} from './tokenManager.js';

let socket = null;
const eventListeners = new Map(); // eventName -> Set of functions

// Handshake rejection codes that a token refresh can recover from.
const RECOVERABLE_AUTH_CODES = new Set(['TOKEN_EXPIRED', 'TOKEN_INVALID', 'TOKEN_MISSING']);
// Handshake rejection codes that mean the session itself is gone.
const TERMINAL_AUTH_CODES = new Set(['SESSION_REVOKED', 'USER_NOT_FOUND']);

const MANUAL_RECONNECT_BASE_MS = 1000;
const MANUAL_RECONNECT_MAX_MS = 30000;

/**
 * Connect to the Socket.io server.
 *
 * A fresh access token is supplied on *every* connection attempt (the `auth`
 * callback is re-evaluated by socket.io on each reconnect), so long-lived
 * connections survive access-token expiry transparently. If the server rejects
 * the handshake, the token is refreshed and the connection retried; the user is
 * only signed out if the session itself has been revoked (broadcast through
 * `onSessionInvalidated` in the token manager).
 *
 * @returns {Socket}
 */
export const connectSocket = () => {
  if (socket) {
    socket.disconnect();
  }

  let manualReconnectTimer = null;
  let manualReconnectAttempts = 0;

  const instance = io(BASE_URL, {
    auth: (cb) => {
      getValidAccessToken()
        .then((token) => cb({ token }))
        // Offline / server asleep: try with whatever we have; the handshake handler recovers.
        .catch(() => cb({ token: getAccessToken() }));
    },
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
  });
  socket = instance;

  const scheduleManualReconnect = () => {
    if (manualReconnectTimer || socket !== instance) return;
    const delay = Math.min(MANUAL_RECONNECT_MAX_MS, MANUAL_RECONNECT_BASE_MS * 2 ** manualReconnectAttempts)
      + Math.floor(Math.random() * 500);
    manualReconnectAttempts++;
    manualReconnectTimer = setTimeout(() => {
      manualReconnectTimer = null;
      if (socket === instance && !instance.connected) {
        instance.connect();
      }
    }, delay);
  };

  // Re-attach all registered listeners across reconnects
  for (const [event, cbs] of eventListeners.entries()) {
    for (const cb of cbs) {
      instance.on(event, cb);
    }
  }

  instance.on('connect', () => {
    manualReconnectAttempts = 0;
    console.log('Connected to chat server (Socket ID:', instance.id, ')');
  });

  instance.on('disconnect', (reason) => {
    console.log('Disconnected from chat server:', reason);
    // The server forcibly closed the connection (e.g. session revoked); socket.io won't retry
    // on its own. Reconnecting will either succeed or surface the precise auth error.
    if (reason === 'io server disconnect' && socket === instance) {
      scheduleManualReconnect();
    }
  });

  instance.on('connect_error', (error) => {
    console.error('Socket connection error:', error.message);

    // Transport-level failures: socket.io's built-in reconnection keeps retrying.
    if (instance.active) return;

    // The server middleware rejected the handshake: socket.io will NOT retry automatically.
    const code = error?.data?.code;

    if (TERMINAL_AUTH_CODES.has(code)) {
      // Confirm with the refresh endpoint (the authoritative check). If the session is really
      // gone, the token manager broadcasts it via onSessionInvalidated and the app signs out.
      refreshAccessToken(getAccessToken())
        .then(() => scheduleManualReconnect())
        .catch((err) => {
          if (!(err instanceof SessionInvalidError)) scheduleManualReconnect();
        });
      return;
    }

    if (RECOVERABLE_AUTH_CODES.has(code)) {
      refreshAccessToken(getAccessToken())
        .then(() => {
          if (socket === instance) instance.connect();
        })
        .catch((err) => {
          // SessionInvalidError is broadcast by the token manager; transient errors -> retry later
          if (!(err instanceof SessionInvalidError)) scheduleManualReconnect();
        });
      return;
    }

    // SERVER_UNAVAILABLE or unknown middleware errors: back off and retry.
    scheduleManualReconnect();
  });

  // Ensure pending manual reconnects are cancelled when this socket is replaced/closed.
  const originalDisconnect = instance.disconnect.bind(instance);
  instance.disconnect = (...args) => {
    if (manualReconnectTimer) {
      clearTimeout(manualReconnectTimer);
      manualReconnectTimer = null;
    }
    return originalDisconnect(...args);
  };

  return instance;
};

/**
 * Disconnect current socket connection.
 */
export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

const socketProxy = {
  get connected() {
    return Boolean(socket?.connected);
  },
  get id() {
    return socket?.id || null;
  },
  on(event, callback) {
    if (!eventListeners.has(event)) {
      eventListeners.set(event, new Set());
    }
    eventListeners.get(event).add(callback);
    if (socket) {
      socket.on(event, callback);
    }
    return socketProxy;
  },
  off(event, callback) {
    if (eventListeners.has(event)) {
      eventListeners.get(event).delete(callback);
    }
    if (socket) {
      socket.off(event, callback);
    }
    return socketProxy;
  },
  once(event, callback) {
    if (socket) {
      socket.once(event, callback);
    } else {
      const wrapped = (...args) => {
        socketProxy.off(event, wrapped);
        callback(...args);
      };
      socketProxy.on(event, wrapped);
    }
    return socketProxy;
  },
  emit(event, ...args) {
    if (socket) {
      return socket.emit(event, ...args);
    }
    return false;
  },
  disconnect() {
    disconnectSocket();
  }
};

/**
 * Get active socket instance or proxy.
 */
export const getSocket = () => socketProxy;

/**
 * Helper to wrap socket emit callback in a promise with connection waiting & timeout guard.
 */
const emitWithTimeout = (eventName, payload, timeoutMs = 15000) => {
  return new Promise((resolve, reject) => {
    if (!socket) {
      return reject(new Error('Socket connection not initialized. Please refresh.'));
    }

    const checkAndEmit = () => {
      let timer = setTimeout(() => {
        timer = null;
        reject(new Error('Request timed out. Please check server connection.'));
      }, timeoutMs);

      socket.emit(eventName, payload, (response) => {
        if (!timer) return;
        clearTimeout(timer);
        
        if (response && response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });
    };

    if (socket.connected) {
      checkAndEmit();
    } else {
      // If socket is currently connecting/reconnecting, wait up to 4 seconds for connection
      const connectHandler = () => {
        cleanup();
        checkAndEmit();
      };
      const errorHandler = (err) => {
        cleanup();
        reject(new Error(`Socket connection error: ${err.message || 'Disconnected'}`));
      };
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Socket disconnected. Please check your network connection.'));
      }, 4000);

      const cleanup = () => {
        clearTimeout(timeoutId);
        socket.off('connect', connectHandler);
        socket.off('connect_error', errorHandler);
      };

      socket.once('connect', connectHandler);
      socket.once('connect_error', errorHandler);
    }
  });
};

/**
 * Send encrypted message payload to the server.
 */
export const emitSendMessage = (recipient, ciphertext, iv, signature, aad = null, authTag = null) => {
  return emitWithTimeout('send-message', { recipient, ciphertext, iv, signature, aad, authTag });
};

export const emitDeleteMessages = (messageIds) =>
  emitWithTimeout('delete-messages', { messageIds });

export const emitDeleteGroupMessages = (groupId, messageIds) =>
  emitWithTimeout('delete-group-messages', { groupId, messageIds });

export const emitDeleteChat = (withUser) =>
  emitWithTimeout('delete-chat', { withUser });

export const emitBlockUser = (targetUsername) =>
  emitWithTimeout('block-user', { targetUsername });

export const emitUnblockUser = (targetUsername) =>
  emitWithTimeout('unblock-user', { targetUsername });

export const emitGetBlockedUsers = () =>
  emitWithTimeout('get-blocked-users', {}).then(res => res.blockedUsers || []);

/**
 * Fetch chat history with a specific user.
 */
export const emitGetChatHistory = (withUser) => {
  return emitWithTimeout('get-chat-history', { withUser }).then(res => res.messages || []);
};

/**
 * Fetch all conversation partners (contacts) for the current user from server.
 */
export const emitGetContacts = () => {
  return emitWithTimeout('get-contacts', {}).then(res => res.contacts || []);
};

/**
 * Check user online/offline status.
 */
export const emitGetUserStatus = (targetUsername) => {
  return emitWithTimeout('get-user-status', targetUsername).catch(err => {
    console.warn(`Failed to fetch status for ${targetUsername}:`, err.message);
    return { username: targetUsername, status: 'offline' };
  });
};

/**
 * Mark all unread messages from a contact as read.
 */
export const emitMarkAsRead = (sender) => {
  if (socket && socket.connected) {
    socket.emit('mark-as-read', { sender });
  }
};

// ==========================================
// WebSockets Event Listeners Register Hooks
// ==========================================

export const subscribeToMessages = (callback) => {
  socketProxy.on('receive-message', callback);
};

export const unsubscribeFromMessages = (callback) => {
  socketProxy.off('receive-message', callback);
};

export const subscribeToUserStatus = (callback) => {
  socketProxy.on('user-status', callback);
};

export const unsubscribeFromUserStatus = (callback) => {
  socketProxy.off('user-status', callback);
};

/**
 * Emit profile update (display name and custom avatar emoji/color).
 */
export const emitUpdateProfile = (displayName, avatarIcon, themeColor) => {
  return emitWithTimeout('update-profile', { displayName, avatarIcon, themeColor });
};

// ==========================================
// E2EE Group Chat Emits
// ==========================================

export const emitCreateGroup = (payload) =>
  emitWithTimeout('create-group', payload);

export const emitGetGroups = () =>
  emitWithTimeout('get-groups', {}).then(res => res.groups || []);

export const emitGetGroupMessages = (groupId, beforeId = null, limit = 300) =>
  emitWithTimeout('get-group-messages', { groupId, beforeId, limit }).then(res => ({
    messages: res.messages || [],
    hasMore: Boolean(res.hasMore)
  }));

export const emitSendGroupMessage = (groupId, ciphertext, iv, signature) =>
  emitWithTimeout('send-group-message', { groupId, ciphertext, iv, signature });

export const emitAddGroupMembers = (payload) =>
  emitWithTimeout('add-group-members', payload);

export const emitRemoveGroupMember = (payload) =>
  emitWithTimeout('remove-group-member', payload);

export const emitLeaveGroup = (payload) =>
  emitWithTimeout('leave-group', payload);

export const emitDeleteGroup = (groupId) =>
  emitWithTimeout('delete-group', { groupId });

export const emitUpdateGroupInfo = (payload) =>
  emitWithTimeout('update-group-info', payload);

export const emitSetMemberRole = (groupId, targetUsername, role) =>
  emitWithTimeout('set-member-role', { groupId, targetUsername, role });

export const emitGetGroupKey = (groupId, kv) =>
  emitWithTimeout('get-group-key', { groupId, kv }).then(res => res.envelope || null);

export const emitMarkGroupRead = (groupId, lastReadId) => {
  if (socket && socket.connected) {
    socket.emit('mark-group-read', { groupId, lastReadId });
  }
};

export const emitGroupTyping = (groupId, isTyping) => {
  if (socket && socket.connected) {
    socket.emit('group-typing', { groupId, isTyping });
  }
};

// ==========================================
// Group Call Signaling Emits
// ==========================================

export const emitStartGroupCall = (groupId, mediaType) =>
  emitWithTimeout('start-group-call', { groupId, mediaType });

export const emitJoinGroupCall = (groupId) =>
  emitWithTimeout('join-group-call', { groupId });

export const emitLeaveGroupCall = (groupId) => {
  if (socket && socket.connected) {
    socket.emit('leave-group-call', { groupId });
  }
};

export const emitGroupCallSignal = (payload) => {
  if (socket && socket.connected) {
    socket.emit('group-call-signal', payload);
  }
};

export const emitGroupCallState = (groupId, state) => {
  if (socket && socket.connected) {
    socket.emit('group-call-state', { groupId, ...state });
  }
};

/**
 * Listen for realtime profile changes from other users.
 */
export const subscribeToProfileUpdates = (callback) => {
  socketProxy.on('user-profile-updated', callback);
};

export const unsubscribeFromProfileUpdates = (callback) => {
  socketProxy.off('user-profile-updated', callback);
};
