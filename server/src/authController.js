import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { dbGet, dbRun } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secure-chatra-secret-key-12345';

export const register = async (req, res) => {
  const { username, loginHash, publicIdentityKey, publicSigningKey, encryptedPrivateKeys } = req.body;

  if (!username || !loginHash || !publicIdentityKey || !publicSigningKey || !encryptedPrivateKeys) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  // Username validation: alphanumeric, 3-20 characters
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  if (!usernameRegex.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-20 alphanumeric characters or underscores' });
  }

  try {
    // Check if user exists (case-insensitive check is safer)
    const existingUser = await dbGet('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username]);
    if (existingUser) {
      return res.status(400).json({ error: 'Username is already taken' });
    }

    // Hash the login hash sent by the client
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(loginHash, salt);

    // Save user to DB
    const result = await dbRun(
      `INSERT INTO users (username, password_hash, public_identity_key, public_signing_key, encrypted_private_keys)
       VALUES (?, ?, ?, ?, ?)`,
      [username, passwordHash, JSON.stringify(publicIdentityKey), JSON.stringify(publicSigningKey), JSON.stringify(encryptedPrivateKeys)]
    );

    // Create JWT Token
    const token = jwt.sign({ id: result.id, username }, JWT_SECRET, { expiresIn: '7d' });

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
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export const login = async (req, res) => {
  const { username, loginHash } = req.body;

  if (!username || !loginHash) {
    return res.status(400).json({ error: 'Username and login password are required' });
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
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        username: user.username,
        publicIdentityKey: JSON.parse(user.public_identity_key),
        publicSigningKey: JSON.parse(user.public_signing_key),
        encryptedPrivateKeys: JSON.parse(user.encrypted_private_keys)
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export const searchUser = async (req, res) => {
  const { username } = req.query;
  console.log('Search user request received. Query username:', username);

  if (!username) {
    return res.status(400).json({ error: 'Query parameter "username" is required' });
  }

  const trimmedUsername = username.trim();

  try {
    const user = await dbGet('SELECT username, public_identity_key, public_signing_key, display_name, avatar_icon FROM users WHERE LOWER(username) = LOWER(?)', [trimmedUsername]);
    console.log('Database user query result:', user);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.status(200).json({
      username: user.username,
      publicIdentityKey: JSON.parse(user.public_identity_key),
      publicSigningKey: JSON.parse(user.public_signing_key),
      displayName: user.display_name,
      avatarIcon: user.avatar_icon
    });
  } catch (error) {
    console.error('Search user error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
