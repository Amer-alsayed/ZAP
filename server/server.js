// ZAP - Anonymous Secure E2EE Messaging Platform (Production Release)
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
import { register, login, searchUser, getAuthSalt } from './src/authController.js';
import { socketHandler } from './src/socketHandler.js';
import { authenticateToken } from './src/middleware/authMiddleware.js';
import { generalLimiter, authLimiter, saltLimiter, uploadLimiter } from './src/middleware/rateLimiter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize app
const app = express();
app.disable('x-powered-by');
const httpServer = createServer(app);

// Enable Reverse Proxy Trust for accurate rate limiting on cloud platforms
app.set('trust proxy', 1);

// Security Headers with Helmet
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

// Configurable CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    // In development / local testing, allow any origin
    if (!config.allowedOrigins) return callback(null, true);
    // In production, check against allowed origins
    if (!config.isProd) return callback(null, true);
    if (config.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Blocked by CORS policy'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
};

app.use(cors(corsOptions));

// Body Parser with strict 50MB payload limits
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ensure upload directory exists
if (!fs.existsSync(config.uploadsDir)) {
  fs.mkdirSync(config.uploadsDir, { recursive: true });
}

// Periodic background cleanup for uploaded files (configurable TTL, default 7 days)
const UPLOAD_FILE_TTL_MS = (config.mediaTtlHours || 168) * 60 * 60 * 1000;
setInterval(async () => {
  try {
    const files = await fs.promises.readdir(config.uploadsDir);
    const now = Date.now();
    for (const file of files) {
      const filePath = path.join(config.uploadsDir, file);
      const stats = await fs.promises.stat(filePath);
      if (now - stats.mtimeMs > UPLOAD_FILE_TTL_MS) {
        await fs.promises.unlink(filePath);
        logger.info(`Auto-cleaned expired media upload: ${file}`);
      }
    }
  } catch (err) {
    logger.error('Background upload cleanup error:', err);
  }
}, 60 * 60 * 1000);

// Static uploads serving with security headers
app.use('/uploads', express.static(config.uploadsDir, {
  dotfiles: 'ignore',
  index: false,
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  }
}));

// Apply global rate limiter
app.use('/api/', generalLimiter);

// Liveness & Readiness Healthcheck Endpoint
app.get('/health', async (req, res) => {
  const dbAlive = await dbPing();
  const healthStatus = {
    status: dbAlive ? 'ok' : 'degraded',
    environment: config.env,
    timestamp: new Date().toISOString(),
    database: dbAlive ? 'connected' : 'disconnected'
  };

  res.status(dbAlive ? 200 : 503).json(healthStatus);
});

// API Routes with rate limiters & auth protection
app.get('/api/auth/salt/:username', saltLimiter, getAuthSalt);
app.get('/api/auth/salt', saltLimiter, getAuthSalt);
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

// Serve frontend if built, otherwise display API status
const clientDist = path.resolve(__dirname, '../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.send('ZAP E2EE Server is running...');
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

// WebRTC Dynamic ICE Servers Discovery endpoint
app.get('/api/webrtc/ice-servers', (req, res) => {
  const iceServers = [];

  // 1. If custom STUN is configured
  if (config.stunUrl) {
    iceServers.push({ urls: config.stunUrl });
  } else {
    iceServers.push(
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    );
  }

  // 2. If self-hosted Coturn / custom TURN relay is configured
  if (config.turnUrl && config.turnUsername && config.turnCredential) {
    iceServers.push({
      urls: config.turnUrl,
      username: config.turnUsername,
      credential: config.turnCredential
    });
  } else {
    // OpenRelay fallback
    iceServers.push(
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelay',
        credential: 'openrelay'
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelay',
        credential: 'openrelay'
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelay',
        credential: 'openrelay'
      }
    );
  }

  res.status(200).json({ iceServers });
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

  // Attach Redis Pub/Sub cluster adapter if REDIS_URL is configured
  if (config.redisUrl) {
    try {
      const { createClient } = await import('redis');
      const { createAdapter } = await import('@socket.io/redis-adapter');
      const pubClient = createClient({ url: config.redisUrl });
      const subClient = pubClient.duplicate();
      await Promise.all([pubClient.connect(), subClient.connect()]);
      io.adapter(createAdapter(pubClient, subClient));
      logger.info('Attached Redis Cluster Pub/Sub Adapter to Socket.IO');
    } catch (err) {
      logger.warn(`Redis adapter initialization failed, falling back to standalone in-memory mode: ${err.message}`);
    }
  }

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
