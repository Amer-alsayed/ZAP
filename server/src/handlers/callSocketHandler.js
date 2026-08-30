import { dbGet } from '../db.js';
import logger from '../logger.js';

// Map to track active call sessions: callerUsername (lowercase) -> session details
export const activeCalls = new Map();

// Call session TTL (expire stale calling sessions older than 2 minutes)
const CALL_SESSION_TTL_MS = 2 * 60 * 1000;

// Periodic cleanup interval for stale call sessions (unref'd to avoid blocking process shutdown)
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

export const registerCallHandlers = (socket, io, { isUserOnline }) => {
  const username = socket.user.username;

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
};

export const handleCallDisconnect = (username, io, isUserOnline) => {
  for (const [callerKey, session] of activeCalls.entries()) {
    if (session.caller.toLowerCase() === username.toLowerCase() || session.recipient.toLowerCase() === username.toLowerCase()) {
      const partner = session.caller.toLowerCase() === username.toLowerCase() ? session.recipient : session.caller;
      activeCalls.delete(callerKey);
      if (isUserOnline(partner)) {
        io.to(partner.toLowerCase()).emit('call-ended', { from: username });
      }
    }
  }
};
