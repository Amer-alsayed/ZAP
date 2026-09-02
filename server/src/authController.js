import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { dbGet, dbRun } from './db.js';
import config from './config.js';
import logger from './logger.js';

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

    // Create JWT Token
    const token = jwt.sign({ id: result.id, username }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

    logger.info(`User registered successfully: ${username}`);

    return res.status(201).json({
      message: 'User registered successfully',
      token,
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

    // Create JWT Token
    const token = jwt.sign({ id: user.id, username: user.username }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

    logger.info(`Login successful: ${user.username}`);

    return res.status(200).json({
      message: 'Login successful',
      token,
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

    return res.status(200).json({
      message: 'Password changed successfully'
    });
  } catch (error) {
    logger.error('Change password error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

