import React, { useState, useEffect, useRef } from 'react';
import { Shield, User, Lock, KeyRound, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import ZapLogo from './ZapLogo';
import { deriveKeysFromPassword, generateKeyPairs, encryptAndBackupPrivateKeys, decryptRestoredPrivateKeys, generateRandomSalt } from '../services/crypto';
import { registerUser, loginUser, fetchAuthSalt } from '../services/api';
import { useElasticBounce } from '../hooks/useElasticBounce';

export default function Login({ onAuthSuccess }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Track input focus state without flicker when switching fields
  const [isFocused, setIsFocused] = useState(false);
  const isKeyboardOpenRef = useRef(false);
  const maxViewportHeightRef = useRef(
    typeof window !== 'undefined' && window.visualViewport ? window.visualViewport.height : 800
  );
  const focusTimeout = useRef(null);
  const authContainerRef = useRef(null);
  const authCardRef = useRef(null);

  useElasticBounce(authContainerRef, authCardRef);

  const handleFocus = () => {
    if (focusTimeout.current) {
      clearTimeout(focusTimeout.current);
      focusTimeout.current = null;
    }
    setIsFocused(true);
  };

  const handleBlur = (e) => {
    // If focus is moving to another input/button in the auth card (e.g. username -> password),
    // do NOT blur and do NOT toggle isFocused. This completely eliminates flickering!
    if (e?.relatedTarget && authCardRef.current?.contains(e.relatedTarget)) {
      return;
    }

    if (focusTimeout.current) clearTimeout(focusTimeout.current);
    focusTimeout.current = setTimeout(() => {
      const activeEl = document.activeElement;
      if (!authCardRef.current?.contains(activeEl)) {
        setIsFocused(false);
      }
    }, 150);
  };

  // Keyboard close & back gesture detector (Android back button, gesture navigation, dismiss)
  useEffect(() => {
    const handleViewportChange = () => {
      const vv = window.visualViewport;
      const currentHeight = vv ? vv.height : window.innerHeight;

      // Update baseline when no inputs are focused (e.g. orientation changes, screen resize)
      if (!document.activeElement || (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA')) {
        maxViewportHeightRef.current = Math.max(maxViewportHeightRef.current, currentHeight);
      }

      // Detect if keyboard is open based on significant height drop (> 120px)
      const heightDifference = maxViewportHeightRef.current - currentHeight;
      const isKeyboardNowOpen = heightDifference > 120;

      if (isKeyboardNowOpen) {
        isKeyboardOpenRef.current = true;
        setIsFocused(true);
      } else {
        // Keyboard has closed (e.g. Android back gesture, keyboard dismiss)
        const wasOpen = isKeyboardOpenRef.current;
        isKeyboardOpenRef.current = false;

        // ONLY if the keyboard was previously open and has now closed
        if (wasOpen) {
          if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
            document.activeElement.blur();
          }
          setIsFocused(false);
        }
      }
    };

    const handlePopState = () => {
      // Android system back gesture / button pops history
      if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
        document.activeElement.blur();
      }
      isKeyboardOpenRef.current = false;
      setIsFocused(false);
    };

    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('popstate', handlePopState);
      if (focusTimeout.current) clearTimeout(focusTimeout.current);
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanUsername = username.trim();
    if (!cleanUsername || !password) {
      setError('Please enter a valid username and password');
      return;
    }

    if (cleanUsername.length < 3 || cleanUsername.length > 20) {
      setError('Username must be 3-20 characters long');
      return;
    }

    if (isRegister) {
      if (password.length < 6) {
        setError('Password must be at least 6 characters long for security');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match. Please verify and try again.');
        return;
      }
    }
    
    setLoading(true);
    setError('');

    try {
      if (isRegister) {
        // 1. Generate a CSPRNG 16-byte random salt for new account registration
        const authSalt = generateRandomSalt();
        const { loginHash, encryptionKey } = await deriveKeysFromPassword(password, cleanUsername, authSalt);

        // 2. Generate new identity and signing key pairs
        const { identityKeyPair, signingKeyPair } = await generateKeyPairs();

        // 3. Encrypt private keys with derived password encryption key
        const backup = await encryptAndBackupPrivateKeys(
          identityKeyPair.privateKey,
          signingKeyPair.privateKey,
          encryptionKey
        );

        // 4. Export public keys as JWKs for server storage
        const publicIdentityKey = await window.crypto.subtle.exportKey('jwk', identityKeyPair.publicKey);
        const publicSigningKey = await window.crypto.subtle.exportKey('jwk', signingKeyPair.publicKey);

        // 5. Send registration request to server with random salt
        const data = await registerUser(
          cleanUsername,
          loginHash,
          publicIdentityKey,
          publicSigningKey,
          backup,
          authSalt
        );

        // 5. Store derived key in localStorage safely
        const rawKey = await window.crypto.subtle.exportKey('raw', encryptionKey);
        const bytes = new Uint8Array(rawKey);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64Key = btoa(binary);
        
        try {
          localStorage.setItem('session_enc_key', base64Key);
        } catch (e) {
          console.warn('LocalStorage quota restricted session_enc_key persist');
        }

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
        // Login flow: Fetch the user's random salt (or fallback to legacy null)
        const authSalt = await fetchAuthSalt(cleanUsername);
        const { loginHash, encryptionKey } = await deriveKeysFromPassword(password, cleanUsername, authSalt);

        const data = await loginUser(cleanUsername, loginHash);

        // Re-import the backup key
        const rawKey = await window.crypto.subtle.exportKey('raw', encryptionKey);
        const bytes = new Uint8Array(rawKey);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64Key = btoa(binary);

        try {
          localStorage.setItem('session_enc_key', base64Key);
        } catch (e) {
          console.warn('LocalStorage quota restricted session_enc_key persist');
        }

        // Decrypt the returned private keys
        const decryptedKeys = await decryptRestoredPrivateKeys(data.user.encryptedPrivateKeys, encryptionKey);

        onAuthSuccess({
          username: data.user.username,
          displayName: data.user.displayName || null,
          avatarIcon: data.user.avatarIcon || null,
          themeColor: data.user.themeColor || null,
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
    <div className="auth-wrapper" ref={authContainerRef}>
      <div className={`auth-card glass ${isFocused ? 'inputs-focused' : ''}`} ref={authCardRef}>
        <div className="auth-logo">
          <ZapLogo size={64} />
          <h1>ZAP</h1>
          <p>Anonymous End-to-End Encrypted Chat</p>
        </div>

        <div className={`auth-error-container ${error ? 'visible' : ''}`}>
          <div className="auth-error">
            <AlertTriangle size={18} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <div className="input-container">
              <User size={20} />
              <input
                id="username"
                type="text"
                placeholder="Choose username"
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
              <Lock size={20} />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={handleFocus}
                onBlur={handleBlur}
                required
                disabled={loading}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword(p => !p)}
                tabIndex="-1"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {isRegister && (
            <div className="form-group">
              <label htmlFor="confirm-password">Confirm Password</label>
              <div className="input-container">
                <Lock size={20} />
                <input
                  id="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                  required
                  disabled={loading}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowConfirmPassword(p => !p)}
                  tabIndex="-1"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
          )}

          <div className={`warning-box-container ${isRegister ? 'visible' : ''}`}>
            <div className="warning-box">
              <AlertTriangle size={16} style={{ float: 'left', marginRight: '8px', marginTop: '2px' }} />
              <strong>Warning:</strong> ZAP uses Zero-Knowledge encryption. 
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
              <span onClick={() => { setIsRegister(false); setError(''); setConfirmPassword(''); }}>Login here</span>
            </>
          ) : (
            <>
              New to ZAP?{' '}
              <span onClick={() => { setIsRegister(true); setError(''); setConfirmPassword(''); }}>Create account</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
