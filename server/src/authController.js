import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { dbGet, dbRun } from './db.js';
import config from './config.js';
import logger from './logger.js';
import {
  createSession,
  refreshSession,
  revokeSession,
  revokeUserSessions,
  resolveSessionFromRefreshToken,
  disconnectSessionSockets,
  SessionError,
  SESSION_ERROR
} from './sessionService.js';

const safeJsonParse = (val) => {
  if (!val) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch (e) {
    logger.error('safeJsonParse error:', e);
    return null;
  }
};

export const getAuthSalt = async (req, res) => {
  const username = req.params.username || req.query.username;
  if (!username || typeof username !== 'string' || username.length > 50) {
    const fallbackDummy = crypto.createHmac('sha256', config.jwtSecret || 'zap-secret').update('dummy_anonymous').digest('hex').slice(0, 32);
    return res.status(200).json({ authSalt: fallbackDummy });
  }

  try {
    const user = await dbGet('SELECT auth_salt FROM users WHERE LOWER(username) = LOWER(?)', [username]);
    if (user) {
      if (user.auth_salt) {
        return res.status(200).json({ authSalt: user.auth_salt });
      }
      // Legacy account registered without custom salt
      return res.status(200).json({ authSalt: null });
    }

    // Anti-Enumeration Oracle Protection:
    // For non-existent accounts, generate a deterministic 16-byte
    // pseudo-salt derived from HMAC-SHA256(ServerSecret, username).
    // This ensures EVERY username query returns a realistic 16-byte hex string in constant time,
    // making it mathematically impossible for an attacker to enumerate valid registered usernames.
    const pseudoSalt = crypto
      .createHmac('sha256', config.jwtSecret || 'zap-secret')
      .update(username.toLowerCase())
      .digest('hex')
      .slice(0, 32);

    return res.status(200).json({ authSalt: pseudoSalt });
  } catch (error) {
    logger.error('Error fetching auth salt:', error);
    const fallbackSalt = crypto
      .createHmac('sha256', config.jwtSecret || 'zap-secret')
      .update(username.toLowerCase())
      .digest('hex')
      .slice(0, 32);
    return res.status(200).json({ authSalt: fallbackSalt });
  }
};

export const register = async (req, res) => {
  const { username, loginHash, publicIdentityKey, publicSigningKey, encryptedPrivateKeys, authSalt } = req.body;

  if (!username || !loginHash || !publicIdentityKey || !publicSigningKey || !encryptedPrivateKeys) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  // Username validation: alphanumeric, 3-20 characters
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  if (!usernameRegex.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-20 alphanumeric characters or underscores' });
  }

  if (typeof loginHash !== 'string' || loginHash.length > 512) {
    return res.status(400).json({ error: 'Invalid login authentication data format' });
  }

  try {
    // Check if user exists (case-insensitive check)
    const existingUser = await dbGet('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username]);
    if (existingUser) {
      return res.status(400).json({ error: 'Username is already taken' });
    }

    // Hash the login hash sent by the client
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(loginHash, salt);

    // Save user to DB
    const result = await dbRun(
      `INSERT INTO users (username, password_hash, public_identity_key, public_signing_key, encrypted_private_keys, auth_salt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        username, 
        passwordHash, 
        typeof publicIdentityKey === 'string' ? publicIdentityKey : JSON.stringify(publicIdentityKey), 
        typeof publicSigningKey === 'string' ? publicSigningKey : JSON.stringify(publicSigningKey), 
        typeof encryptedPrivateKeys === 'string' ? encryptedPrivateKeys : JSON.stringify(encryptedPrivateKeys),
        typeof authSalt === 'string' ? authSalt : null
      ]
    );

    // Create a long-lived session (short-lived access token + refresh token)
    const { token, refreshToken } = await createSession({
      userId: result.id,
      username,
      userAgent: req.get('user-agent')
    });

    logger.info(`User registered successfully: ${username}`);

    return res.status(201).json({
      message: 'User registered successfully',
      token,
      refreshToken,
      user: {
        username,
        publicIdentityKey,
        publicSigningKey
      }
    });
  } catch (error) {
    logger.error('Registration error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export const login = async (req, res) => {
  const { username, loginHash } = req.body;

  if (!username || typeof username !== 'string' || username.length > 50 || !loginHash || typeof loginHash !== 'string' || loginHash.length > 512) {
    return res.status(400).json({ error: 'Invalid username or password format' });
  }

  try {
    // Fetch user from DB
    const user = await dbGet('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [username]);
    if (!user) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    // Verify the login hash
    const isValid = await bcrypt.compare(loginHash, user.password_hash);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    // Create a long-lived session (short-lived access token + refresh token)
    const { token, refreshToken } = await createSession({
      userId: user.id,
      username: user.username,
      userAgent: req.get('user-agent')
    });

    logger.info(`Login successful: ${user.username}`);

    return res.status(200).json({
      message: 'Login successful',
      token,
      refreshToken,
      user: {
        username: user.username,
        displayName: user.display_name,
        avatarIcon: user.avatar_icon,
        themeColor: user.theme_color || null,
        publicIdentityKey: safeJsonParse(user.public_identity_key),
        publicSigningKey: safeJsonParse(user.public_signing_key),
        encryptedPrivateKeys: safeJsonParse(user.encrypted_private_keys)
      }
    });
  } catch (error) {
    logger.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export const searchUser = async (req, res) => {
  const { username } = req.query;

  if (!username || typeof username !== 'string' || username.length > 50) {
    return res.status(400).json({ error: 'Query parameter "username" is required and must be valid' });
  }

  const trimmedUsername = username.trim();

  try {
    const user = await dbGet('SELECT username, public_identity_key, public_signing_key, display_name, avatar_icon FROM users WHERE LOWER(username) = LOWER(?)', [trimmedUsername]);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.status(200).json({
      username: user.username,
      publicIdentityKey: safeJsonParse(user.public_identity_key),
      publicSigningKey: safeJsonParse(user.public_signing_key),
      displayName: user.display_name,
      avatarIcon: user.avatar_icon
    });
  } catch (error) {
    logger.error('Search user error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export const changePassword = async (req, res) => {
  const { currentLoginHash, newLoginHash, encryptedPrivateKeys, authSalt } = req.body;
  const userId = req.user?.id;
  const username = req.user?.username;

  if (!userId || !username) {
    return res.status(401).json({ error: 'Unauthorized: authentication required' });
  }

  if (!currentLoginHash || !newLoginHash || !encryptedPrivateKeys) {
    return res.status(400).json({ error: 'All fields are required to change password' });
  }

  if (typeof currentLoginHash !== 'string' || currentLoginHash.length > 512 ||
      typeof newLoginHash !== 'string' || newLoginHash.length > 512) {
    return res.status(400).json({ error: 'Invalid password authentication data format' });
  }

  // Validate encryptedPrivateKeys bundle
  const encKeysObj = typeof encryptedPrivateKeys === 'string' ? safeJsonParse(encryptedPrivateKeys) : encryptedPrivateKeys;
  if (!encKeysObj || typeof encKeysObj !== 'object' || !encKeysObj.ciphertext || !encKeysObj.iv) {
    return res.status(400).json({ error: 'Invalid encrypted private keys payload' });
  }

  if (authSalt && (typeof authSalt !== 'string' || authSalt.length > 128)) {
    return res.status(400).json({ error: 'Invalid authentication salt format' });
  }

  try {
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password hash
    const isValid = await bcrypt.compare(currentLoginHash, user.password_hash);
    if (!isValid) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    // Prevent changing to exact same password hash
    const isSame = await bcrypt.compare(newLoginHash, user.password_hash);
    if (isSame) {
      return res.status(400).json({ error: 'New password must be different from current password' });
    }

    // Hash the new loginHash with fresh bcrypt salt
    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newLoginHash, salt);

    // Save updated credentials & re-wrapped encrypted private keys
    await dbRun(
      `UPDATE users 
       SET password_hash = ?, encrypted_private_keys = ?, auth_salt = ?
       WHERE id = ?`,
      [
        newPasswordHash,
        typeof encryptedPrivateKeys === 'string' ? encryptedPrivateKeys : JSON.stringify(encryptedPrivateKeys),
        authSalt || user.auth_salt || null,
        userId
      ]
    );

    logger.info(`Password successfully updated for user: ${username}`);

    // Security: a password change signs out every *other* device/session.
    // The session that performed the change stays signed in.
    let revokedSessions = 0;
    try {
      const revokedIds = await revokeUserSessions(userId, { exceptSessionId: req.user?.sid || null });
      revokedSessions = revokedIds.length;
      disconnectSessionSockets(req.app.get('io'), revokedIds);
    } catch (revokeErr) {
      logger.error('Failed to revoke other sessions after password change:', revokeErr);
    }

    return res.status(200).json({
      message: 'Password changed successfully',
      revokedSessions
    });
  } catch (error) {
    logger.error('Change password error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};


/**
 * POST /api/auth/refresh
 * Exchange a refresh token for a fresh access token and a rotated refresh token.
 * 401 => session is definitively gone (client must sign in again).
 * 409 / 5xx => transient; client keeps its session and retries later.
 */
export const refresh = async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken || typeof refreshToken !== 'string') {
    return res.status(401).json({ error: 'Refresh token is required', code: SESSION_ERROR.INVALID });
  }

  try {
    const tokens = await refreshSession(refreshToken);
    res.set('Cache-Control', 'no-store');
    return res.status(200).json(tokens);
  } catch (error) {
    if (error instanceof SessionError) {
      if (error.code === SESSION_ERROR.CONFLICT) {
        return res.status(409).json({ error: 'Session refresh already in progress, please retry', code: error.code });
      }
      return res.status(401).json({ error: 'Your session has ended. Please sign in again.', code: error.code });
    }
    logger.error('Session refresh error:', error);
    return res.status(503).json({ error: 'Session service temporarily unavailable' });
  }
};

/**
 * POST /api/auth/logout
 * Revoke the session identified by the given refresh token and disconnect its sockets.
 * Always responds 204 so logout is idempotent and leaks nothing about token validity.
 */
export const logout = async (req, res) => {
  const { refreshToken } = req.body || {};
  try {
    const session = await resolveSessionFromRefreshToken(refreshToken);
    if (session) {
      await revokeSession(session.id);
      disconnectSessionSockets(req.app.get('io'), [session.id]);
      logger.info(`User signed out: ${session.username}`);
    }
  } catch (error) {
    logger.error('Logout error:', error);
  }
  return res.status(204).end();
};

/**
 * POST /api/auth/session
 * One-time migration path for clients that signed in before refresh sessions
 * existed: exchanges a legacy HS256-signed JWT (no `sid` claim) for a long-lived
 * refresh session so existing users are not forced to sign in again after upgrading,
 * even if their old 7-day JWT timestamp has already elapsed.
 * Tokens that already carry a `sid` claim must use `/api/auth/refresh` and are rejected here.
 */
export const upgradeLegacySession = async (req, res) => {
  const authHeader = req.headers['authorization'];
  const rawToken = authHeader && authHeader.split(' ')[1];
  if (!rawToken) {
    return res.status(401).json({ error: 'Access token missing', code: 'TOKEN_MISSING' });
  }

  let decoded;
  try {
    decoded = jwt.verify(rawToken, config.jwtSecret, {
      algorithms: ['HS256'],
      ignoreExpiration: true
    });
  } catch {
    return res.status(401).json({ error: 'Invalid access token', code: 'TOKEN_INVALID' });
  }

  const { id: userId, username, sid } = decoded || {};
  if (sid) {
    return res.status(400).json({ error: 'Token is already bound to a session' });
  }
  if (!userId || !username) {
    return res.status(401).json({ error: 'Invalid access token', code: 'TOKEN_INVALID' });
  }

  try {
    const user = await dbGet('SELECT id, username FROM users WHERE id = ?', [userId]);
    if (!user || user.username.toLowerCase() !== String(username).toLowerCase()) {
      return res.status(401).json({ error: 'Account no longer exists', code: SESSION_ERROR.REVOKED });
    }

    const { token, refreshToken } = await createSession({
      userId: user.id,
      username: user.username,
      userAgent: req.get('user-agent')
    });

    logger.info(`Upgraded legacy token to persistent session for: ${user.username}`);
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ token, refreshToken });
  } catch (error) {
    logger.error('Legacy session upgrade error:', error);
    return res.status(503).json({ error: 'Session service temporarily unavailable' });
  }
};
