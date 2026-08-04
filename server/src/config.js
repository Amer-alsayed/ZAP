import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import crypto from 'crypto';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';

// Strict secret validation
let jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
  if (IS_PROD) {
    // In production, a missing JWT_SECRET means every server restart invalidates all user tokens.
    // This causes a permanent "Connecting to Chatra Server..." loop for all logged-in users.
    // CRITICAL: Set JWT_SECRET as an environment variable on your hosting platform (e.g. Render).
    console.error('❌ FATAL: JWT_SECRET environment variable is not set in production!');
    console.error('   Every server restart will invalidate all user sessions.');
    console.error('   Set JWT_SECRET in your Render environment variables and restart the server.');
    process.exit(1);
  } else {
    jwtSecret = 'super-secure-chatra-secret-key-12345';
  }
}

// CORS Allowed Origins
// In production, if CLIENT_ORIGIN is not explicitly set, allow all origins
// (the client is served from the same server, so same-origin requests are safe).
// For extra security, set CLIENT_ORIGIN in your Render environment variables.
const allowedOrigins = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(',').map((origin) => origin.trim())
  : IS_PROD
    ? null // null = allow all origins in production when not explicitly restricted
    : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000'];

export const config = {
  env: NODE_ENV,
  isProd: IS_PROD,
  port: parseInt(process.env.PORT || '5000', 10),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  allowedOrigins,
  dbUrl: process.env.DATABASE_URL || null,
  dbPath: process.env.DATABASE_PATH || path.resolve(__dirname, '../../chatra.db'),
  uploadsDir: path.resolve(__dirname, '../uploads'),
  mediaTtlHours: parseInt(process.env.MEDIA_TTL_HOURS || '168', 10)
};

export default config;
