// Chatra - Anonymous Secure E2EE Messaging Platform (Production Release)
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import config from './src/config.js';
import logger from './src/logger.js';
import { initDb, dbPing } from './src/db.js';
import { register, login, searchUser } from './src/authController.js';
import { socketHandler } from './src/socketHandler.js';
import { authenticateToken } from './src/middleware/authMiddleware.js';
import { generalLimiter, authLimiter, uploadLimiter } from './src/middleware/rateLimiter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize app
const app = express();
app.disable('x-powered-by');
const httpServer = createServer(app);

// Apply HTTP Security Headers via Helmet
app.use(
  helmet({
    contentSecurityPolicy: false, // Set to false to avoid breaking external media assets if loaded dynamically
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);

// Apply general rate limiting across all API endpoints
app.use('/api', generalLimiter);

// Configurable CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, same-origin requests)
    if (!origin) return callback(null, true);
    // Allow all origins when allowedOrigins is null (production without CLIENT_ORIGIN set)
    if (!config.allowedOrigins) return callback(null, true);
    // In development always allow
    if (!config.isProd) return callback(null, true);
    // Check against the explicit whitelist
    if (config.allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '60mb' })); // Support base64 uploads up to 60MB

// Create uploads directory if it doesn't exist
if (!fs.existsSync(config.uploadsDir)) {
  fs.mkdirSync(config.uploadsDir, { recursive: true });
}

// Periodic background cleanup for uploaded files (configurable TTL, default 7 days)
const UPLOAD_FILE_TTL_MS = (config.mediaTtlHours || 168) * 60 * 60 * 1000;
const uploadCleanupInterval = setInterval(async () => {
  try {
    const files = await fs.promises.readdir(config.uploadsDir);
    const now = Date.now();
    for (const file of files) {
      const filePath = path.join(config.uploadsDir, file);
      const stats = await fs.promises.stat(filePath);
      if (now - stats.mtimeMs > UPLOAD_FILE_TTL_MS) {
        await fs.promises.unlink(filePath);
        logger.info(`Auto-purged expired upload file: ${file}`);
      }
    }
  } catch (err) {
    logger.error('Error cleaning up expired upload files:', err);
  }
}, 60 * 60 * 1000); // Run hourly check

uploadCleanupInterval.unref();

// Serve uploaded encrypted files statically with strict security response headers
app.use('/uploads', express.static(config.uploadsDir, {
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  }
}));

// System Health Probe Endpoint
app.get('/health', async (req, res) => {
  const dbAlive = await dbPing();
  const healthStatus = {
    status: dbAlive ? 'ok' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: config.env,
    database: dbAlive ? 'connected' : 'disconnected'
  };

  res.status(dbAlive ? 200 : 503).json(healthStatus);
});

// API Routes with rate limiters & auth protection
app.post('/api/auth/register', authLimiter, register);
app.post('/api/auth/login', authLimiter, login);
app.get('/api/auth/search', authenticateToken, searchUser);

// File upload endpoint (receives client-side encrypted file payload)
app.post('/api/upload', uploadLimiter, authenticateToken, async (req, res) => {
  const { filename, fileData } = req.body;

  if (!filename || !fileData) {
    return res.status(400).json({ error: 'Filename and fileData are required' });
  }

  if (typeof filename !== 'string' || typeof fileData !== 'string') {
    return res.status(400).json({ error: 'Invalid data format' });
  }

  try {
    // Strict filename sanitization to eliminate path traversal attempts (e.g. .., /, \)
    const cleanBasename = path.basename(filename).replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniquePrefix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const safeFilename = `${uniquePrefix}-${cleanBasename}`;
    const resolvedUploadsDir = path.resolve(config.uploadsDir);
    const filePath = path.resolve(resolvedUploadsDir, safeFilename);

    // Prevent path traversal outside uploads directory
    if (!filePath.startsWith(resolvedUploadsDir + path.sep) && filePath !== resolvedUploadsDir) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    // Strip optional data URL prefix (e.g., data:application/octet-stream;base64,) if present
    const cleanBase64 = fileData.replace(/^data:[^;]+;base64,/, '');

    // Write file asynchronously from base64 buffer
    const buffer = Buffer.from(cleanBase64, 'base64');

    if (buffer.length > 50 * 1024 * 1024) {
      return res.status(400).json({ error: 'File size exceeds maximum allowable threshold (50MB)' });
    }

    await fs.promises.writeFile(filePath, buffer);

    const fileUrl = `/uploads/${safeFilename}`;
    res.status(200).json({ fileUrl });
  } catch (error) {
    logger.error('File upload error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Serve frontend in production
if (config.isProd) {
  const clientDist = path.resolve(__dirname, '../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.send('Chatra E2EE Server is running...');
  });
}

// Centralized Global Error Handling Middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled server error:', err);
  const status = err.status || 500;
  const message = config.isProd
    ? 'An unexpected error occurred on the server'
    : (err.message || 'Internal server error');
  res.status(status).json({ error: message });
});

// Initialize Socket.io
const io = new Server(httpServer, {
  cors: corsOptions
});

// Attach socket handlers
socketHandler(io);

// Initialize DB and start server
const startServer = async () => {
  await initDb();
  httpServer.listen(config.port, () => {
    logger.info(`Server is running in [${config.env}] mode on port ${config.port}`);
  });
};

startServer();

// Graceful Process Shutdown management
const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  io.close(() => {
    logger.info('Socket.IO connections closed.');
  });
  httpServer.close(() => {
    logger.info('HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
