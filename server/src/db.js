import sqlite3 from 'sqlite3';
import pg from 'pg';
import config from './config.js';
import logger from './logger.js';

const isPostgres = !!config.dbUrl;
let db = null;
let pgPool = null;

if (isPostgres) {
  logger.info('PostgreSQL DATABASE_URL detected. Connecting to Cloud Database...');
  pgPool = new pg.Pool({
    connectionString: config.dbUrl,
    ssl: {
      rejectUnauthorized: false
    }
  });

  pgPool.on('error', (err) => {
    logger.error('Unexpected error on idle PostgreSQL client:', err);
  });
} else {
  db = new sqlite3.Database(config.dbPath, (err) => {
    if (err) {
      logger.error('Error connecting to SQLite database:', err);
    } else {
      logger.info(`Connected to SQLite database at: ${config.dbPath}`);
      db.run('PRAGMA journal_mode = WAL;');
      db.run('PRAGMA synchronous = NORMAL;');
      db.configure('busyTimeout', 5000);
    }
  });
}

/**
 * Safely converts SQLite positional `?` placeholders to PostgreSQL `$1, $2` parameters,
 * bypassing question marks contained within single-quoted string literals.
 */
function convertSqlPlaceholders(sql) {
  let paramIndex = 1;
  let inString = false;
  let result = '';

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (char === "'") {
      // Toggle string literal boundary (ignoring escaped quotes '')
      if (inString && sql[i + 1] === "'") {
        result += "''";
        i++;
        continue;
      }
      inString = !inString;
      result += char;
    } else if (char === '?' && !inString) {
      result += `$${paramIndex++}`;
    } else {
      result += char;
    }
  }

  return result;
}

// Helper functions to wrap database queries in Promises
export const dbRun = async (query, params = []) => {
  if (isPostgres) {
    let sql = query
      .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY')
      .replace(/DATETIME DEFAULT CURRENT_TIMESTAMP/g, 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    
    if (sql.trim().toUpperCase().startsWith('INSERT') && !sql.toUpperCase().includes('RETURNING')) {
      sql += ' RETURNING id';
    }
    
    sql = convertSqlPlaceholders(sql);
    const res = await pgPool.query(sql, params);
    return {
      id: res.rows[0]?.id || null,
      changes: res.rowCount
    };
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

export const dbGet = async (query, params = []) => {
  if (isPostgres) {
    const sql = convertSqlPlaceholders(query);
    const res = await pgPool.query(sql, params);
    return res.rows[0] || null;
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

export const dbAll = async (query, params = []) => {
  if (isPostgres) {
    const sql = convertSqlPlaceholders(query);
    const res = await pgPool.query(sql, params);
    return res.rows;
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

/**
 * Health check probe for database connectivity
 */
export const dbPing = async () => {
  try {
    const res = await dbGet('SELECT 1 as alive');
    return Boolean(res && (res.alive == 1 || res.alive === '1'));
  } catch (err) {
    logger.error('Database health ping failed:', err);
    return false;
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
      logger.info('Database migration: Added display_name column to users table.');
    } catch (e) {
      // Column already exists
    }

    try {
      await dbRun('ALTER TABLE users ADD COLUMN avatar_icon TEXT');
      logger.info('Database migration: Added avatar_icon column to users table.');
    } catch (e) {
      // Column already exists
    }

    try {
      await dbRun('ALTER TABLE users ADD COLUMN theme_color TEXT');
      logger.info('Database migration: Added theme_color column to users table.');
    } catch (e) {
      // Column already exists
    }

    // Create Deleted Messages Per User Table (stores per-user message deletion)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS deleted_messages_user (
        message_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        PRIMARY KEY (message_id, username)
      )
    `);

    // Create Blocked Users Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS blocked_users (
        username TEXT NOT NULL,
        blocked_username TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (username, blocked_username)
      )
    `);

    // Database indexes for high performance query resolution
    await dbRun('CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(sender, recipient)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_messages_pending ON messages(recipient, delivered)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_deleted_messages_user ON deleted_messages_user(username, message_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_blocked_users ON blocked_users(username, blocked_username)');

    logger.info('Database tables and performance indexes initialized successfully.');
  } catch (error) {
    logger.error('Error initializing database tables:', error);
    process.exit(1);
  }
};

export default db;
