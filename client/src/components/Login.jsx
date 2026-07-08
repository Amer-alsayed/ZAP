import React, { useState, useEffect, useRef } from 'react';
import { Shield, User, Lock, KeyRound, AlertTriangle } from 'lucide-react';
import { deriveKeysFromPassword, generateKeyPairs, encryptAndBackupPrivateKeys, decryptRestoredPrivateKeys } from '../services/crypto';
import { registerUser, loginUser } from '../services/api';

export default function Login({ onAuthSuccess }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Track input focus state with delay to prevent switching focus flickering
  const [isFocused, setIsFocused] = useState(false);
  const focusTimeout = useRef(null);
  const isKeyboardOpen = useRef(false);

  const handleFocus = () => {
    if (focusTimeout.current) {
      clearTimeout(focusTimeout.current);
      focusTimeout.current = null;
    }
    setIsFocused(true);
  };

  const handleBlur = () => {
    focusTimeout.current = setTimeout(() => {
      setIsFocused(false);
    }, 150); // 150ms buffer to switch focus smoothly without logo flicker
  };

  // Safe keyboard close detector (blurs inputs only when viewport expands after keyboard was open)
  useEffect(() => {
    const handleResize = () => {
      const vv = window.visualViewport;
      if (!vv) return;

      if (vv.height < window.innerHeight * 0.8) {
        // Keyboard is fully open
        isKeyboardOpen.current = true;
      } else if (isKeyboardOpen.current && vv.height >= window.innerHeight * 0.95) {
        // Keyboard was open and is now closed
        isKeyboardOpen.current = false;
        if (document.activeElement && (document.activeElement.tagName === 'INPUT')) {
          document.activeElement.blur();
        }
      }
    };

    window.visualViewport?.addEventListener('resize', handleResize);
    return () => {
      window.visualViewport?.removeEventListener('resize', handleResize);
      if (focusTimeout.current) clearTimeout(focusTimeout.current);
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) return;
    
    setLoading(true);
    setError('');

    try {
      const { loginHash, encryptionKey } = await deriveKeysFromPassword(password, username);

      if (isRegister) {
        // 1. Generate new identity and signing key pairs
        const { identityKeyPair, signingKeyPair } = await generateKeyPairs();

        // 2. Encrypt private keys with derived password encryption key
        const backup = await encryptAndBackupPrivateKeys(
          identityKeyPair.privateKey,
          signingKeyPair.privateKey,
          encryptionKey
        );

        // 3. Export public keys as JWKs for server storage
        const publicIdentityKey = await window.crypto.subtle.exportKey('jwk', identityKeyPair.publicKey);
        const publicSigningKey = await window.crypto.subtle.exportKey('jwk', signingKeyPair.publicKey);

        // 4. Send registration request to server
        const data = await registerUser(
          username,
          loginHash,
          publicIdentityKey,
          publicSigningKey,
          backup
        );

        // 5. Store derived key in localStorage
        // We export it to raw bytes and encode to base64 to store it
        const rawKey = await window.crypto.subtle.exportKey('raw', encryptionKey);
        const base64Key = btoa(String.fromCharCode(...new Uint8Array(rawKey)));
        localStorage.setItem('session_enc_key', base64Key);

        onAuthSuccess({
          username: data.user.username,
          token: data.token,
          encryptedPrivateKeys: backup,
          keys: {
            publicIdentityKey,
            publicSigningKey,
            privateIdentityKey: identityKeyPair.privateKey,
            privateSigningKey: signingKeyPair.privateKey
          }
        });
      } else {
        // Login flow
        const data = await loginUser(username, loginHash);

        // Re-import the backup key
        const rawKey = await window.crypto.subtle.exportKey('raw', encryptionKey);
        const base64Key = btoa(String.fromCharCode(...new Uint8Array(rawKey)));
        localStorage.setItem('session_enc_key', base64Key);

        // Decrypt the returned private keys
        const decryptedKeys = await decryptRestoredPrivateKeys(data.user.encryptedPrivateKeys, encryptionKey);

        onAuthSuccess({
          username: data.user.username,
          token: data.token,
          encryptedPrivateKeys: data.user.encryptedPrivateKeys,
          keys: {
            publicIdentityKey: data.user.publicIdentityKey,
            publicSigningKey: data.user.publicSigningKey,
            privateIdentityKey: decryptedKeys.identityPrivateKey,
            privateSigningKey: decryptedKeys.signingPrivateKey
          }
        });
      }
    } catch (err) {
      console.error(err);
      setError(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className={`auth-card glass ${isFocused ? 'inputs-focused' : ''}`}>
        <div className="auth-logo">
          <Shield size={44} strokeWidth={1.5} />
          <h1>Chatra</h1>
          <p>Anonymous End-to-End Encrypted Chat</p>
        </div>

        <div className={`auth-error-container ${error ? 'visible' : ''}`}>
          <div className="auth-error">
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <div className="input-container">
              <User size={18} />
              <input
                id="username"
                type="text"
                placeholder="Enter unique username"
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                onFocus={handleFocus}
                onBlur={handleBlur}
                required
                disabled={loading}
                autoComplete="username"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div className="input-container">
              <Lock size={18} />
              <input
                id="password"
                type="password"
                placeholder="Enter strong password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={handleFocus}
                onBlur={handleBlur}
                required
                disabled={loading}
                autoComplete="current-password"
              />
            </div>
          </div>

          <div className={`warning-box-container ${isRegister ? 'visible' : ''}`}>
            <div className="warning-box">
              <AlertTriangle size={16} style={{ float: 'left', marginRight: '8px', marginTop: '2px' }} />
              <strong>Warning:</strong> Chatra uses Zero-Knowledge encryption. 
              If you lose your password, your private key and chat history CANNOT be recovered.
            </div>
          </div>

          <button className="auth-btn" type="submit" disabled={loading}>
            {loading ? 'Processing Cryptography...' : isRegister ? 'Create Anonymous Account' : 'Secure Login'}
          </button>
        </form>

        <div className="auth-toggle">
          {isRegister ? (
            <>
              Already have an account?{' '}
              <span onClick={() => { setIsRegister(false); setError(''); }}>Login here</span>
            </>
          ) : (
            <>
              New to Chatra?{' '}
              <span onClick={() => { setIsRegister(true); setError(''); }}>Create account</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
