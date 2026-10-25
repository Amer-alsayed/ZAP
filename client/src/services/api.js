import { BASE_URL } from './baseUrl.js';
import { authorizedFetch, getValidAccessToken, refreshAccessToken } from './tokenManager.js';

/**
 * Helper to safely parse JSON response and provide meaningful error messages on HTTP errors or non-JSON returns.
 */
const parseJsonResponse = async (response, fallbackErrorMessage) => {
  let data = null;
  try {
    data = await response.json();
  } catch (e) {
    if (!response.ok) {
      throw new Error(`${fallbackErrorMessage} (Server returned ${response.status} ${response.statusText || 'Error'})`);
    }
    throw new Error('Invalid JSON response format received from server');
  }

  if (!response.ok) {
    throw new Error(data?.error || `${fallbackErrorMessage} (${response.status})`);
  }
  return data;
};

/**
 * Fetch a user's authentication salt with automated retry for cloud wake-ups (e.g. Render cold start).
 * Returns string salt for existing/new users, null explicitly for legacy accounts.
 * Throws on network, rate-limit, or server failure to prevent generating corrupt fallback hashes.
 */
export const fetchAuthSalt = async (username, maxRetries = 2) => {
  if (!username) return null;

  const url = `${BASE_URL}/api/auth/salt/${encodeURIComponent(username.trim())}`;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url);

      if (response.status === 429) {
        let errorMsg = 'Too many attempts. Please wait 15 minutes before trying again.';
        try {
          const data = await response.json();
          if (data?.error) errorMsg = data.error;
        } catch (_) {}
        throw new Error(errorMsg);
      }

      // If server is waking up (502, 503, 504), wait and retry
      if (response.status >= 502 && response.status <= 504 && attempt < maxRetries) {
        await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
        continue;
      }

      if (!response.ok) {
        throw new Error(`Authentication server error (${response.status}). Please try again.`);
      }

      const data = await response.json();
      // Explicitly return authSalt if present (or null if the server returned { authSalt: null } for legacy accounts)
      return data?.authSalt !== undefined ? data.authSalt : null;
    } catch (err) {
      lastError = err;
      // Do not retry rate-limit errors
      if (err.message && err.message.includes('Too many')) {
        throw err;
      }
      if (attempt < maxRetries) {
        await new Promise((res) => setTimeout(res, 1200 * (attempt + 1)));
      }
    }
  }

  throw new Error(
    lastError?.message?.includes('Failed to fetch') || lastError?.name === 'TypeError'
      ? 'Unable to reach the server. It may be waking up from sleep; please try again in a few seconds.'
      : (lastError?.message || 'Failed to retrieve authentication information from server.')
  );
};

/**
 * Register a new user anonymously.
 */
export const registerUser = async (username, loginHash, publicIdentityKey, publicSigningKey, encryptedPrivateKeys, authSalt = null) => {
  const response = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      loginHash,
      publicIdentityKey,
      publicSigningKey,
      encryptedPrivateKeys,
      authSalt
    })
  });

  return parseJsonResponse(response, 'Registration failed');
};

/**
 * Log in an existing user.
 */
export const loginUser = async (username, loginHash) => {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, loginHash })
  });

  return parseJsonResponse(response, 'Login failed');
};

/**
 * Change the user's password with Zero-Knowledge re-wrapped private keys.
 * Authentication is handled by the token manager (the legacy `token` argument is ignored).
 */
export const changeUserPassword = async (currentLoginHash, newLoginHash, encryptedPrivateKeys, authSalt, _token) => {
  const response = await authorizedFetch(`${BASE_URL}/api/auth/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      currentLoginHash,
      newLoginHash,
      encryptedPrivateKeys,
      authSalt
    })
  });

  return parseJsonResponse(response, 'Password change failed');
};

/**
 * Search for a user by username.
 * Authentication is handled by the token manager (the legacy `token` argument is ignored).
 */
export const searchUser = async (username, _token) => {
  const response = await authorizedFetch(`${BASE_URL}/api/auth/search?username=${encodeURIComponent(username)}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  return parseJsonResponse(response, 'User not found');
};

/**
 * Upload an encrypted file to the server.
 * A valid access token is obtained (and refreshed when needed) automatically;
 * the legacy `token` argument is ignored.
 * @param {string} filename 
 * @param {string} fileDataBase64 
 * @param {string} [_token] - deprecated, ignored
 * @param {Function} [onProgress]
 * @param {{ current: Function|null }} [cancelRef] - receives an abort() handle in `.current`
 * @returns {Promise<{ fileUrl: string }>}
 */
export const uploadEncryptedFile = async (filename, fileDataBase64, _token, onProgress, cancelRef) => {
  let cancelled = false;
  let activeAbort = null;

  if (cancelRef && typeof cancelRef === 'object') {
    cancelRef.current = () => {
      cancelled = true;
      if (activeAbort) activeAbort();
    };
  }

  const clearCancelHandle = () => {
    if (cancelRef && typeof cancelRef === 'object') {
      cancelRef.current = null;
    }
  };

  const abortedError = () => {
    const err = new Error('File upload was aborted');
    err.isCancelled = true;
    return err;
  };

  try {
    const token = await getValidAccessToken();
    if (cancelled) throw abortedError();
    try {
      return await sendUploadRequest(filename, fileDataBase64, token, onProgress, (abort) => { activeAbort = abort; });
    } catch (err) {
      if (err.status !== 401 || cancelled) throw err;
      // Access token was rejected (expired / server secret rotated): renew and retry once.
      const renewed = await refreshAccessToken(token);
      if (cancelled) throw abortedError();
      return await sendUploadRequest(filename, fileDataBase64, renewed, onProgress, (abort) => { activeAbort = abort; });
    }
  } finally {
    clearCancelHandle();
  }
};

const sendUploadRequest = (filename, fileDataBase64, token, onProgress, registerAbort) => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE_URL}/api/upload`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    registerAbort(() => xhr.abort());

    if (xhr.upload && typeof onProgress === 'function') {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = (event.loaded / event.total) * 100;
          onProgress(percent);
        }
      };
    }

    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch (e) {
        if (xhr.status >= 200 && xhr.status < 300) {
          return resolve(data);
        }
        const err = new Error(`File upload failed (Server returned ${xhr.status})`);
        err.status = xhr.status;
        return reject(err);
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        const err = new Error(data?.error || `File upload failed (${xhr.status})`);
        err.status = xhr.status;
        reject(err);
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error during file upload'));
    };

    xhr.onabort = () => {
      const err = new Error('File upload was aborted');
      err.isCancelled = true;
      reject(err);
    };

    xhr.send(JSON.stringify({ filename, fileData: fileDataBase64 }));
  });
};

export { BASE_URL };
