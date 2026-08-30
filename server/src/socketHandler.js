import jwt from 'jsonwebtoken';
import { dbAll, dbGet } from './db.js';
import config from './config.js';
import logger from './logger.js';
import { registerGroupHandlers } from './groupHandler.js';
import { registerCallHandlers, handleCallDisconnect } from './handlers/callSocketHandler.js';
import { registerMessageHandlers, deliverOfflineMessages } from './handlers/messageSocketHandler.js';
import { registerUserHandlers } from './handlers/userSocketHandler.js';

// Map to track active sockets by username: username (lowercase) -> Set(socketId)
const onlineUsers = new Map();

// Helper: Check if a user has any active WebSocket connection
const isUserOnline = (username) => {
  if (!username) return false;
  const sockets = onlineUsers.get(username.toLowerCase());
  return sockets ? sockets.size > 0 : false;
};

// Helper: Add a socket ID for a user. Returns true if they transitioned from offline to online.
const addUserSocket = (username, socketId) => {
  const key = username.toLowerCase();
  if (!onlineUsers.has(key)) {
    onlineUsers.set(key, new Set());
  }
  const sockets = onlineUsers.get(key);
  sockets.add(socketId);
  return sockets.size === 1;
};

// Helper: Remove a socket ID for a user. Returns true if they transitioned from online to offline.
const removeUserSocket = (username, socketId) => {
  const key = username.toLowerCase();
  const sockets = onlineUsers.get(key);
  if (sockets) {
    sockets.delete(socketId);
    if (sockets.size === 0) {
      onlineUsers.delete(key);
      return true;
    }
  }
  return false;
};

// Helper: Broadcast user status to others, strictly excluding any blocked relations
const broadcastUserStatus = async (io, username, status) => {
  try {
    const blockedRows = await dbAll(
      'SELECT username, blocked_username FROM blocked_users WHERE LOWER(username) = LOWER(?) OR LOWER(blocked_username) = LOWER(?)',
      [username, username]
    );
    const blockedSet = new Set();
    for (const row of blockedRows) {
      if (row.username.toLowerCase() === username.toLowerCase()) {
        blockedSet.add(row.blocked_username.toLowerCase());
      } else {
        blockedSet.add(row.username.toLowerCase());
      }
    }

    for (const [onlineUser] of onlineUsers.entries()) {
      const lower = onlineUser.toLowerCase();
      if (lower !== username.toLowerCase() && !blockedSet.has(lower)) {
        io.to(lower).emit('user-status', { username, status });
      }
    }
  } catch (err) {
    logger.error('Error in broadcastUserStatus:', err);
  }
};

export const socketHandler = (io) => {
  // Socket.io JWT Authentication Middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication error: Token missing'));
    }

    try {
      const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
      
      const userExists = await dbGet('SELECT 1 FROM users WHERE LOWER(username) = LOWER(?)', [decoded.username]);
      if (!userExists) {
        logger.warn(`Socket auth failed: User "${decoded.username}" not found in DB.`);
        return next(new Error('Authentication error: User not found'));
      }

      socket.user = decoded; // Contains id and username
      next();
    } catch (err) {
      logger.debug('Socket authentication failed:', { error: err.message });
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const username = socket.user.username;
    logger.info(`User connected: ${username} (Socket ID: ${socket.id})`);
    
    // Track online user socket
    const wentOnline = addUserSocket(username, socket.id);
    socket.join(username.toLowerCase());

    // Subscribe socket to every group room this user belongs to
    dbAll('SELECT group_id FROM group_members WHERE LOWER(username) = LOWER(?)', [username])
      .then((rows) => {
        for (const row of rows) {
          socket.join(`group_${row.group_id}`);
        }
      })
      .catch((err) => logger.error('Failed to join group rooms on connect:', err));

    // Per-socket event rate limiting (max 120 event packets per second per connection)
    let eventCount = 0;
    const resetTimer = setInterval(() => { eventCount = 0; }, 1000);
    resetTimer.unref();

    socket.use((packet, next) => {
      eventCount++;
      if (eventCount > 120) {
        logger.warn(`Rate limit exceeded on socket ${socket.id} (user: ${username}). Throttling excess packet.`);
        return;
      }
      next();
    });

    // Broadcast online status to others on first tab connection
    if (wentOnline) {
      broadcastUserStatus(io, username, 'online');
    }

    // Deliver unread offline messages
    deliverOfflineMessages(socket, io, username);

    // Register domain-specific sub-handlers
    registerUserHandlers(socket, io, { isUserOnline });
    registerMessageHandlers(socket, io, { isUserOnline });
    registerCallHandlers(socket, io, { isUserOnline });
    registerGroupHandlers(socket, io, { isUserOnline });

    socket.on('disconnect', () => {
      clearInterval(resetTimer);
      logger.info(`User disconnected: ${username} (Socket ID: ${socket.id})`);
      
      handleCallDisconnect(username, io, isUserOnline);

      const wentOffline = removeUserSocket(username, socket.id);
      if (wentOffline) {
        broadcastUserStatus(io, username, 'offline');
      }
    });
  });
};

export default socketHandler;
