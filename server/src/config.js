import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';

// Strict secret validation
let jwtSecret = process.env.JWT_SECRET;
const DEFAULT_DEV_SECRET = 'super-secure-chatra-secret-key-12345';

if (!jwtSecret) {
  if (IS_PROD) {
    console.warn('WARNING: process.env.JWT_SECRET is missing in production mode! Falling back to default secret. Please configure JWT_SECRET in environment variables.');
  }
  jwtSecret = DEFAULT_DEV_SECRET;
}

// CORS Allowed Origins
const allowedOrigins = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(',').map((origin) => origin.trim())
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
