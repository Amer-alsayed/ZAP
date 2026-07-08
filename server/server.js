import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { initDb } from './src/db.js';
import { register, login, searchUser } from './src/authController.js';
import { socketHandler } from './src/socketHandler.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5000;

// Initialize app
const app = express();
const httpServer = createServer(app);

// CORS configuration
const corsOptions = {
  origin: '*', // In production, replace with specific frontend domains
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '20mb' })); // Support base64 uploads up to 20MB

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve uploaded encrypted files statically
app.use('/uploads', express.static(uploadsDir));

// API Routes
app.post('/api/auth/register', register);
app.post('/api/auth/login', login);
app.get('/api/auth/search', searchUser);

// File upload endpoint (receives client-side encrypted file payload)
app.post('/api/upload', (req, res) => {
  const { filename, fileData } = req.body; // fileData is base64 string of encrypted file

  if (!filename || !fileData) {
    return res.status(400).json({ error: 'Filename and fileData are required' });
  }

  try {
    // Generate a unique name to prevent collisions
    const uniquePrefix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const safeFilename = `${uniquePrefix}-${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const filePath = path.join(uploadsDir, safeFilename);

    // Write file from base64
    const buffer = Buffer.from(fileData, 'base64');
    fs.writeFileSync(filePath, buffer);

    const fileUrl = `/uploads/${safeFilename}`;
    res.status(200).json({ fileUrl });
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Serve frontend in production (scaffolding)
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.send('Chatra E2EE Server is running...');
  });
}

// Initialize Socket.io
const io = new Server(httpServer, {
  cors: corsOptions
});

// Attach socket handlers
socketHandler(io);

// Initialize DB and start server
const startServer = async () => {
  await initDb();
  httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
};

startServer();
