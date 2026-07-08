const BASE_URL = '';

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

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Registration failed');
  }
  return data;
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

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Login failed');
  }
  return data;
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

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'User not found');
  }
  return data;
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

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'File upload failed');
  }
  return data;
};

export { BASE_URL };
