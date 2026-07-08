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
    reconnection: true
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
 * Send encrypted message payload to the server.
 */
export const emitSendMessage = (recipient, ciphertext, iv, signature) => {
  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error('Socket not connected'));

    socket.emit('send-message', { recipient, ciphertext, iv, signature }, (response) => {
      if (response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
};

/**
 * Fetch chat history with a specific user.
 */
export const emitGetChatHistory = (withUser) => {
  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error('Socket not connected'));

    socket.emit('get-chat-history', { withUser }, (response) => {
      if (response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response.messages);
      }
    });
  });
};

/**
 * Check user online/offline status.
 */
export const emitGetUserStatus = (targetUsername) => {
  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error('Socket not connected'));

    socket.emit('get-user-status', targetUsername, (response) => {
      resolve(response); // Returns full response including status, displayName, and avatarIcon
    });
  });
};

/**
 * Mark all unread messages from a contact as read.
 */
export const emitMarkAsRead = (sender) => {
  if (socket) {
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
  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error('Socket not connected'));
    socket.emit('update-profile', { displayName, avatarIcon }, (response) => {
      if (response && response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
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
