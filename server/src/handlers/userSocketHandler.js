import { dbRun, dbAll, dbGet } from '../db.js';
import logger from '../logger.js';

export const registerUserHandlers = (socket, io, { isUserOnline }) => {
  const username = socket.user.username;

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
      const user = socket.user.username;

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
        [displayName || null, avatarIcon || null, themeColor || null, user]
      );

      if (typeof callback === 'function') callback({ success: true });

      socket.broadcast.emit('user-profile-updated', {
        username: user,
        displayName: displayName || null,
        avatarIcon: avatarIcon || null,
        themeColor: themeColor || null
      });
    } catch (err) {
      logger.error('Error updating user profile:', err);
      if (typeof callback === 'function') callback({ error: 'Failed to update profile' });
    }
  });

  // Block user
  socket.on('block-user', async (data, callback) => {
    try {
      const { targetUsername } = data || {};
      if (!targetUsername || typeof targetUsername !== 'string') return callback?.({ error: 'targetUsername is required' });

      await dbRun(
        'INSERT OR IGNORE INTO blocked_users (username, blocked_username) VALUES (?, ?)',
        [username.toLowerCase(), targetUsername.toLowerCase()]
      );

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

      await dbRun(
        'DELETE FROM blocked_users WHERE LOWER(username) = LOWER(?) AND LOWER(blocked_username) = LOWER(?)',
        [username.toLowerCase(), targetUsername.toLowerCase()]
      );

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

      const contactDetails = [];
      for (const contactUsername of contactUsernames) {
        try {
          const user = await dbGet(
            'SELECT username, display_name, avatar_icon, theme_color, public_identity_key, public_signing_key FROM users WHERE LOWER(username) = LOWER(?)',
            [contactUsername]
          );
          if (user) {
            const isOnline = isUserOnline(user.username) && !blockedSet.has(user.username.toLowerCase());
            const unreadRow = await dbGet(`
              SELECT COUNT(*) AS unread_count
              FROM messages m
              LEFT JOIN deleted_messages_user d ON m.id = d.message_id AND LOWER(d.username) = LOWER(?)
              WHERE d.message_id IS NULL
                AND LOWER(m.sender) = LOWER(?)
                AND LOWER(m.recipient) = LOWER(?)
                AND m.delivered < 2
            `, [username, contactUsername, username]);
            const unreadCount = unreadRow ? (unreadRow.unread_count || 0) : 0;

            contactDetails.push({
              username: user.username,
              displayName: user.display_name || null,
              avatarIcon: user.avatar_icon || null,
              themeColor: user.theme_color || null,
              publicIdentityKey: user.public_identity_key ? JSON.parse(user.public_identity_key) : null,
              publicSigningKey: user.public_signing_key ? JSON.parse(user.public_signing_key) : null,
              status: isOnline ? 'online' : 'offline',
              unreadCount
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
};
