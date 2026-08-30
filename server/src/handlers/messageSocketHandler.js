import { dbRun, dbAll, dbGet } from '../db.js';
import logger from '../logger.js';

export const deliverOfflineMessages = async (socket, io, username) => {
  try {
    const offlineMessages = await dbAll(
      `SELECT m.id, m.sender, m.recipient, m.ciphertext, m.iv, m.signature, m.aad, m.auth_tag, m.timestamp, m.delivered
       FROM messages m
       LEFT JOIN deleted_messages_user d ON m.id = d.message_id AND LOWER(d.username) = LOWER(?)
       WHERE LOWER(m.recipient) = LOWER(?) AND m.delivered = 0 AND d.message_id IS NULL
       ORDER BY m.timestamp ASC`,
      [username, username]
    );

    if (offlineMessages.length > 0) {
      logger.info(`Delivering ${offlineMessages.length} offline messages to: ${username}`);
      
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
          aad: msg.aad || null,
          authTag: msg.auth_tag || null,
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

export const registerMessageHandlers = (socket, io, { isUserOnline }) => {
  const username = socket.user.username;
  const msgTimestamps = [];
  const MAX_MSG_BURST = 5;
  const MSG_WINDOW_MS = 2000;

  // Handle real-time messaging
  socket.on('send-message', async (data, callback) => {
    try {
      const { recipient, ciphertext, iv, signature, aad, authTag } = data || {};
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

      const safeAad = (aad && typeof aad === 'string' && aad.length < 5000) ? aad : null;
      const safeAuthTag = (authTag && typeof authTag === 'string' && authTag.length < 500) ? authTag : null;

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
        const result = await dbRun(
          `INSERT INTO messages (sender, recipient, ciphertext, iv, signature, aad, auth_tag, delivered)
           VALUES (?, ?, ?, ?, ?, ?, ?, -1)`,
          [sender, recipient, ciphertext, iv, signature, safeAad, safeAuthTag]
        );
        if (typeof callback === 'function') {
          callback({ success: true, messageId: result.id, status: 0, timestamp: new Date().toISOString() });
        }
        return;
      }

      const isOnline = isUserOnline(recipient);
      const status = isOnline ? 1 : 0; // 0 = sent, 1 = delivered

      const result = await dbRun(
        `INSERT INTO messages (sender, recipient, ciphertext, iv, signature, aad, auth_tag, delivered)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [sender, recipient, ciphertext, iv, signature, safeAad, safeAuthTag, status]
      );

      const messageId = result.id;
      const msgPayload = {
        id: messageId,
        sender,
        recipient,
        ciphertext,
        iv,
        signature,
        aad: safeAad,
        authTag: safeAuthTag,
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
        SELECT m.id, m.sender, m.recipient, m.ciphertext, m.iv, m.signature, m.aad, m.auth_tag, m.timestamp, m.delivered
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
          id: m.id,
          sender: m.sender,
          recipient: m.recipient,
          ciphertext: m.ciphertext,
          iv: m.iv,
          signature: m.signature,
          aad: m.aad || null,
          authTag: m.auth_tag || null,
          delivered: m.delivered,
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

  // Typing indicator
  socket.on('typing', async (data) => {
    try {
      const { recipient, isTyping } = data || {};
      const sender = socket.user.username;

      if (recipient && typeof recipient === 'string' && recipient.length <= 50 && isUserOnline(recipient)) {
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
};
