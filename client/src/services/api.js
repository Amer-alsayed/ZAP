const BASE_URL = '';

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
 * Register a new user anonymously.
 */
export const registerUser = async (username, loginHash, publicIdentityKey, publicSigningKey, encryptedPrivateKeys) => {
  const response = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      loginHash,
      publicIdentityKey,
      publicSigningKey,
      encryptedPrivateKeys
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
 * Search for a user by username.
 */
export const searchUser = async (username, token) => {
  const response = await fetch(`${BASE_URL}/api/auth/search?username=${encodeURIComponent(username)}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });

  return parseJsonResponse(response, 'User not found');
};

/**
 * Upload an encrypted file to the server.
 * @param {string} filename 
 * @param {string} fileDataBase64 
 * @param {string} token 
 * @param {Function} [onProgress]
 * @param {{ current: Function|null }} [cancelRef] - receives an abort() handle in `.current`
 * @returns {Promise<{ fileUrl: string }>}
 */
export const uploadEncryptedFile = (filename, fileDataBase64, token, onProgress, cancelRef) => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE_URL}/api/upload`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    if (cancelRef && typeof cancelRef === 'object') {
      cancelRef.current = () => xhr.abort();
    }
    const clearCancelHandle = () => {
      if (cancelRef && typeof cancelRef === 'object') {
        cancelRef.current = null;
      }
    };

    if (xhr.upload && typeof onProgress === 'function') {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = (event.loaded / event.total) * 100;
          onProgress(percent);
        }
      };
    }

    xhr.onload = () => {
      clearCancelHandle();
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch (e) {
        if (xhr.status >= 200 && xhr.status < 300) {
          return resolve(data);
        }
        return reject(new Error(`File upload failed (Server returned ${xhr.status})`));
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        reject(new Error(data?.error || `File upload failed (${xhr.status})`));
      }
    };

    xhr.onerror = () => {
      clearCancelHandle();
      reject(new Error('Network error during file upload'));
    };

    xhr.onabort = () => {
      clearCancelHandle();
      const err = new Error('File upload was aborted');
      err.isCancelled = true;
      reject(err);
    };

    xhr.send(JSON.stringify({ filename, fileData: fileDataBase64 }));
  });
};

export { BASE_URL };
