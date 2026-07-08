// Triggering nodemon reload
import jwt from 'jsonwebtoken';
import { dbRun, dbAll, dbGet } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secure-chatra-secret-key-12345';

// Map to track active sockets by username: username (lowercase) -> Set(socketId)
const onlineUsers = new Map();

// Map to track active call sessions: callerUsername (lowercase) -> session details
const activeCalls = new Map();

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

export const socketHandler = (io) => {
  // Socket.io JWT Authentication Middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication error: Token missing'));
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      
      // Verify user exists in database (prevents session mismatch after database resets)
      const userExists = await dbGet('SELECT 1 FROM users WHERE LOWER(username) = LOWER(?)', [decoded.username]);
      if (!userExists) {
        console.error(`Socket authentication failed: User "${decoded.username}" not found in database (database reset).`);
        return next(new Error('Authentication error: User not found (database reset)'));
      }

      socket.user = decoded; // Contains id and username
      next();
    } catch (err) {
      console.error('Socket authentication failed:', err.message);
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const username = socket.user.username;
    console.log(`User connected: ${username} (Socket ID: ${socket.id})`);
    
    // Track online user socket
    const wentOnline = addUserSocket(username, socket.id);
    socket.join(username.toLowerCase()); // Case-insensitive room name subscription

    // Broadcast online status to others only if they just connected their first tab
    if (wentOnline) {
      socket.broadcast.emit('user-status', { username, status: 'online' });
    }

    // Check if there is a pending call session for this newly connected user
    for (const [callerKey, session] of activeCalls.entries()) {
      console.log(`[CALL DEBUG] Checking pending session: callerKey=${callerKey}, caller=${session.caller}, recipient=${session.recipient}, status=${session.status}, newly connected user=${username}`);
      if (session.recipient.toLowerCase() === username.toLowerCase() && session.status !== 'connected') {
        console.log(`[CALL DEBUG] Matching pending session found! Relaying call offer to recipient: ${username}`);
        // Relay call offer to newly connected recipient
        socket.emit('call-made', {
          offer: session.offer,
          from: session.caller,
          mediaType: session.mediaType
        });
        session.status = 'ringing';
        // Notify the caller that the call is now ringing!
        console.log(`[CALL DEBUG] Emitting call-ringing to caller room: ${session.caller.toLowerCase()}`);
        io.to(session.caller.toLowerCase()).emit('call-ringing', { from: username });
      }
    }

    // Automatically retrieve Bob's offline messages, deliver them, and notify senders
    const deliverOfflineMessages = async () => {
      try {
        // 1. Fetch all pending offline messages
        const offlineMessages = await dbAll(
          `SELECT id, sender, recipient, ciphertext, iv, signature, timestamp, delivered
           FROM messages
           WHERE LOWER(recipient) = LOWER(?) AND delivered = 0
           ORDER BY timestamp ASC`,
          [username]
        );

        if (offlineMessages.length > 0) {
          console.log(`[OFFLINE MESSAGES] Delivering ${offlineMessages.length} offline messages to: ${username}`);
          
          // 2. Emit each offline message to the user's socket
          for (const msg of offlineMessages) {
            socket.emit('receive-message', {
              id: msg.id,
              sender: msg.sender,
              recipient: msg.recipient,
              ciphertext: msg.ciphertext,
              iv: msg.iv,
              signature: msg.signature,
              delivered: 1, // marked as delivered
              timestamp: msg.timestamp
            });
          }

          // 3. Find unique senders to update status and notify them
          const senders = [...new Set(offlineMessages.map(m => m.sender))];
          for (const sender of senders) {
            // Update DB: 1 = delivered
            await dbRun(
              `UPDATE messages SET delivered = 1
               WHERE LOWER(sender) = LOWER(?) AND LOWER(recipient) = LOWER(?) AND delivered = 0`,
              [sender, username]
            );
            // Notify sender
            io.to(sender.toLowerCase()).emit('messages-delivered', { recipient: username });
          }
        }
      } catch (error) {
        console.error('Error delivering offline messages:', error);
      }
    };
    deliverOfflineMessages();

    // Handle online status check with profile info
    socket.on('get-user-status', async (targetUsername, callback) => {
      const isOnline = isUserOnline(targetUsername);
      try {
        const user = await dbGet('SELECT display_name, avatar_icon FROM users WHERE LOWER(username) = LOWER(?)', [targetUsername]);
        callback({ 
          username: targetUsername, 
          status: isOnline ? 'online' : 'offline',
          displayName: user ? user.display_name : null,
          avatarIcon: user ? user.avatar_icon : null
        });
      } catch (err) {
        console.error('Error fetching user status profile info:', err);
        callback({ username: targetUsername, status: isOnline ? 'online' : 'offline' });
      }
    });

    // Handle profile updates (display name, avatar icon color/emoji)
    socket.on('update-profile', async (data, callback) => {
      const { displayName, avatarIcon } = data;
      const username = socket.user.username;

      try {
        await dbRun(
          'UPDATE users SET display_name = ?, avatar_icon = ? WHERE LOWER(username) = LOWER(?)',
          [displayName || null, avatarIcon || null, username]
        );

        if (callback) callback({ success: true });

        // Broadcast profile change in real-time to all online users
        socket.broadcast.emit('user-profile-updated', {
          username,
          displayName: displayName || null,
          avatarIcon: avatarIcon || null
        });
      } catch (err) {
        console.error('Error updating user profile:', err);
        if (callback) callback({ error: 'Failed to update profile' });
      }
    });

    // Handle real-time messaging
    socket.on('send-message', async (data, callback) => {
      const { recipient, ciphertext, iv, signature } = data;
      const sender = socket.user.username;

      if (!recipient || !ciphertext || !iv || !signature) {
        return callback({ error: 'Invalid message payload' });
      }

      try {
        const isOnline = isUserOnline(recipient);
        const status = isOnline ? 1 : 0; // 0 = sent, 1 = delivered

        // Save encrypted message to database
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
          delivered: status, // include status in websocket payload
          timestamp: new Date().toISOString()
        };

        // If recipient is online, deliver immediately (route using lowercase username room name)
        if (isOnline) {
          io.to(recipient.toLowerCase()).emit('receive-message', msgPayload);
        }

        // Acknowledge receipt to the sender with status
        callback({ success: true, messageId, timestamp: msgPayload.timestamp, status });
      } catch (error) {
        console.error('Error sending message:', error);
        callback({ error: 'Failed to send message' });
      }
    });

    // Fetch conversation history
    socket.on('get-chat-history', async (data, callback) => {
      const { withUser } = data;
      const currentUser = socket.user.username;

      if (!withUser) {
        return callback({ error: 'withUser parameter is required' });
      }

      try {
        const messages = await dbAll(
          `SELECT id, sender, recipient, ciphertext, iv, signature, timestamp, delivered
           FROM messages
           WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)
           ORDER BY timestamp ASC`,
          [currentUser, withUser, withUser, currentUser]
        );

        callback({ success: true, messages });
      } catch (error) {
        console.error('Error fetching chat history:', error);
        callback({ error: 'Failed to fetch chat history' });
      }
    });

    // Mark messages as read (status 2) and notify sender
    socket.on('mark-as-read', async (data) => {
      const { sender } = data;
      const recipient = socket.user.username;

      if (!sender) return;

      try {
        // Update DB: 2 = read
        await dbRun(
          `UPDATE messages SET delivered = 2
           WHERE sender = ? AND recipient = ? AND delivered < 2`,
          [sender, recipient]
        );
        // Notify the sender that the recipient read their messages
        io.to(sender.toLowerCase()).emit('messages-read', { reader: recipient });
      } catch (error) {
        console.error('Error updating read status:', error);
      }
    });

    // ==========================================
    // WebRTC Signaling Handlers (Voice/Video)
    // ==========================================

    // Initiate Call
    socket.on('call-user', (data) => {
      const { to, offer, mediaType } = data;
      const from = socket.user.username;

      // Save call session
      activeCalls.set(from.toLowerCase(), {
        caller: from,
        recipient: to,
        mediaType,
        offer,
        status: 'calling',
        timestamp: Date.now()
      });

      if (isUserOnline(to)) {
        // Recipient is online, relay call immediately and mark status as 'ringing'
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
      } else {
        // Recipient is offline. Do NOT error! Just let the call stand in 'calling' state.
        // The client will display "Calling..." until the recipient connects or caller cancels.
      }
    });

    // Answer Call
    socket.on('make-answer', (data) => {
      const { to, answer } = data;
      const from = socket.user.username;

      // Find call session where caller is 'to' and recipient is 'from'
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
    });

    // ICE Candidate relay
    socket.on('ice-candidate', (data) => {
      const { to, candidate } = data;
      const from = socket.user.username;

      if (isUserOnline(to)) {
        io.to(to.toLowerCase()).emit('ice-candidate-relay', {
          candidate,
          from
        });
      }
    });

    // Call Media Update (e.g. voice to video upgrade, screen sharing status)
    socket.on('call-media-update', (data) => {
      const { to, mediaType, screenSharing, cameraOff, muted } = data;
      const from = socket.user.username;

      if (isUserOnline(to)) {
        io.to(to.toLowerCase()).emit('call-media-updated', { 
          from, 
          mediaType, 
          screenSharing, 
          cameraOff, 
          muted 
        });
      }
    });

    // Hang up Call
    socket.on('hang-up', (data) => {
      const { to, reason } = data;
      const from = socket.user.username;

      // Remove call session
      activeCalls.delete(from.toLowerCase());
      activeCalls.delete(to.toLowerCase());

      if (isUserOnline(to)) {
        io.to(to.toLowerCase()).emit('call-ended', { from, reason });
      }
    });

    // Typing status relay
    socket.on('typing', (data) => {
      const { recipient, isTyping } = data;
      const sender = socket.user.username;

      if (isUserOnline(recipient)) {
        io.to(recipient.toLowerCase()).emit('user-typing', { username: sender, isTyping });
      }
    });

    // Client disconnected
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${username} (Socket ID: ${socket.id})`);
      
      // Clean up any call sessions involving the disconnected user
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
        socket.broadcast.emit('user-status', { username, status: 'offline' });
      }
    });
  });
};
