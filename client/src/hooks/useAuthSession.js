import { useState, useEffect, useCallback } from 'react';
import { applyThemeTokens } from '../utils/themeTokens';
import { base64ToBuffer, decryptRestoredPrivateKeys } from '../services/crypto';

export function useAuthSession() {
  const [currentUser, setCurrentUser] = useState(null); // { username, token, keys }
  const [isRestoring, setIsRestoring] = useState(() => {
    try {
      const token = localStorage.getItem('chatra_token');
      const username = localStorage.getItem('chatra_username');
      const sessionEncKeyBase64 = localStorage.getItem('session_enc_key');
      const encPrivateKeysStr = localStorage.getItem('chatra_encrypted_private_keys');
      return !!(token && username && sessionEncKeyBase64 && encPrivateKeysStr);
    } catch (e) {
      return false;
    }
  });
  const [isPreloaderFading, setIsPreloaderFading] = useState(false);

  // Restore E2EE session on mount
  useEffect(() => {
    const restoreSession = async () => {
      const savedRgb = localStorage.getItem('chatra_theme_rgb');
      if (savedRgb) {
        applyThemeTokens(savedRgb);
      }

      const token = localStorage.getItem('chatra_token');
      const username = localStorage.getItem('chatra_username');
      const sessionEncKeyBase64 = localStorage.getItem('session_enc_key');
      const encPrivateKeysStr = localStorage.getItem('chatra_encrypted_private_keys');
      const pubIdentityKeyStr = localStorage.getItem('chatra_public_identity_key');
      const pubSigningKeyStr = localStorage.getItem('chatra_public_signing_key');
      const displayName = localStorage.getItem('chatra_display_name') || null;
      const avatarIcon = localStorage.getItem('chatra_avatar_icon') || null;

      if (token && username && sessionEncKeyBase64 && encPrivateKeysStr && pubIdentityKeyStr && pubSigningKeyStr) {
        try {
          const rawKeyBytes = base64ToBuffer(sessionEncKeyBase64);
          const backupKey = await window.crypto.subtle.importKey(
            'raw',
            rawKeyBytes,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
          );

          const encryptedPrivateKeys = JSON.parse(encPrivateKeysStr);
          const decryptedKeys = await decryptRestoredPrivateKeys(encryptedPrivateKeys, backupKey);

          setCurrentUser({
            username,
            token,
            displayName,
            avatarIcon,
            themeColor: localStorage.getItem('chatra_theme_rgb') || null,
            encryptedPrivateKeys,
            keys: {
              publicIdentityKey: JSON.parse(pubIdentityKeyStr),
              publicSigningKey: JSON.parse(pubSigningKeyStr),
              privateIdentityKey: decryptedKeys.identityPrivateKey,
              privateSigningKey: decryptedKeys.signingPrivateKey
            }
          });
          setIsPreloaderFading(true);
          setTimeout(() => {
            setIsRestoring(false);
            setIsPreloaderFading(false);
          }, 260);
          console.log('E2EE Session restored successfully.');
        } catch (err) {
          console.error('Failed to restore session:', err);
          localStorage.removeItem('chatra_token');
          setIsRestoring(false);
          setIsPreloaderFading(false);
        }
      } else {
        setIsRestoring(false);
        setIsPreloaderFading(false);
      }
    };

    restoreSession();
  }, []);

  // On mobile/touch devices, blur clicked buttons to prevent lingering hover states
  useEffect(() => {
    const handleTouchEnd = (e) => {
      if (e.target.closest('button, [role="button"], .back-btn, .header-action-btn, .sidebar-settings-btn, .sidebar-calls-btn, .input-circle-btn, .scroll-to-bottom-btn, .cvp-btn, .cvp-center-btn, .cvp-controls button')) {
        setTimeout(() => {
          if (document.activeElement && (document.activeElement.tagName === 'BUTTON' || document.activeElement.getAttribute('role') === 'button')) {
            document.activeElement.blur();
          }
        }, 50);
      }
    };
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => window.removeEventListener('touchend', handleTouchEnd);
  }, []);

  // Apply theme preferences synchronously on boot
  useEffect(() => {
    const savedRgb = localStorage.getItem('chatra_theme_rgb');
    if (savedRgb) {
      applyThemeTokens(savedRgb);
    }

    const glass = localStorage.getItem('chatra_glass') !== 'false';
    if (!glass) {
      document.body.classList.add('flat-theme');
    } else {
      document.body.classList.remove('flat-theme');
    }
  }, []);

  // Persist currentUser details to localStorage and apply theme
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('chatra_username', currentUser.username);
      localStorage.setItem('chatra_token', currentUser.token);
      if (currentUser.encryptedPrivateKeys) {
        localStorage.setItem('chatra_encrypted_private_keys', typeof currentUser.encryptedPrivateKeys === 'string' ? currentUser.encryptedPrivateKeys : JSON.stringify(currentUser.encryptedPrivateKeys));
      }
      localStorage.setItem('chatra_public_identity_key', JSON.stringify(currentUser.keys.publicIdentityKey));
      localStorage.setItem('chatra_public_signing_key', JSON.stringify(currentUser.keys.publicSigningKey));
      
      if (currentUser.displayName) {
        localStorage.setItem('chatra_display_name', currentUser.displayName);
      } else {
        localStorage.removeItem('chatra_display_name');
      }
      
      if (currentUser.avatarIcon) {
        localStorage.setItem('chatra_avatar_icon', currentUser.avatarIcon);
      } else {
        localStorage.removeItem('chatra_avatar_icon');
      }

      if (currentUser.themeColor) {
        localStorage.setItem('chatra_theme_rgb', currentUser.themeColor);
        applyThemeTokens(currentUser.themeColor);
      }
    }
  }, [currentUser]);

  const clearUserSession = useCallback(() => {
    localStorage.removeItem('session_enc_key');
    localStorage.removeItem('chatra_username');
    localStorage.removeItem('chatra_token');
    localStorage.removeItem('chatra_encrypted_private_keys');
    localStorage.removeItem('chatra_public_identity_key');
    localStorage.removeItem('chatra_public_signing_key');
    localStorage.removeItem('chatra_display_name');
    localStorage.removeItem('chatra_avatar_icon');
    localStorage.removeItem('chatra_active_view');
    localStorage.removeItem('chatra_active_contact');
    setCurrentUser(null);
  }, []);

  return {
    currentUser,
    setCurrentUser,
    isRestoring,
    isPreloaderFading,
    clearUserSession
  };
}

export default useAuthSession;
