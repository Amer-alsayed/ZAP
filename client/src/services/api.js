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
 * @returns {Promise<{ fileUrl: string }>}
 */
export const uploadEncryptedFile = async (filename, fileDataBase64, token) => {
  const response = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ filename, fileData: fileDataBase64 })
  });

  return parseJsonResponse(response, 'File upload failed');
};

export { BASE_URL };
