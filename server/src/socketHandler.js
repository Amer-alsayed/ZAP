import jwt from 'jsonwebtoken';
import { dbRun, dbAll, dbGet } from './db.js';
import config from './config.js';
import logger from './logger.js';
import { registerGroupHandlers } from './groupHandler.js';

// Map to track active sockets by username: username (lowercase) -> Set(socketId)
const onlineUsers = new Map();

// Map to track active call sessions: callerUsername (lowercase) -> session details
const activeCalls = new Map();

// Call session TTL (expire stale calling sessions older than 2 minutes)
const CALL_SESSION_TTL_MS = 2 * 60 * 1000;

// Periodic cleanup interval for stale call sessions (unref'd to avoid blocking graceful process shutdown)
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [callerKey, session] of activeCalls.entries()) {
    if (now - session.timestamp > CALL_SESSION_TTL_MS && session.status !== 'connected') {
      logger.info(`Cleaning up stale call session for caller: ${session.caller}`);
      activeCalls.delete(callerKey);
    }
  }
}, 60 * 1000);

cleanupInterval.unref();

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
      
      // Verify user exists in database
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
    socket.join(username.toLowerCase()); // Case-insensitive room name subscription

    // Subscribe the socket to every group room this user is a member of
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
        return; // Throttle excess packets cleanly without disconnecting the client socket
      }
      next();
    });

    // Broadcast online status to others only if they just connected their first tab (excluding blocked relations)
    if (wentOnline) {
      broadcastUserStatus(io, username, 'online');
    }

    // Check if there is a pending call session for this newly connected user
    for (const [callerKey, session] of activeCalls.entries()) {
      if (session.recipient.toLowerCase() === username.toLowerCase() && session.status !== 'connected') {
        logger.info(`Relaying pending call offer to newly connected user: ${username}`);
        socket.emit('call-made', {
          offer: session.offer,
          from: session.caller,
          mediaType: session.mediaType
        });
        session.status = 'ringing';
        io.to(session.caller.toLowerCase()).emit('call-ringing', { from: username });
      }
    }

    // Automatically retrieve offline messages, deliver them, and notify senders
    const deliverOfflineMessages = async () => {
      try {
        const offlineMessages = await dbAll(
          `SELECT m.id, m.sender, m.recipient, m.ciphertext, m.iv, m.signature, m.timestamp, m.delivered
           FROM messages m
           LEFT JOIN deleted_messages_user d ON m.id = d.message_id AND LOWER(d.username) = LOWER(?)
           WHERE LOWER(m.recipient) = LOWER(?) AND m.delivered = 0 AND d.message_id IS NULL
           ORDER BY m.timestamp ASC`,
          [username, username]
        );

        if (offlineMessages.length > 0) {
          logger.info(`Delivering ${offlineMessages.length} offline messages to: ${username}`);
          
          // Atomically mark messages as delivered FIRST to prevent multi-socket duplicate delivery
          const messageIds = offlineMessages.map(m => m.id);
          const placeholders = messageIds.map(() => '?').join(',');
          await dbRun(
            `UPDATE messages SET delivered = 1 WHERE id IN (${placeholders}) AND delivered = 0`,
            messageIds
          );

          for (const msg of offlineMessages) {
            socket.emit('receive-message', {
              id: msg.id,
              sender: msg.sender,
              recipient: msg.recipient,
              ciphertext: msg.ciphertext,
              iv: msg.iv,
              signature: msg.signature,
              delivered: 1,
              timestamp: msg.timestamp
            });
          }

          const senders = [...new Set(offlineMessages.map(m => m.sender))];
          for (const sender of senders) {
            io.to(sender.toLowerCase()).emit('messages-delivered', { recipient: username });
          }
        }
      } catch (error) {
        logger.error('Error delivering offline messages:', error);
      }
    };
    deliverOfflineMessages();

    // Handle online status check with profile info
    socket.on('get-user-status', async (targetUsername, callback) => {
      try {
        if (!targetUsername || typeof targetUsername !== 'string' || targetUsername.length > 50) {
          if (typeof callback === 'function') callback({ error: 'Invalid username' });
          return;
        }
        const requester = socket.user.username;

        // If target has blocked requester, hide online status and profile
        const isBlockedByTarget = await dbGet(
          'SELECT 1 FROM blocked_users WHERE LOWER(username) = LOWER(?) AND LOWER(blocked_username) = LOWER(?)',
          [targetUsername, requester]
        );

        if (isBlockedByTarget) {
          if (typeof callback === 'function') {
            callback({
              username: targetUsername,
              status: 'offline',
              displayName: null,
              avatarIcon: null,
              themeColor: null
            });
          }
          return;
        }

        const isOnline = isUserOnline(targetUsername);
        const user = await dbGet('SELECT display_name, avatar_icon, theme_color FROM users WHERE LOWER(username) = LOWER(?)', [targetUsername]);
        if (typeof callback === 'function') {
          callback({ 
            username: targetUsername, 
            status: isOnline ? 'online' : 'offline',
            displayName: user ? user.display_name : null,
            avatarIcon: user ? user.avatar_icon : null,
            themeColor: user ? user.theme_color : null
          });
        }
      } catch (err) {
        logger.error('Error fetching user status profile info:', err);
        if (typeof callback === 'function') {
          callback({ username: targetUsername, status: isUserOnline(targetUsername) ? 'online' : 'offline' });
        }
      }
    });

    // Handle profile updates (display name, avatar icon color/emoji)
    socket.on('update-profile', async (data, callback) => {
      try {
        const { displayName, avatarIcon, themeColor } = data || {};
        const username = socket.user.username;

        // Security payload validation
        if (displayName && (typeof displayName !== 'string' || displayName.length > 50)) {
          if (typeof callback === 'function') callback({ error: 'Invalid display name' });
          return;
        }
        if (avatarIcon && (typeof avatarIcon !== 'string' || avatarIcon.length > 1024 * 1024)) {
          if (typeof callback === 'function') callback({ error: 'Avatar payload exceeds 1MB limit' });
          return;
        }
        if (themeColor && (typeof themeColor !== 'string' || themeColor.length > 50)) {
          if (typeof callback === 'function') callback({ error: 'Invalid theme color' });
          return;
        }

        await dbRun(
          'UPDATE users SET display_name = ?, avatar_icon = ?, theme_color = ? WHERE LOWER(username) = LOWER(?)',
          [displayName || null, avatarIcon || null, themeColor || null, username]
        );

        if (typeof callback === 'function') callback({ success: true });

        socket.broadcast.emit('user-profile-updated', {
          username,
          displayName: displayName || null,
          avatarIcon: avatarIcon || null,
          themeColor: themeColor || null
        });
      } catch (err) {
        logger.error('Error updating user profile:', err);
        if (typeof callback === 'function') callback({ error: 'Failed to update profile' });
      }
    });

    // Per-socket message anti-spam rate limiter (sliding window: max 5 messages per 2 seconds)
    const msgTimestamps = [];
    const MAX_MSG_BURST = 5;
    const MSG_WINDOW_MS = 2000;

    // Handle real-time messaging
    socket.on('send-message', async (data, callback) => {
      try {
        const { recipient, ciphertext, iv, signature } = data || {};
        const sender = socket.user.username;

        // Anti-bot message frequency check
        const now = Date.now();
        while (msgTimestamps.length > 0 && now - msgTimestamps[0] > MSG_WINDOW_MS) {
          msgTimestamps.shift();
        }

        if (msgTimestamps.length >= MAX_MSG_BURST) {
          if (typeof callback === 'function') {
            callback({ error: 'You are sending messages too fast. Please slow down.' });
          }
          return;
        }

        if (
          !recipient || typeof recipient !== 'string' || recipient.length > 50 ||
          !ciphertext || typeof ciphertext !== 'string' || ciphertext.length > 500000 ||
          !iv || typeof iv !== 'string' || iv.length > 100 ||
          !signature || typeof signature !== 'string' || signature.length > 1000
        ) {
          if (typeof callback === 'function') callback({ error: 'Invalid message payload' });
          return;
        }

        msgTimestamps.push(now);

        // Check if sender has blocked recipient
        const senderBlocked = await dbGet(
          'SELECT 1 FROM blocked_users WHERE LOWER(username) = LOWER(?) AND LOWER(blocked_username) = LOWER(?)',
          [sender, recipient]
        );
        if (senderBlocked) {
          if (typeof callback === 'function') {
            callback({ error: 'You have blocked this user. Unblock to send messages.' });
          }
          return;
        }

        // Check if recipient has blocked sender
        const isBlocked = await dbGet(
          'SELECT 1 FROM blocked_users WHERE LOWER(username) = LOWER(?) AND LOWER(blocked_username) = LOWER(?)',
          [recipient, sender]
        );
        if (isBlocked) {
          // Store the message with delivered = -1 so it stays permanently in sender's history on refresh,
          // but is NEVER delivered or visible to recipient!
          const result = await dbRun(
            `INSERT INTO messages (sender, recipient, ciphertext, iv, signature, delivered)
             VALUES (?, ?, ?, ?, ?, -1)`,
            [sender, recipient, ciphertext, iv, signature]
          );
          if (typeof callback === 'function') {
            callback({ success: true, messageId: result.id, status: 0, timestamp: new Date().toISOString() });
          }
          return;
        }

        const isOnline = isUserOnline(recipient);
        const status = isOnline ? 1 : 0; // 0 = sent, 1 = delivered

        const result = await dbRun(
          `INSERT INTO messages (sender, recipient, ciphertext, iv, signature, delivered)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [sender, recipient, ciphertext, iv, signature, status]
        );

        const messageId = result.id;
        const msgPayload = {
          id: messageId,
          sender,
          recipient,
          ciphertext,
          iv,
          signature,
          delivered: status,
          timestamp: new Date().toISOString()
        };

        if (isOnline) {
          io.to(recipient.toLowerCase()).emit('receive-message', msgPayload);
        }

        if (typeof callback === 'function') {
          callback({ success: true, messageId, timestamp: msgPayload.timestamp, status });
        }
      } catch (error) {
        logger.error('Error sending message:', error);
        if (typeof callback === 'function') callback({ error: 'Failed to send message' });
      }
    });

    socket.on('delete-messages', async (data, callback) => {
      try {
        const ids = Array.isArray(data?.messageIds)
          ? data.messageIds.map(Number).filter(Number.isInteger).slice(0, 100)
          : [];
        if (!ids.length) return callback?.({ error: 'No messages selected' });
        const placeholders = ids.map(() => '?').join(',');
        const rows = await dbAll(
          `SELECT id, sender, recipient FROM messages WHERE id IN (${placeholders})`, ids
        );

        const sentByUser = rows.filter(row => row.sender.toLowerCase() === username.toLowerCase());
        const receivedByUser = rows.filter(row => row.recipient.toLowerCase() === username.toLowerCase());

        // 1) Messages sent by current user: Delete for everyone from server DB
        if (sentByUser.length) {
          const sentIds = sentByUser.map(row => row.id);
          const sentPlaceholders = sentIds.map(() => '?').join(',');
          await dbRun(`DELETE FROM messages WHERE id IN (${sentPlaceholders})`, sentIds);
          await dbRun(`DELETE FROM deleted_messages_user WHERE message_id IN (${sentPlaceholders})`, sentIds);
          
          const participants = [...new Set(sentByUser.flatMap(row => [row.sender, row.recipient]))];
          participants.forEach(participant => io.to(participant.toLowerCase()).emit('messages-deleted', { messageIds: sentIds }));
        }

        // 2) Messages received by current user: Hide for current user ("delete for me")
        if (receivedByUser.length) {
          for (const msg of receivedByUser) {
            await dbRun(
              `INSERT OR IGNORE INTO deleted_messages_user (message_id, username) VALUES (?, ?)`,
              [msg.id, username.toLowerCase()]
            );
          }
        }

        callback?.({ success: true });
      } catch (error) {
        logger.error('Error deleting messages:', error);
        callback?.({ error: 'Failed to delete messages' });
      }
    });

    // Delete entire conversation between current user and partner
    socket.on('delete-chat', async (data, callback) => {
      try {
        const { withUser } = data || {};
        if (!withUser || typeof withUser !== 'string') return callback?.({ error: 'withUser is required' });
        const username = socket.user.username;

        // 1. Hide all messages received from withUser
        const received = await dbAll(
          'SELECT id FROM messages WHERE LOWER(sender) = LOWER(?) AND LOWER(recipient) = LOWER(?)',
          [withUser, username]
        );
        for (const row of received) {
          await dbRun(
            'INSERT OR IGNORE INTO deleted_messages_user (message_id, username) VALUES (?, ?)',
            [row.id, username.toLowerCase()]
          );
        }

        // 2. Delete all messages sent by current user to withUser
        const sent = await dbAll(
          'SELECT id FROM messages WHERE LOWER(sender) = LOWER(?) AND LOWER(recipient) = LOWER(?)',
          [username, withUser]
        );
        if (sent.length) {
          const sentIds = sent.map(r => r.id);
          const placeholders = sentIds.map(() => '?').join(',');
          await dbRun(`DELETE FROM messages WHERE id IN (${placeholders})`, sentIds);
          await dbRun(`DELETE FROM deleted_messages_user WHERE message_id IN (${placeholders})`, sentIds);
          io.to(withUser.toLowerCase()).emit('messages-deleted', { messageIds: sentIds });
        }

        callback?.({ success: true });
      } catch (error) {
        logger.error('Error deleting chat:', error);
        callback?.({ error: 'Failed to delete chat' });
      }
    });

    // Block user
    socket.on('block-user', async (data, callback) => {
      try {
        const { targetUsername } = data || {};
        if (!targetUsername || typeof targetUsername !== 'string') return callback?.({ error: 'targetUsername is required' });
        const username = socket.user.username;

        await dbRun(
          'INSERT OR IGNORE INTO blocked_users (username, blocked_username) VALUES (?, ?)',
          [username.toLowerCase(), targetUsername.toLowerCase()]
        );

        // Tell target user immediately that this user is offline
        if (isUserOnline(targetUsername)) {
          io.to(targetUsername.toLowerCase()).emit('user-status', { username, status: 'offline' });
        }

        callback?.({ success: true });
      } catch (error) {
        logger.error('Error blocking user:', error);
        callback?.({ error: 'Failed to block user' });
      }
    });

    // Unblock user
    socket.on('unblock-user', async (data, callback) => {
      try {
        const { targetUsername } = data || {};
        if (!targetUsername || typeof targetUsername !== 'string') return callback?.({ error: 'targetUsername is required' });
        const username = socket.user.username;

        await dbRun(
          'DELETE FROM blocked_users WHERE LOWER(username) = LOWER(?) AND LOWER(blocked_username) = LOWER(?)',
          [username.toLowerCase(), targetUsername.toLowerCase()]
        );

        // If both users are online, notify each other of online status
        if (isUserOnline(targetUsername) && isUserOnline(username)) {
          io.to(targetUsername.toLowerCase()).emit('user-status', { username, status: 'online' });
          io.to(username.toLowerCase()).emit('user-status', { username: targetUsername, status: 'online' });
        }

        callback?.({ success: true });
      } catch (error) {
        logger.error('Error unblocking user:', error);
        callback?.({ error: 'Failed to unblock user' });
      }
    });

    // Get blocked users list
    socket.on('get-blocked-users', async (_, callback) => {
      try {
        const username = socket.user.username;
        const rows = await dbAll(
          'SELECT blocked_username FROM blocked_users WHERE LOWER(username) = LOWER(?)',
          [username]
        );
        callback?.({ success: true, blockedUsers: rows.map(r => r.blocked_username) });
      } catch (error) {
        logger.error('Error fetching blocked users:', error);
        callback?.({ error: 'Failed to fetch blocked users' });
      }
    });

    // Fetch all conversation partners (contacts) for the authenticated user
    socket.on('get-contacts', async (_, callback) => {
      try {
        const username = socket.user.username;

        // Find all blocked relationships for this user
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

        // Get all unique usernames who have exchanged messages with this user and are not hidden/deleted
        const rows = await dbAll(`
          SELECT DISTINCT
            CASE
              WHEN LOWER(m.sender) = LOWER(?) THEN m.recipient
              ELSE m.sender
            END AS contact_username
          FROM messages m
          LEFT JOIN deleted_messages_user d ON m.id = d.message_id AND LOWER(d.username) = LOWER(?)
          WHERE d.message_id IS NULL
            AND (LOWER(m.sender) = LOWER(?) OR LOWER(m.recipient) = LOWER(?))
        `, [username, username, username, username]);

        const contactUsernames = rows
          .map(r => r.contact_username)
          .filter(u => u && !blockedSet.has(u.toLowerCase()));

        // Fetch full profile for each contact
        const contactDetails = [];
        for (const contactUsername of contactUsernames) {
          try {
            const user = await dbGet(
              'SELECT username, display_name, avatar_icon, theme_color, public_identity_key, public_signing_key FROM users WHERE LOWER(username) = LOWER(?)',
              [contactUsername]
            );
            if (user) {
              const isOnline = isUserOnline(user.username) && !blockedSet.has(user.username.toLowerCase());
              contactDetails.push({
                username: user.username,
                displayName: user.display_name || null,
                avatarIcon: user.avatar_icon || null,
                themeColor: user.theme_color || null,
                publicIdentityKey: user.public_identity_key ? JSON.parse(user.public_identity_key) : null,
                publicSigningKey: user.public_signing_key ? JSON.parse(user.public_signing_key) : null,
                status: isOnline ? 'online' : 'offline'
              });
            }
          } catch (e) {
            logger.warn(`Failed to fetch profile for contact ${contactUsername}:`, e);
          }
        }

        if (typeof callback === 'function') {
          callback({ success: true, contacts: contactDetails });
        }
      } catch (error) {
        logger.error('Error fetching contacts:', error);
        if (typeof callback === 'function') callback({ error: 'Failed to fetch contacts' });
      }
    });

    // Fetch conversation history (with optional pagination support)
    socket.on('get-chat-history', async (data, callback) => {
      try {
        const { withUser, limit, beforeId } = data || {};
        const currentUser = socket.user.username;

        if (!withUser || typeof withUser !== 'string' || withUser.length > 50) {
          if (typeof callback === 'function') callback({ error: 'withUser parameter is required and must be valid' });
          return;
        }

        let query = `
          SELECT m.id, m.sender, m.recipient, m.ciphertext, m.iv, m.signature, m.timestamp, m.delivered
          FROM messages m
          LEFT JOIN deleted_messages_user d 
            ON m.id = d.message_id AND LOWER(d.username) = LOWER(?)
          WHERE d.message_id IS NULL
            AND ((LOWER(m.sender) = LOWER(?) AND LOWER(m.recipient) = LOWER(?))
              OR (LOWER(m.sender) = LOWER(?) AND LOWER(m.recipient) = LOWER(?)))
            AND NOT (LOWER(m.recipient) = LOWER(?) AND m.delivered = -1)
        `;
        const params = [currentUser, currentUser, withUser, withUser, currentUser, currentUser];

        if (beforeId) {
          query += ` AND id < ?`;
          params.push(beforeId);
        }

        query += ` ORDER BY timestamp ASC, id ASC`;

        const parsedLimit = parseInt(limit, 10);
        const safeLimit = (!isNaN(parsedLimit) && parsedLimit > 0) ? Math.min(parsedLimit, 500) : 500;
        query += ` LIMIT ?`;
        params.push(safeLimit);

        const messages = await dbAll(query, params);

        const formattedMessages = (messages || []).map(m => {
          let ts = m.timestamp;
          if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(ts)) {
            ts = ts.replace(' ', 'T') + 'Z';
          }
          return {
            ...m,
            timestamp: ts
          };
        });

        if (typeof callback === 'function') {
          callback({ success: true, messages: formattedMessages });
        }
      } catch (error) {
        logger.error('Error fetching chat history:', error);
        if (typeof callback === 'function') callback({ error: 'Failed to fetch chat history' });
      }
    });

    // Mark messages as read (status 2) and notify sender
    socket.on('mark-as-read', async (data) => {
      try {
        const { sender } = data || {};
        const recipient = socket.user.username;

        if (!sender) return;

        await dbRun(
          `UPDATE messages SET delivered = 2
           WHERE LOWER(sender) = LOWER(?) AND LOWER(recipient) = LOWER(?) AND delivered < 2`,
          [sender, recipient]
        );
        
        io.to(sender.toLowerCase()).emit('messages-read', { reader: recipient });
      } catch (error) {
        logger.error('Error updating read status:', error);
      }
    });

    // WebRTC Signaling Handlers (Voice/Video)
    socket.on('call-user', async (data) => {
      try {
        const { to, offer, mediaType } = data || {};
        const from = socket.user.username;

        if (!to || typeof to !== 'string' || !offer) return;

        // Check if either user has blocked the other
        const isBlocked = await dbGet(
          'SELECT 1 FROM blocked_users WHERE (LOWER(username) = LOWER(?) AND LOWER(blocked_username) = LOWER(?)) OR (LOWER(username) = LOWER(?) AND LOWER(blocked_username) = LOWER(?))',
          [to, from, from, to]
        );
        if (isBlocked) {
          socket.emit('call-ended', { from: to, reason: 'user_unavailable' });
          return;
        }

        activeCalls.set(from.toLowerCase(), {
          caller: from,
          recipient: to,
          mediaType,
          offer,
          status: 'calling',
          timestamp: Date.now()
        });

        if (isUserOnline(to)) {
          io.to(to.toLowerCase()).emit('call-made', {
            offer,
            from,
            mediaType
          });
          const session = activeCalls.get(from.toLowerCase());
          if (session) {
            session.status = 'ringing';
          }
          socket.emit('call-ringing', { from: to });
        }
      } catch (err) {
        logger.error('Error in call-user event:', err);
      }
    });

    socket.on('make-answer', (data) => {
      try {
        const { to, answer } = data || {};
        const from = socket.user.username;

        if (!to || !answer) return;

        const session = activeCalls.get(to.toLowerCase());
        if (session) {
          session.status = 'connected';
        }

        if (isUserOnline(to)) {
          io.to(to.toLowerCase()).emit('answer-made', {
            answer,
            from
          });
        }
      } catch (err) {
        logger.error('Error in make-answer event:', err);
      }
    });

    socket.on('ice-candidate', (data) => {
      try {
        const { to, candidate } = data || {};
        const from = socket.user.username;

        if (!to || !candidate) return;

        if (isUserOnline(to)) {
          io.to(to.toLowerCase()).emit('ice-candidate-relay', {
            candidate,
            from
          });
        }
      } catch (err) {
        logger.error('Error in ice-candidate event:', err);
      }
    });

    socket.on('call-media-update', (data) => {
      try {
        const { to, mediaType, screenSharing, cameraOff, muted } = data || {};
        const from = socket.user.username;

        if (!to) return;

        if (isUserOnline(to)) {
          io.to(to.toLowerCase()).emit('call-media-updated', { 
            from, 
            mediaType, 
            screenSharing, 
            cameraOff, 
            muted 
          });
        }
      } catch (err) {
        logger.error('Error in call-media-update event:', err);
      }
    });

    socket.on('hang-up', (data) => {
      try {
        const { to, reason } = data || {};
        const from = socket.user.username;

        activeCalls.delete(from.toLowerCase());
        if (to) {
          activeCalls.delete(to.toLowerCase());
        }

        if (to && isUserOnline(to)) {
          io.to(to.toLowerCase()).emit('call-ended', { from, reason });
        }
      } catch (err) {
        logger.error('Error in hang-up event:', err);
      }
    });

    socket.on('typing', async (data) => {
      try {
        const { recipient, isTyping } = data || {};
        const sender = socket.user.username;

        if (recipient && typeof recipient === 'string' && recipient.length <= 50 && isUserOnline(recipient)) {
          // Check if either user has blocked the other
          const isBlocked = await dbGet(
            'SELECT 1 FROM blocked_users WHERE (LOWER(username) = LOWER(?) AND LOWER(blocked_username) = LOWER(?)) OR (LOWER(username) = LOWER(?) AND LOWER(blocked_username) = LOWER(?))',
            [recipient, sender, sender, recipient]
          );
          if (!isBlocked) {
            io.to(recipient.toLowerCase()).emit('user-typing', { username: sender, isTyping: Boolean(isTyping) });
          }
        }
      } catch (err) {
        logger.error('Error in typing event:', err);
      }
    });

    // ==========================================
    // E2EE Group Chat handlers (see groupHandler.js)
    // ==========================================
    registerGroupHandlers(socket, io, { isUserOnline });

    socket.on('disconnect', () => {
      clearInterval(resetTimer);
      logger.info(`User disconnected: ${username} (Socket ID: ${socket.id})`);
      
      for (const [callerKey, session] of activeCalls.entries()) {
        if (session.caller.toLowerCase() === username.toLowerCase() || session.recipient.toLowerCase() === username.toLowerCase()) {
          const partner = session.caller.toLowerCase() === username.toLowerCase() ? session.recipient : session.caller;
          activeCalls.delete(callerKey);
          if (isUserOnline(partner)) {
            io.to(partner.toLowerCase()).emit('call-ended', { from: username });
          }
        }
      }

      const wentOffline = removeUserSocket(username, socket.id);
      if (wentOffline) {
        broadcastUserStatus(io, username, 'offline');
      }
    });
  });
};
