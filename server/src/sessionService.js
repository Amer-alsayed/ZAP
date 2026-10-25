import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { dbAll, dbGet, dbRun } from './db.js';
import config from './config.js';
import logger from './logger.js';

/**
 * Session management for ZAP.
 *
 * Model
 * -----
 * - Access token: short-lived, stateless HS256 JWT ({ id, username, sid }).
 *   Sent as `Authorization: Bearer` on HTTP and in the Socket.IO handshake.
 * - Refresh token: long-lived opaque secret bound to a row in `user_sessions`.
 *   Format: `<sessionId>.<base64url secret>`; only a SHA-256 hash is stored.
 *
 * Sessions never expire on their own (unless SESSION_IDLE_TIMEOUT_DAYS is set),
 * so users stay signed in until they explicitly sign out or the session is revoked.
 *
 * Rotation ("rotate-on-confirm")
 * ------------------------------
 * Each refresh issues a new token stored as `pending`; the previous `current`
 * token stays valid until the client proves it received the new one by using it.
 *   - presented == current -> issue a fresh pending token (replaces any older pending)
 *   - presented == pending -> promote it to current, issue a fresh pending token
 *   - anything else        -> token reuse detected -> revoke the session
 * This keeps the security benefit of rotation (stolen tokens are detected) while
 * making it impossible for a dropped network response to log a user out.
 */

export const SESSION_ERROR = Object.freeze({
  INVALID: 'SESSION_INVALID',
  REVOKED: 'SESSION_REVOKED',
  EXPIRED: 'SESSION_EXPIRED',
  CONFLICT: 'REFRESH_CONFLICT'
});

export class SessionError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'SessionError';
    this.code = code;
  }
}

const REFRESH_SECRET_BYTES = 32;
const MAX_USER_AGENT_LENGTH = 255;
const MAX_REFRESH_TOKEN_LENGTH = 256;
const SESSION_ID_PATTERN = /^[0-9a-f-]{36}$/i;

const hashSecret = (secret) => crypto.createHash('sha256').update(secret).digest('hex');

const safeEqualHex = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
};

const generateSecret = () => crypto.randomBytes(REFRESH_SECRET_BYTES).toString('base64url');

const parseRefreshToken = (token) => {
  if (typeof token !== 'string' || token.length > MAX_REFRESH_TOKEN_LENGTH) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const sessionId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!SESSION_ID_PATTERN.test(sessionId) || secret.length < 32) return null;
  return { sessionId, secret };
};

const sanitizeUserAgent = (ua) =>
  typeof ua === 'string' && ua.length > 0 ? ua.slice(0, MAX_USER_AGENT_LENGTH) : null;

const isIdleExpired = (session, now) => {
  if (!config.sessionIdleTimeoutDays) return false;
  const idleMs = config.sessionIdleTimeoutDays * 24 * 60 * 60 * 1000;
  return now - Number(session.last_used_at) > idleMs;
};

/**
 * Sign a short-lived access token bound to a session.
 */
export const signAccessToken = ({ userId, username, sessionId }) =>
  jwt.sign({ id: userId, username, sid: sessionId }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.accessTokenTtl
  });

const buildTokenResponse = ({ userId, username, sessionId, secret }) => ({
  token: signAccessToken({ userId, username, sessionId }),
  refreshToken: `${sessionId}.${secret}`
});

/**
 * Create a new long-lived session (on register / login).
 * @returns {Promise<{ token: string, refreshToken: string, sessionId: string }>}
 */
export const createSession = async ({ userId, username, userAgent }) => {
  const sessionId = crypto.randomUUID();
  const secret = generateSecret();
  const now = Date.now();

  await dbRun(
    `INSERT INTO user_sessions (id, user_id, username, current_token_hash, pending_token_hash, user_agent, created_at, last_used_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
    [sessionId, userId, username, hashSecret(secret), sanitizeUserAgent(userAgent), now, now]
  );

  return { ...buildTokenResponse({ userId, username, sessionId, secret }), sessionId };
};

/**
 * Exchange a refresh token for a new access token + rotated refresh token.
 * @throws {SessionError}
 */
export const refreshSession = async (rawRefreshToken) => {
  const parsed = parseRefreshToken(rawRefreshToken);
  if (!parsed) {
    throw new SessionError(SESSION_ERROR.INVALID, 'Malformed refresh token');
  }

  const { sessionId, secret } = parsed;
  const session = await dbGet('SELECT * FROM user_sessions WHERE id = ?', [sessionId]);
  if (!session) {
    throw new SessionError(SESSION_ERROR.REVOKED, 'Session not found or revoked');
  }

  const now = Date.now();
  if (isIdleExpired(session, now)) {
    await revokeSession(sessionId);
    throw new SessionError(SESSION_ERROR.EXPIRED, 'Session expired due to inactivity');
  }

  // Make sure the account still exists (e.g. after a database reset / account removal)
  const user = await dbGet('SELECT id, username FROM users WHERE id = ?', [session.user_id]);
  if (!user) {
    await revokeSession(sessionId);
    throw new SessionError(SESSION_ERROR.REVOKED, 'Account no longer exists');
  }

  const presentedHash = hashSecret(secret);
  const nextSecret = generateSecret();
  const nextHash = hashSecret(nextSecret);
  let result;

  if (safeEqualHex(presentedHash, session.current_token_hash)) {
    // Client is still on the confirmed token (first refresh, or the previous response was lost)
    result = await dbRun(
      'UPDATE user_sessions SET pending_token_hash = ?, last_used_at = ? WHERE id = ? AND current_token_hash = ?',
      [nextHash, now, sessionId, presentedHash]
    );
  } else if (session.pending_token_hash && safeEqualHex(presentedHash, session.pending_token_hash)) {
    // Client confirmed receipt of the last rotated token: promote it
    result = await dbRun(
      `UPDATE user_sessions
       SET current_token_hash = pending_token_hash, pending_token_hash = ?, last_used_at = ?
       WHERE id = ? AND pending_token_hash = ?`,
      [nextHash, now, sessionId, presentedHash]
    );
  } else {
    // A superseded token was replayed: assume compromise and kill the session.
    logger.warn(`Refresh token reuse detected for user "${session.username}". Revoking session ${sessionId}.`);
    await revokeSession(sessionId);
    throw new SessionError(SESSION_ERROR.REVOKED, 'Refresh token reuse detected');
  }

  if (!result || result.changes !== 1) {
    // Lost a race against a concurrent refresh of the same token; safe to retry.
    throw new SessionError(SESSION_ERROR.CONFLICT, 'Concurrent refresh in progress');
  }

  return buildTokenResponse({ userId: user.id, username: user.username, sessionId, secret: nextSecret });
};

/**
 * Check whether a session is still active (used during socket handshakes).
 */
export const isSessionActive = async (sessionId) => {
  if (!sessionId) return false;
  const row = await dbGet('SELECT last_used_at FROM user_sessions WHERE id = ?', [sessionId]);
  if (!row) return false;
  return !isIdleExpired(row, Date.now());
};

/**
 * Resolve the session id for a refresh token, verifying it belongs to that session.
 * Returns null for unknown / mismatched tokens.
 */
export const resolveSessionFromRefreshToken = async (rawRefreshToken) => {
  const parsed = parseRefreshToken(rawRefreshToken);
  if (!parsed) return null;
  const session = await dbGet(
    'SELECT id, user_id, username, current_token_hash, pending_token_hash FROM user_sessions WHERE id = ?',
    [parsed.sessionId]
  );
  if (!session) return null;
  const presentedHash = hashSecret(parsed.secret);
  const matches =
    safeEqualHex(presentedHash, session.current_token_hash) ||
    (session.pending_token_hash && safeEqualHex(presentedHash, session.pending_token_hash));
  return matches ? session : null;
};

export const revokeSession = async (sessionId) => {
  if (!sessionId) return 0;
  const res = await dbRun('DELETE FROM user_sessions WHERE id = ?', [sessionId]);
  return res?.changes || 0;
};

/**
 * Revoke every session of a user, optionally keeping one (the caller's own session).
 * @returns {Promise<string[]>} ids of revoked sessions
 */
export const revokeUserSessions = async (userId, { exceptSessionId = null } = {}) => {
  const rows = await dbAll('SELECT id FROM user_sessions WHERE user_id = ?', [userId]);
  const ids = rows.map((r) => r.id).filter((id) => id !== exceptSessionId);
  for (const id of ids) {
    await revokeSession(id);
  }
  return ids;
};

/**
 * Socket.IO room name used to address every socket opened under a session.
 */
export const sessionRoom = (sessionId) => `session:${sessionId}`;

/**
 * Forcefully disconnect all sockets belonging to the given sessions.
 */
export const disconnectSessionSockets = (io, sessionIds = []) => {
  if (!io) return;
  for (const id of sessionIds) {
    try {
      io.in(sessionRoom(id)).disconnectSockets(true);
    } catch (err) {
      logger.warn('Failed to disconnect sockets for revoked session:', err);
    }
  }
};
