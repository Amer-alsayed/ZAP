import sqlite3 from 'sqlite3';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isPostgres = !!process.env.DATABASE_URL;
let db = null;
let pgPool = null;

if (isPostgres) {
  console.log('PostgreSQL DATABASE_URL detected. Connecting to Cloud Database...');
  pgPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
} else {
  const dbPath = process.env.DATABASE_PATH || path.resolve(__dirname, '../../chatra.db');
  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Error connecting to SQLite database:', err.message);
    } else {
      console.log(`Connected to the SQLite database at: ${dbPath}`);
    }
  });
}

// Helper functions to wrap database queries in Promises
export const dbRun = (query, params = []) => {
  if (isPostgres) {
    return new Promise(async (resolve, reject) => {
      try {
        let sql = query
          .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY')
          .replace(/DATETIME DEFAULT CURRENT_TIMESTAMP/g, 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
        
        // Append RETURNING id if it's an INSERT query and doesn't have it
        if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
          sql += ' RETURNING id';
        }
        
        // Replace ? with $1, $2...
        let index = 1;
        sql = sql.replace(/\?/g, () => `$${index++}`);

        const res = await pgPool.query(sql, params);
        resolve({
          id: res.rows[0]?.id || null,
          changes: res.rowCount
        });
      } catch (err) {
        reject(err);
      }
    });
  } else {
    return new Promise((resolve, reject) => {
      db.run(query, params, function (err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }
};

export const dbGet = (query, params = []) => {
  if (isPostgres) {
    return new Promise(async (resolve, reject) => {
      try {
        let index = 1;
        const sql = query.replace(/\?/g, () => `$${index++}`);
        const res = await pgPool.query(sql, params);
        resolve(res.rows[0] || null);
      } catch (err) {
        reject(err);
      }
    });
  } else {
    return new Promise((resolve, reject) => {
      db.get(query, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }
};

export const dbAll = (query, params = []) => {
  if (isPostgres) {
    return new Promise(async (resolve, reject) => {
      try {
        let index = 1;
        const sql = query.replace(/\?/g, () => `$${index++}`);
        const res = await pgPool.query(sql, params);
        resolve(res.rows);
      } catch (err) {
        reject(err);
      }
    });
  } else {
    return new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }
};

// Initialize database tables
export const initDb = async () => {
  try {
    // Create Users Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        public_identity_key TEXT NOT NULL,
        public_signing_key TEXT NOT NULL,
        encrypted_private_keys TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Messages Table (stores E2EE encrypted messages)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT NOT NULL,
        recipient TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        signature TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        delivered INTEGER DEFAULT 0
      )
    `);

    // Dynamic schema migrations: add display_name and avatar_icon if they do not exist
    try {
      await dbRun('ALTER TABLE users ADD COLUMN display_name TEXT');
      console.log('Database migration: Added display_name column to users table.');
    } catch (e) {
      // Column already exists
    }

    try {
      await dbRun('ALTER TABLE users ADD COLUMN avatar_icon TEXT');
      console.log('Database migration: Added avatar_icon column to users table.');
    } catch (e) {
      // Column already exists
    }

    console.log('Database tables initialized successfully.');
  } catch (error) {
    console.error('Error initializing database tables:', error);
    process.exit(1);
  }
};

export default db;
