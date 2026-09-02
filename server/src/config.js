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
    // This causes a permanent "Connecting to ZAP Server..." loop for all logged-in users.
    // CRITICAL: Set JWT_SECRET as an environment variable on your hosting platform (e.g. Render).
    console.error('❌ FATAL: JWT_SECRET environment variable is not set in production!');
    console.error('   Every server restart will invalidate all user sessions.');
    console.error('   Set JWT_SECRET in your Render environment variables and restart the server.');
    process.exit(1);
  } else {
    jwtSecret = 'super-secure-zap-secret-key-12345';
  }
}

// Persistent database validation for cloud environments
const IS_RENDER = process.env.RENDER === 'true';
const dbUrl = process.env.DATABASE_URL || null;

if (!dbUrl && IS_PROD) {
  if (IS_RENDER && process.env.ALLOW_EPHEMERAL_DB !== 'true') {
    console.error('================================================================================');
    console.error('❌ FATAL: DATABASE_URL is not set on Render!');
    console.error('   Render Web Services operate on an EPHEMERAL container filesystem.');
    console.error('   Running SQLite (zap.db) without persistent disk means ALL USER ACCOUNTS,');
    console.error('   KEYS, AND MESSAGES WILL BE PERMANENTLY ERASED whenever Render sleeps,');
    console.error('   restarts, deploys, or reactivates after the monthly free quota.');
    console.error('');
    console.error('   👉 HOW TO FIX IN 2 MINUTES (100% FREE & PERMANENT):');
    console.error('   1. Create a free PostgreSQL database on Neon (https://neon.tech).');
    console.error('   2. Copy the connection URI (postgresql://user:pass@host/neondb?sslmode=require).');
    console.error('   3. In Render Dashboard -> Your Service -> Environment:');
    console.error('      Add Key: DATABASE_URL, Value: <your-neon-postgres-uri>');
    console.error('   4. Redeploy. Your data will be preserved permanently forever!');
    console.error('');
    console.error('   (To bypass this guard for ephemeral testing only, set ALLOW_EPHEMERAL_DB=true)');
    console.error('================================================================================');
    process.exit(1);
  } else if (!IS_RENDER && process.env.ALLOW_EPHEMERAL_DB !== 'true') {
    console.warn('⚠️ WARNING: DATABASE_URL is not set in production. Using local SQLite.');
    console.warn('   Ensure this host has a persistent volume mounted at DATABASE_PATH to prevent data loss.');
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
  dbPath: process.env.DATABASE_PATH || path.resolve(__dirname, '../../zap.db'),
  uploadsDir: path.resolve(__dirname, '../uploads'),
  mediaTtlHours: parseInt(process.env.MEDIA_TTL_HOURS || '168', 10),
  redisUrl: process.env.REDIS_URL || null,
  turnUrl: process.env.TURN_URL || null,
  turnUsername: process.env.TURN_USERNAME || null,
  turnCredential: process.env.TURN_CREDENTIAL || null,
  stunUrl: process.env.STUN_URL || null
};

export default config;
