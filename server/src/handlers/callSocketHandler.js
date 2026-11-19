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

// Helper: find an active call session involving both userA and userB
const findActiveCallBetween = (userA, userB) => {
  if (!userA || !userB) return null;
  const a = userA.toLowerCase();
  const b = userB.toLowerCase();
  const direct = activeCalls.get(a);
  if (direct && direct.recipient.toLowerCase() === b) {
    return { key: a, session: direct };
  }
  const reverse = activeCalls.get(b);
  if (reverse && reverse.recipient.toLowerCase() === a) {
    return { key: b, session: reverse };
  }
  return null;
};

export const registerCallHandlers = (socket, io, { isUserOnline }) => {
  const username = socket.user.username;

  // WebRTC Signaling Handlers (Voice/Video)
  socket.on('call-user', async (data) => {
    try {
      const { to, offer, mediaType } = data || {};
      const from = socket.user.username;

      if (!to || typeof to !== 'string' || to.length > 50 || !offer) return;
      if (to.toLowerCase() === from.toLowerCase()) return;

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

      if (!to || typeof to !== 'string' || to.length > 50 || !answer) return;

      // Only the intended callee of an active call from `to` may answer
      const session = activeCalls.get(to.toLowerCase());
      if (!session || session.recipient.toLowerCase() !== from.toLowerCase()) return;

      session.status = 'connected';

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

      if (!to || typeof to !== 'string' || to.length > 50 || !candidate) return;

      // Only relay ICE candidates between participants of an active call
      if (!findActiveCallBetween(from, to)) return;

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

      if (!to || typeof to !== 'string' || to.length > 50) return;

      // Only relay media state updates between participants of an active call
      if (!findActiveCallBetween(from, to)) return;

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

      if (to && typeof to === 'string' && to.length <= 50) {
        // Only allow hanging up an active call that actually involves both `from` and `to`
        const active = findActiveCallBetween(from, to);
        if (!active) return;

        activeCalls.delete(active.key);
        if (isUserOnline(to)) {
          io.to(to.toLowerCase()).emit('call-ended', { from, reason });
        }
      } else {
        // Fallback: hang up any call initiated by `from`
        const ownCall = activeCalls.get(from.toLowerCase());
        if (ownCall) {
          activeCalls.delete(from.toLowerCase());
          if (isUserOnline(ownCall.recipient)) {
            io.to(ownCall.recipient.toLowerCase()).emit('call-ended', { from, reason });
          }
        }
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
