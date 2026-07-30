import { io } from 'socket.io-client';
import { BASE_URL } from './api.js';

let socket = null;

/**
 * Connect to the Socket.io server with the user JWT token.
 * @param {string} token - JWT Token
 * @returns {Socket}
 */
export const connectSocket = (token) => {
  if (socket) {
    socket.disconnect();
  }

  socket = io(BASE_URL, {
    auth: { token },
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
  });

  socket.on('connect', () => {
    console.log('Connected to chat server (Socket ID:', socket.id, ')');
  });

  socket.on('disconnect', (reason) => {
    console.log('Disconnected from chat server:', reason);
  });

  socket.on('connect_error', (error) => {
    console.error('Socket connection error:', error.message);
  });

  return socket;
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

/**
 * Get active socket instance.
 */
export const getSocket = () => socket;

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
export const emitSendMessage = (recipient, ciphertext, iv, signature) => {
  return emitWithTimeout('send-message', { recipient, ciphertext, iv, signature });
};

/**
 * Fetch chat history with a specific user.
 */
export const emitGetChatHistory = (withUser) => {
  return emitWithTimeout('get-chat-history', { withUser }).then(res => res.messages || []);
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
  if (!socket) return;
  socket.on('receive-message', callback);
};

export const unsubscribeFromMessages = (callback) => {
  if (!socket) return;
  socket.off('receive-message', callback);
};

export const subscribeToUserStatus = (callback) => {
  if (!socket) return;
  socket.on('user-status', callback);
};

export const unsubscribeFromUserStatus = (callback) => {
  if (!socket) return;
  socket.off('user-status', callback);
};

/**
 * Emit profile update (display name and custom avatar emoji/color).
 */
export const emitUpdateProfile = (displayName, avatarIcon) => {
  return emitWithTimeout('update-profile', { displayName, avatarIcon });
};

/**
 * Listen for realtime profile changes from other users.
 */
export const subscribeToProfileUpdates = (callback) => {
  if (!socket) return;
  socket.on('user-profile-updated', callback);
};

export const unsubscribeFromProfileUpdates = (callback) => {
  if (!socket) return;
  socket.off('user-profile-updated', callback);
};
