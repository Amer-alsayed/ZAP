import jwt from 'jsonwebtoken';
import config from '../config.js';
import logger from '../logger.js';

/**
 * Middleware to authenticate HTTP requests using JWT tokens.
 * Expects 'Authorization: Bearer <token>' header.
 */
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token missing or required' });
  }

  jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }, (err, user) => {
    if (err) {
      logger.debug('Invalid or expired JWT token attempted', { error: err.message });
      return res.status(403).json({ error: 'Invalid or expired access token' });
    }
    req.user = user;
    next();
  });
};
