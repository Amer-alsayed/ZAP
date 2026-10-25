import { BASE_URL } from './baseUrl.js';

/**
 * Client-side session token manager.
 *
 * - The short-lived access token (JWT) and the long-lived refresh token live in
 *   localStorage, which is the single source of truth shared by all open tabs.
 * - Access tokens are renewed silently before they expire; callers never see expiry.
 * - The user is only signed out when the server *definitively* rejects the
 *   refresh token (HTTP 401: signed out elsewhere, password changed, account gone).
 *   Network failures, server cold starts and 5xx errors never end the session.
 * - Refreshes are de-duplicated within a tab and serialised across tabs with the
 *   Web Locks API so concurrent tabs never race each other's token rotation.
 */

const ACCESS_TOKEN_KEY = 'zap_token';
const REFRESH_TOKEN_KEY = 'zap_refresh_token';
const LEGACY_ACCESS_TOKEN_KEY = 'chatra_token';
const REFRESH_LOCK_NAME = 'zap-auth-refresh';

/** Refresh this long before the access token actually expires (absorbs clock skew). */
const EXPIRY_SKEW_MS = 60 * 1000;

export class SessionInvalidError extends Error {
  constructor(reason = 'SESSION_INVALID', message = 'Your session has ended. Please sign in again.') {
    super(message);
    this.name = 'SessionInvalidError';
    this.reason = reason;
  }
}

export class TransientAuthError extends Error {
  constructor(message = 'Unable to reach the server to renew your session.') {
    super(message);
    this.name = 'TransientAuthError';
  }
}

// ------------------------------------------------------------------
// Storage helpers
// ------------------------------------------------------------------

const readStorage = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    console.warn(`Failed to persist ${key}:`, err);
  }
};

const removeStorage = (key) => {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
};

export const getAccessToken = () => readStorage(ACCESS_TOKEN_KEY) || readStorage(LEGACY_ACCESS_TOKEN_KEY);
export const getRefreshToken = () => readStorage(REFRESH_TOKEN_KEY);
export const hasStoredSession = () => Boolean(getRefreshToken() || getAccessToken());

/**
 * Persist tokens returned by register / login / refresh endpoints.
 * @param {{ token?: string, refreshToken?: string }} tokens
 */
export const storeSessionTokens = ({ token, refreshToken } = {}) => {
  if (token) {
    writeStorage(ACCESS_TOKEN_KEY, token);
    removeStorage(LEGACY_ACCESS_TOKEN_KEY);
  }
  if (refreshToken) {
    writeStorage(REFRESH_TOKEN_KEY, refreshToken);
  }
  invalidationNotified = false;
};

export const clearSessionTokens = () => {
  removeStorage(ACCESS_TOKEN_KEY);
  removeStorage(REFRESH_TOKEN_KEY);
  removeStorage(LEGACY_ACCESS_TOKEN_KEY);
};

// ------------------------------------------------------------------
// Session invalidation notifications
// ------------------------------------------------------------------

const invalidationListeners = new Set();
let invalidationNotified = false;

/**
 * Subscribe to definitive session loss (the app should sign the user out).
 * @param {(reason: string) => void} callback
 * @returns {() => void} unsubscribe
 */
export const onSessionInvalidated = (callback) => {
  invalidationListeners.add(callback);
  return () => invalidationListeners.delete(callback);
};

const invalidateSession = (reason) => {
  const error = new SessionInvalidError(reason);
  if (!invalidationNotified) {
    invalidationNotified = true;
    for (const cb of invalidationListeners) {
      try {
        cb(reason);
      } catch (err) {
        console.error('Session invalidation listener failed:', err);
      }
    }
  }
  return error;
};

// ------------------------------------------------------------------
// Access token inspection
// ------------------------------------------------------------------

const getTokenExpiryMs = (token) => {
  try {
    const payloadPart = token.split('.')[1];
    const json = atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json);
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
};

export const isAccessTokenFresh = (token, skewMs = EXPIRY_SKEW_MS) => {
  if (!token) return false;
  const exp = getTokenExpiryMs(token);
  if (exp === null) return true; // Non-expiring / opaque token: let the server decide
  return exp - skewMs > Date.now();
};

// ------------------------------------------------------------------
// Refresh flow
// ------------------------------------------------------------------

const postJson = async (path, body, headers = {}, maxRetries = 2) => {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body || {}),
        cache: 'no-store'
      });
      // Absorb cloud cold starts (e.g. Render / Neon waking up returning 502/503/504)
      if (response.status >= 502 && response.status <= 504 && attempt < maxRetries) {
        await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
        continue;
      }
      return response;
    } catch {
      if (attempt < maxRetries) {
        await new Promise((res) => setTimeout(res, 1200 * (attempt + 1)));
        continue;
      }
      throw new TransientAuthError();
    }
  }
  throw new TransientAuthError();
};

const readJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

/**
 * One-time migration for sessions created before refresh tokens existed:
 * exchange a still-valid legacy access token for a persistent session.
 */
const upgradeLegacySession = async (legacyToken) => {
  const response = await postJson('/api/auth/session', {}, { Authorization: `Bearer ${legacyToken}` });
  if (response.ok) {
    const data = await readJson(response);
    if (!data?.token || !data?.refreshToken) throw new TransientAuthError('Invalid session upgrade response');
    storeSessionTokens(data);
    return data.token;
  }
  if (response.status === 401) {
    const data = await readJson(response);
    throw invalidateSession(data?.code || 'LEGACY_TOKEN_EXPIRED');
  }
  throw new TransientAuthError(`Session upgrade failed (${response.status})`);
};

const performRefresh = async (rejectedAccessToken, attempt = 0) => {
  // Another tab may have refreshed while we were waiting for the lock.
  const current = getAccessToken();
  if (current && current !== rejectedAccessToken && isAccessTokenFresh(current)) {
    return current;
  }

  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    if (current) {
      return upgradeLegacySession(current);
    }
    throw invalidateSession('NO_REFRESH_TOKEN');
  }

  const response = await postJson('/api/auth/refresh', { refreshToken });

  if (response.ok) {
    const data = await readJson(response);
    if (!data?.token || !data?.refreshToken) throw new TransientAuthError('Invalid refresh response');
    storeSessionTokens(data);
    return data.token;
  }

  // If another tab rotated the refresh token meanwhile, retry with the newer one.
  const tokenChangedMeanwhile = getRefreshToken() && getRefreshToken() !== refreshToken;
  if ((response.status === 401 || response.status === 409) && tokenChangedMeanwhile && attempt < 2) {
    return performRefresh(rejectedAccessToken, attempt + 1);
  }

  if (response.status === 401) {
    const data = await readJson(response);
    throw invalidateSession(data?.code || 'SESSION_REVOKED');
  }

  if (response.status === 409 && attempt < 2) {
    await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    return performRefresh(rejectedAccessToken, attempt + 1);
  }

  throw new TransientAuthError(`Session refresh failed (${response.status})`);
};

const runExclusive = (task) => {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(REFRESH_LOCK_NAME, { mode: 'exclusive' }, task);
  }
  return task();
};

let inflightRefresh = null;

/**
 * Obtain a new access token from the server.
 * @param {string|null} rejectedAccessToken - token the server just rejected (if any)
 * @returns {Promise<string>} fresh access token
 * @throws {SessionInvalidError|TransientAuthError}
 */
export const refreshAccessToken = (rejectedAccessToken = getAccessToken()) => {
  if (!inflightRefresh) {
    inflightRefresh = runExclusive(() => performRefresh(rejectedAccessToken)).finally(() => {
      inflightRefresh = null;
    });
  }
  return inflightRefresh;
};

/**
 * Return an access token that is valid for at least the skew window, refreshing if needed.
 * @returns {Promise<string>}
 */
export const getValidAccessToken = async () => {
  const token = getAccessToken();
  if (token && isAccessTokenFresh(token) && getRefreshToken()) {
    return token;
  }
  return refreshAccessToken(token);
};

/**
 * fetch() wrapper that attaches a valid bearer token and transparently
 * refreshes + retries once when the server reports an expired/invalid token.
 */
export const authorizedFetch = async (url, options = {}) => {
  const send = (token) =>
    fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
    });

  const token = await getValidAccessToken();
  const response = await send(token);
  if (response.status !== 401) return response;

  const renewed = await refreshAccessToken(token);
  return send(renewed);
};

/**
 * Revoke the current session on the server (best effort) and clear local tokens.
 * Reads the refresh token synchronously so it is safe to clear storage right after calling.
 */
export const logoutSession = () => {
  const refreshToken = getRefreshToken();
  clearSessionTokens();
  invalidationNotified = true; // Suppress "session ended" notices for an intentional sign-out
  if (!refreshToken) return Promise.resolve();

  return fetch(`${BASE_URL}/api/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    keepalive: true
  }).catch((err) => {
    console.warn('Server-side session revocation failed; local session was cleared:', err);
  });
};
