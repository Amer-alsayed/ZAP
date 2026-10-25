import jwt from 'jsonwebtoken';
import config from '../config.js';
import logger from '../logger.js';

/**
 * Machine-readable auth error codes shared by HTTP responses and Socket.IO
 * handshake errors. Clients use them to decide between silently refreshing the
 * access token (TOKEN_EXPIRED / TOKEN_INVALID) and ending the session.
 */
export const AUTH_ERROR = Object.freeze({
  TOKEN_MISSING: 'TOKEN_MISSING',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID'
});

/**
 * Verify an access token and return its payload, or throw an error carrying an AUTH_ERROR code.
 */
export const verifyAccessToken = (token) => {
  if (!token) {
    const err = new Error('Access token missing');
    err.code = AUTH_ERROR.TOKEN_MISSING;
    throw err;
  }
  try {
    return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch (e) {
    const err = new Error(e.name === 'TokenExpiredError' ? 'Access token expired' : 'Invalid access token');
    err.code = e.name === 'TokenExpiredError' ? AUTH_ERROR.TOKEN_EXPIRED : AUTH_ERROR.TOKEN_INVALID;
    throw err;
  }
};

/**
 * Middleware to authenticate HTTP requests using JWT tokens.
 * Expects 'Authorization: Bearer <token>' header.
 * Responds 401 with `{ error, code }` so clients can transparently refresh and retry.
 */
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch (err) {
    logger.debug('Rejected HTTP access token', { code: err.code });
    return res.status(401).json({ error: err.message, code: err.code });
  }
};
