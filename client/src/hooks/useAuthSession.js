import { useState, useEffect, useCallback } from 'react';
import { applyThemeTokens } from '../utils/themeTokens';
import { base64ToBuffer, decryptRestoredPrivateKeys } from '../services/crypto';

export function useAuthSession() {
  const [currentUser, setCurrentUser] = useState(null); // { username, token, keys }
  const [isRestoring, setIsRestoring] = useState(() => {
    try {
      const token = localStorage.getItem('zap_token') || localStorage.getItem('chatra_token');
      const username = localStorage.getItem('zap_username') || localStorage.getItem('chatra_username');
      const sessionEncKeyBase64 = localStorage.getItem('session_enc_key');
      const encPrivateKeysStr = localStorage.getItem('zap_encrypted_private_keys') || localStorage.getItem('chatra_encrypted_private_keys');
      return !!(token && username && sessionEncKeyBase64 && encPrivateKeysStr);
    } catch (e) {
      return false;
    }
  });
  const [isPreloaderFading, setIsPreloaderFading] = useState(false);

  // Restore E2EE session on mount
  useEffect(() => {
    const restoreSession = async () => {
      const savedRgb = localStorage.getItem('zap_theme_rgb') || localStorage.getItem('chatra_theme_rgb');
      if (savedRgb) {
        applyThemeTokens(savedRgb);
      }

      const token = localStorage.getItem('zap_token') || localStorage.getItem('chatra_token');
      const username = localStorage.getItem('zap_username') || localStorage.getItem('chatra_username');
      const sessionEncKeyBase64 = localStorage.getItem('session_enc_key');
      const encPrivateKeysStr = localStorage.getItem('zap_encrypted_private_keys') || localStorage.getItem('chatra_encrypted_private_keys');
      const pubIdentityKeyStr = localStorage.getItem('zap_public_identity_key') || localStorage.getItem('chatra_public_identity_key');
      const pubSigningKeyStr = localStorage.getItem('zap_public_signing_key') || localStorage.getItem('chatra_public_signing_key');
      const displayName = localStorage.getItem('zap_display_name') || localStorage.getItem('chatra_display_name') || null;
      const avatarIcon = localStorage.getItem('zap_avatar_icon') || localStorage.getItem('chatra_avatar_icon') || null;

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
            themeColor: localStorage.getItem('zap_theme_rgb') || localStorage.getItem('chatra_theme_rgb') || null,
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
          localStorage.removeItem('zap_token');
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
    const savedRgb = localStorage.getItem('zap_theme_rgb') || localStorage.getItem('chatra_theme_rgb');
    if (savedRgb) {
      applyThemeTokens(savedRgb);
    }

    const glass = (localStorage.getItem('zap_glass') ?? localStorage.getItem('chatra_glass')) !== 'false';
    if (!glass) {
      document.body.classList.add('flat-theme');
    } else {
      document.body.classList.remove('flat-theme');
    }
  }, []);

  // Persist currentUser details to localStorage and apply theme
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('zap_username', currentUser.username);
      localStorage.setItem('zap_token', currentUser.token);
      if (currentUser.encryptedPrivateKeys) {
        localStorage.setItem('zap_encrypted_private_keys', typeof currentUser.encryptedPrivateKeys === 'string' ? currentUser.encryptedPrivateKeys : JSON.stringify(currentUser.encryptedPrivateKeys));
      }
      localStorage.setItem('zap_public_identity_key', JSON.stringify(currentUser.keys.publicIdentityKey));
      localStorage.setItem('zap_public_signing_key', JSON.stringify(currentUser.keys.publicSigningKey));
      
      if (currentUser.displayName) {
        localStorage.setItem('zap_display_name', currentUser.displayName);
      } else {
        localStorage.removeItem('zap_display_name');
        localStorage.removeItem('chatra_display_name');
      }
      
      if (currentUser.avatarIcon) {
        localStorage.setItem('zap_avatar_icon', currentUser.avatarIcon);
      } else {
        localStorage.removeItem('zap_avatar_icon');
        localStorage.removeItem('chatra_avatar_icon');
      }

      if (currentUser.themeColor) {
        localStorage.setItem('zap_theme_rgb', currentUser.themeColor);
        applyThemeTokens(currentUser.themeColor);
      }
    }
  }, [currentUser]);

  const clearUserSession = useCallback(() => {
    localStorage.removeItem('session_enc_key');
    ['username', 'token', 'encrypted_private_keys', 'public_identity_key', 'public_signing_key', 'display_name', 'avatar_icon', 'active_view', 'active_contact'].forEach(key => {
      localStorage.removeItem(`zap_${key}`);
      localStorage.removeItem(`chatra_${key}`);
    });
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
