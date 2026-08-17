import rateLimit from 'express-rate-limit';

/**
 * General API rate limiter to protect overall server bandwidth and resource usage.
 * Max 500 requests per 15 minutes per IP.
 */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes.' }
});

/**
 * Strict rate limiter for authentication endpoints (Login / Register)
 * to prevent brute-force credential guessing attacks.
 * Max 30 requests per 15 minutes per IP.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again after 15 minutes.' }
});

/**
 * Rate limiter for file upload endpoint to prevent storage exhaustion or abuse.
 * Max 300 file uploads per 15 minutes per IP.
 */
export const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Upload limit exceeded, please try again later.' }
});
