import config from './config.js';

const SENSITIVE_KEYS = [
  'password',
  'loginhash',
  'encryptedprivatekeys',
  'password_hash',
  'token',
  'authorization',
  'secret'
];

/**
 * Recursively redacts sensitive keys from log data objects and formats Error instances
 */
function sanitize(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (obj instanceof Error) {
    return {
      name: obj.name,
      message: obj.message,
      stack: obj.stack
    };
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitize);
  }

  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
      clean[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      clean[key] = sanitize(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

function formatLog(level, message, meta) {
  const timestamp = new Date().toISOString();
  if (meta !== undefined) {
    const cleanMeta = typeof meta === 'object' ? JSON.stringify(sanitize(meta)) : meta;
    return `[${timestamp}] [${level.toUpperCase()}] ${message} ${cleanMeta}`;
  }
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
}

export const logger = {
  info: (message, meta) => {
    console.log(formatLog('info', message, meta));
  },
  warn: (message, meta) => {
    console.warn(formatLog('warn', message, meta));
  },
  error: (message, meta) => {
    console.error(formatLog('error', message, meta));
  },
  debug: (message, meta) => {
    if (!config.isProd) {
      console.log(formatLog('debug', message, meta));
    }
  }
};

export default logger;
