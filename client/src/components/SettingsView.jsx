import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, User, Check, ShieldAlert, CheckCircle, LogOut, Camera, Trash2, ChevronDown, ChevronUp, Play, Volume2, Ban, Unlock } from 'lucide-react';
import { renderAvatar } from './Sidebar';
import { emitUpdateProfile } from '../services/socket';
import { soundEngine } from '../services/soundEffects';
import { applyThemeTokens } from '../utils/themeTokens';

export default function SettingsView({ currentUser, onBack, onLogout, isNavigatingBack, onProfileUpdate, blockedUsers = [], onUnblockUser }) {
  const settingsContainerRef = useRef(null);
  const settingsBounceWrapperRef = useRef(null);
  const getInitialAvatar = () => {
    if (currentUser.avatarIcon) {
      try {
        const parsed = JSON.parse(currentUser.avatarIcon);
        return {
          color: parsed.color || 'blue',
          emoji: parsed.emoji || '',
          image: parsed.image || ''
        };
      } catch (e) {
        // Fallback
      }
    }
    return { color: 'blue', emoji: '', image: '' };
  };

  const initialAvatar = getInitialAvatar();
  const [displayName, setDisplayName] = useState(currentUser.displayName || '');
  const [selectedColor, setSelectedColor] = useState(initialAvatar.color);
  const [selectedEmoji, setSelectedEmoji] = useState(initialAvatar.emoji);
  const [selectedImage, setSelectedImage] = useState(initialAvatar.image || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [callQuality, setCallQuality] = useState(() => {
    return localStorage.getItem('chatra_call_quality') || 'medium';
  });

  const hexToRgb = (hex) => {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`;
  };

  const rgbToHex = (rgbStr) => {
    if (!rgbStr) return '#007acc';
    const parts = rgbStr.split(',').map(n => parseInt(n.trim(), 10));
    if (parts.length !== 3 || parts.some(isNaN)) return '#007acc';
    return `#${((1 << 24) + (parts[0] << 16) + (parts[1] << 8) + parts[2]).toString(16).slice(1)}`;
  };

  const [appThemeRgb, setAppThemeRgb] = useState(() => {
    return localStorage.getItem('chatra_theme_rgb') || '0, 122, 204';
  });

  const handleThemeChange = (rgbValue) => {
    setAppThemeRgb(rgbValue);
    localStorage.setItem('chatra_theme_rgb', rgbValue);
    applyThemeTokens(rgbValue);
  };

  const [soundEffectsEnabled, setSoundEffectsEnabled] = useState(() => {
    return localStorage.getItem('chatra_sound_effects') !== 'false';
  });
  const [soundVolume, setSoundVolume] = useState(() => {
    const v = parseFloat(localStorage.getItem('chatra_sound_volume'));
    return isNaN(v) ? 0.6 : v;
  });

  const [individualSounds, setIndividualSounds] = useState(() => ({
    msg_sent: localStorage.getItem('chatra_sound_msg_sent') !== 'false',
    msg_recv: localStorage.getItem('chatra_sound_msg_recv') !== 'false',
    voice_rec: localStorage.getItem('chatra_sound_voice_rec') !== 'false',
    call_dial: localStorage.getItem('chatra_sound_call_dial') !== 'false',
    call_ring: localStorage.getItem('chatra_sound_call_ring') !== 'false',
    call_connect: localStorage.getItem('chatra_sound_call_connect') !== 'false',
    toggle_clicks: localStorage.getItem('chatra_sound_toggle_clicks') !== 'false',
    user_online: localStorage.getItem('chatra_sound_user_online') !== 'false',
  }));

  const [showAdvancedSounds, setShowAdvancedSounds] = useState(false);

  const toggleIndividualSound = (key) => {
    setIndividualSounds(prev => {
      const nextVal = !prev[key];
      localStorage.setItem(`chatra_sound_${key}`, nextVal ? 'true' : 'false');
      return { ...prev, [key]: nextVal };
    });
  };

  const fileInputRef = useRef(null);

  const colors = [
    { name: 'blue', value: '#007acc' },
    { name: 'purple', value: '#bf5af2' },
    { name: 'emerald', value: '#30d158' },
    { name: 'orange', value: '#ff9f0a' },
    { name: 'rose', value: '#ff375f' }
  ];

  const uniqueEmojis = ['None', '🦊', '🐨', '🐼', '🦁', '🐯', '🚀', '💻', '👻', '🔒', '🛡️', '💎', '🔑'];

  // Centering, cropping and JPEG compression pipeline
  const processProfileImage = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const size = 128; // Optimized size for avatar thumbnails
          canvas.width = size;
          canvas.height = size;
          
          const ctx = canvas.getContext('2d');
          
          // Calculate cropping dimensions for centering
          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;
          
          // Draw center-cropped image onto canvas
          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
          
          // Convert to highly optimized, compressed JPEG DataURL
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          resolve(dataUrl);
        };
        img.onerror = () => reject(new Error('Failed to load image file'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file');
      return;
    }

    setError('');
    try {
      const compressedBase64 = await processProfileImage(file);
      setSelectedImage(compressedBase64);
      // Clear emoji when custom photo is active
      setSelectedEmoji('');
    } catch (err) {
      console.error(err);
      setError('Failed to process image');
    }
  };

  const handleRemoveImage = () => {
    setSelectedImage('');
    setSelectedColor('blue');
    setSelectedEmoji('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const selectColorAndClearImage = (colorName) => {
    setSelectedColor(colorName);
    setSelectedImage('');
  };

  const selectEmojiAndClearImage = (emojiName) => {
    setSelectedEmoji(emojiName);
    setSelectedImage('');
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess(false);

    try {
      let avatarIconString;
      if (selectedImage) {
        avatarIconString = JSON.stringify({
          image: selectedImage
        });
      } else {
        avatarIconString = JSON.stringify({
          color: selectedColor,
          emoji: selectedEmoji === 'None' ? '' : selectedEmoji
        });
      }
      
      const cleanedDisplayName = displayName.trim();
      // Also save the current theme color to server so it syncs across devices
      await emitUpdateProfile(cleanedDisplayName || null, avatarIconString, appThemeRgb || null);
      
      onProfileUpdate({
        displayName: cleanedDisplayName || null,
        avatarIcon: avatarIconString,
        themeColor: appThemeRgb || null
      });
      
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to save profile changes');
    } finally {
      setSaving(false);
    }
  };

  // Hook for elastic overscroll bounce (rubber-banding)
  useEffect(() => {
    const container = settingsContainerRef.current;
    const wrapper = settingsBounceWrapperRef.current;
    if (!container || !wrapper) return;

    let startY = 0;
    let isDragging = false;
    
    // Physics engine state variables
    let position = 0;
    let velocity = 0;
    const tension = 0.08; // Stiffness of the spring
    const damping = 0.48;  // Critically damped friction coefficient
    let rafId = null;

    // Reset translations
    wrapper.style.transform = 'translate3d(0px, 0px, 0px)';
    wrapper.style.transition = 'none';

    const updatePhysics = () => {
      if (isDragging) return;

      const force = -tension * position;
      const friction = -damping * velocity;
      const acceleration = force + friction;
      
      velocity += acceleration;
      position += velocity;

      const maxVisualOverscroll = 85;
      if (Math.abs(position) > maxVisualOverscroll) {
        position = Math.sign(position) * maxVisualOverscroll;
        velocity = 0; 
      }

      wrapper.style.transform = `translate3d(0px, ${position}px, 0px)`;

      if (Math.abs(position) > 0.05 || Math.abs(velocity) > 0.05) {
        rafId = requestAnimationFrame(updatePhysics);
      } else {
        position = 0;
        velocity = 0;
        wrapper.style.transform = 'translate3d(0px, 0px, 0px)';
        rafId = null;
      }
    };

    const handleTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      startY = e.touches[0].clientY;
      isDragging = true;
    };

    const handleTouchMove = (e) => {
      if (!isDragging) return;

      const currentY = e.touches[0].clientY;
      const deltaY = currentY - startY;

      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;

      const atTop = scrollTop <= 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1;

      if (atTop && deltaY > 0) {
        if (e.cancelable) e.preventDefault();
        position = Math.sign(deltaY) * Math.pow(Math.abs(deltaY), 0.75);
        wrapper.style.transform = `translate3d(0px, ${position}px, 0px)`;
      } else if (atBottom && deltaY < 0) {
        if (e.cancelable) e.preventDefault();
        position = Math.sign(deltaY) * Math.pow(Math.abs(deltaY), 0.75);
        wrapper.style.transform = `translate3d(0px, ${position}px, 0px)`;
      } else {
        startY = currentY;
        position = 0;
        wrapper.style.transform = 'translate3d(0px, 0px, 0px)';
      }
    };

    const handleTouchEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      velocity = 0;
      if (!rafId) {
        rafId = requestAnimationFrame(updatePhysics);
      }
    };

    const handleWheel = (e) => {
      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;

      const atTop = scrollTop <= 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1;

      if ((atTop && e.deltaY < 0) || (atBottom && e.deltaY > 0)) {
        if (e.cancelable) e.preventDefault();
        velocity -= e.deltaY * 0.045;
        if (!rafId) {
          rafId = requestAnimationFrame(updatePhysics);
        }
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      container.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Build live preview avatar details
  const previewAvatarIcon = selectedImage 
    ? JSON.stringify({ image: selectedImage })
    : JSON.stringify({
        color: selectedColor,
        emoji: selectedEmoji === 'None' ? '' : selectedEmoji
      });

  return (
    <div className={`settings-view ${isNavigatingBack ? 'navigating-back' : ''}`}>
      {/* Settings Header */}
      <div className="settings-header">
        <div className="chat-header-info">
          <button className="back-btn" onClick={onBack} title="Back" aria-label="Back">
            <ArrowLeft size={18} />
          </button>
          <div className="chat-header-name">
            <h2>Settings</h2>
            <span className="chat-header-status" style={{ color: 'var(--text-subtle)' }}>
              Profile Customization
            </span>
          </div>
        </div>
      </div>

      {/* Settings Content */}
      <div className="settings-content-wrapper" ref={settingsContainerRef}>
        <div className="settings-bounce-wrapper" ref={settingsBounceWrapperRef}>
          <div className="settings-content">
          {/* Live Preview Card */}
          <div className="profile-preview-card glass">
            <div className="preview-avatar-wrapper">
              {renderAvatar(
                currentUser.username,
                displayName.trim() || currentUser.username,
                previewAvatarIcon,
                { width: '80px', height: '80px', borderRadius: '50%', fontSize: '34px' }
              )}
            </div>
            <div className="preview-info">
              <h3>{displayName.trim() || currentUser.username}</h3>
              <p>@{currentUser.username}</p>
              
              <div className="avatar-action-buttons">
                <button 
                  type="button" 
                  className="avatar-action-pill" 
                  onClick={() => fileInputRef.current.click()}
                  title={selectedImage ? 'Change profile photo' : 'Upload profile photo'}
                >
                  <Camera size={13} />
                  {selectedImage ? 'Change Photo' : 'Upload Photo'}
                </button>
                {selectedImage && (
                  <button 
                    type="button" 
                    className="avatar-action-pill danger-pill" 
                    onClick={handleRemoveImage}
                    title="Remove custom photo"
                  >
                    <Trash2 size={13} />
                    Remove Photo
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Hidden File Input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/png, image/jpeg, image/jpg, image/webp, image/gif, .png, .jpg, .jpeg, .webp, .gif"
            style={{ display: 'none' }}
          />

          {/* Configuration Form */}
          <div className="settings-form glass">
            {/* Display Name */}
            <div className="form-group">
              <label>Display Name</label>
              <div className="input-with-icon">
                <User size={18} className="input-icon" />
                <input
                  type="text"
                  placeholder="Set display name..."
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value.slice(0, 24))}
                />
              </div>
            </div>

            {/* App Theme Accent Color Selector */}
            <div className="form-group">
              <label>App Theme Accent Color</label>
              <div className="color-selector-row" style={{ flexWrap: 'wrap', gap: '10px' }}>
                {[
                  { name: 'Electric Blue', hex: '#007acc', rgb: '0, 122, 204' },
                  { name: 'Royal Violet', hex: '#8b5cf6', rgb: '139, 92, 246' },
                  { name: 'Deep Purple', hex: '#a855f7', rgb: '168, 85, 247' },
                  { name: 'Neon Emerald', hex: '#10b981', rgb: '16, 185, 129' },
                  { name: 'Mint Leaf', hex: '#2dd4bf', rgb: '45, 212, 191' },
                  { name: 'Cyan Spark', hex: '#06b6d4', rgb: '6, 182, 212' },
                  { name: 'Sunset Amber', hex: '#f59e0b', rgb: '245, 158, 11' },
                  { name: 'Bright Orange', hex: '#ff7043', rgb: '255, 112, 67' },
                  { name: 'Crimson Rose', hex: '#f43f5e', rgb: '244, 63, 94' },
                  { name: 'Hot Pink', hex: '#ec4899', rgb: '236, 72, 153' }
                ].map((theme) => {
                  const isCurrentTheme = appThemeRgb === theme.rgb;
                  return (
                    <button
                      key={theme.name}
                      type="button"
                      className={`color-dot ${isCurrentTheme ? 'active' : ''}`}
                      style={{ backgroundColor: theme.hex }}
                      onClick={() => handleThemeChange(theme.rgb)}
                      title={`Switch app accent color to ${theme.name}`}
                    >
                      {isCurrentTheme && <Check size={14} color="#ffffff" />}
                    </button>
                  );
                })}

                {/* Custom Color Picker Button & Native Color Input */}
                <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                  <input
                    type="color"
                    id="custom-theme-color-picker"
                    value={rgbToHex(appThemeRgb)}
                    onChange={(e) => handleThemeChange(hexToRgb(e.target.value))}
                    style={{
                      position: 'absolute',
                      opacity: 0,
                      width: '32px',
                      height: '32px',
                      cursor: 'pointer',
                      zIndex: 2
                    }}
                    title="Choose custom theme color"
                  />
                  <div
                    className="color-dot custom-picker-btn"
                    style={{
                      background: 'conic-gradient(from 0deg, #f43f5e, #f59e0b, #10b981, #06b6d4, #8b5cf6, #f43f5e)',
                      position: 'relative',
                      zIndex: 1,
                      border: '1px solid rgba(255, 255, 255, 0.2)'
                    }}
                    title="Choose custom color..."
                  />
                </div>
              </div>
            </div>

            {/* Colors */}
            <div className={`form-group avatar-options-group ${selectedImage ? 'is-disabled' : ''}`}>
              <label>
                Avatar Color
                {selectedImage && (
                  <span className="photo-active-chip">Photo Active</span>
                )}
              </label>
              <div className="color-selector-row">
                {colors.map((c) => {
                  const isColorSelected = !selectedImage && selectedColor === c.name;
                  return (
                    <button
                      key={c.name}
                      type="button"
                      className={`color-dot ${isColorSelected ? 'active' : ''}`}
                      style={{ backgroundColor: c.value }}
                      onClick={() => selectColorAndClearImage(c.name)}
                      disabled={saving || !!selectedImage}
                      title={`Select ${c.name} background`}
                    >
                      {isColorSelected && <Check size={14} color="#ffffff" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Emojis */}
            <div className={`form-group avatar-options-group ${selectedImage ? 'is-disabled' : ''}`}>
              <label>
                Avatar Symbol (Emoji)
                {selectedImage && (
                  <span className="photo-active-chip">Photo Active</span>
                )}
              </label>
              <div className="avatar-emoji-grid">
                {uniqueEmojis.map((emoji) => {
                  const isEmojiSelected = !selectedImage && ((emoji === 'None' && !selectedEmoji) || selectedEmoji === emoji);
                  return (
                    <button
                      key={emoji}
                      type="button"
                      className={`avatar-emoji-btn ${isEmojiSelected ? 'active' : ''}`}
                      onClick={() => selectEmojiAndClearImage(emoji === 'None' ? '' : emoji)}
                      disabled={saving || !!selectedImage}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Call Quality Profile Settings (Unified List Group) */}
            <div className="form-group">
              <label>Call & Screen Share Quality</label>
              <div className="quality-selector-group">
                {[
                  { id: 'low', name: 'Low Quality', desc: '480p Video • 720p 15fps Screen • 24kbps Audio (Slow connections)' },
                  { id: 'medium', name: 'Medium (Default)', desc: '720p Video • 1080p 30fps Screen • 64kbps Audio (Balanced HD)' },
                  { id: 'high', name: 'High Definition', desc: '1080p Video • 1080p 60fps Screen • 128kbps Hi-Fi Audio (Studio)' }
                ].map((q) => {
                  const isSelected = callQuality === q.id;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      className={`quality-option-row ${isSelected ? 'active' : ''}`}
                      onClick={() => {
                        setCallQuality(q.id);
                        localStorage.setItem('chatra_call_quality', q.id);
                      }}
                    >
                      <div className="quality-option-info">
                        <span className="quality-option-name">{q.name}</span>
                        <span className="quality-option-desc">{q.desc}</span>
                      </div>
                      <div className={`quality-option-radio ${isSelected ? 'active' : ''}`}>
                        {isSelected && <div className="quality-radio-dot" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sound Effects & Acoustics Settings */}
            <div className="form-group" style={{ marginTop: '20px' }}>
              <label>Sound Effects & Acoustics</label>
              <div style={{
                background: '#121517',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                borderRadius: '16px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '13.5px', color: '#ffffff' }}>
                      Audio Feedback & Ringtones
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'rgba(255, 255, 255, 0.5)', marginTop: '2px' }}>
                      Play subtle acoustic feedback for sent messages, calls, and incoming alerts.
                    </div>
                  </div>
                  <label className="toggle-switch" style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px', flexShrink: 0 }}>
                    <input 
                      type="checkbox" 
                      checked={soundEffectsEnabled}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setSoundEffectsEnabled(val);
                        localStorage.setItem('chatra_sound_effects', val ? 'true' : 'false');
                      }}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span style={{
                      position: 'absolute',
                      cursor: 'pointer',
                      top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: soundEffectsEnabled ? 'var(--accent-main)' : 'rgba(255, 255, 255, 0.15)',
                      transition: '.2s',
                      borderRadius: '24px'
                    }}>
                      <span style={{
                        position: 'absolute',
                        content: '""',
                        height: '18px',
                        width: '18px',
                        left: soundEffectsEnabled ? '22px' : '3px',
                        bottom: '3px',
                        backgroundColor: 'white',
                        transition: '.2s',
                        borderRadius: '50%'
                      }} />
                    </span>
                  </label>
                </div>

                {soundEffectsEnabled && (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'rgba(255, 255, 255, 0.6)' }}>
                        <span>Effects Volume</span>
                        <span>{Math.round(soundVolume * 100)}%</span>
                      </div>
                      <input 
                        type="range"
                        className="settings-volume-slider"
                        min="0"
                        max="1"
                        step="0.05"
                        value={soundVolume}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setSoundVolume(v);
                          localStorage.setItem('chatra_sound_volume', v.toString());
                        }}
                        style={{
                          background: `linear-gradient(to right, var(--accent-main) 0%, var(--accent-main) ${Math.round(soundVolume * 100)}%, rgba(255, 255, 255, 0.1) ${Math.round(soundVolume * 100)}%, rgba(255, 255, 255, 0.1) 100%)`
                        }}
                      />
                    </div>

                    {/* Expandable Individual Sound Customization */}
                    <div style={{ paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                      <button
                        type="button"
                        className="sound-accordion-toggle"
                        onClick={() => setShowAdvancedSounds(!showAdvancedSounds)}
                      >
                        <span>Customize Individual Sounds ({Object.values(individualSounds || {}).filter(Boolean).length}/8 Active)</span>
                        <ChevronDown size={16} className={`sound-accordion-chevron ${showAdvancedSounds ? 'expanded' : ''}`} />
                      </button>

                      <div className={`sound-accordion-wrapper ${showAdvancedSounds ? 'expanded' : ''}`}>
                        <div className="sound-accordion-inner">
                          {[
                            { key: 'msg_sent', label: 'Message Sent Sound', desc: 'Warm ascending chime on dispatching messages', playFn: () => soundEngine.playMessageSent() },
                            { key: 'msg_recv', label: 'Message Received Sound', desc: 'Gold-standard dual tone chime on incoming messages', playFn: () => soundEngine.playMessageReceived() },
                            { key: 'voice_rec', label: 'Voice Recording Alerts', desc: 'Start and stop feedback chimes for voice notes', playFn: () => soundEngine.playVoiceRecordStart() },
                            { key: 'call_dial', label: 'Outgoing Dialing Ringing', desc: 'Warm 900Hz low-pass filtered international ringback', playFn: () => { soundEngine.startOutgoingRingTone(); setTimeout(() => soundEngine.stopOutgoingRingTone(), 2000); } },
                            { key: 'call_ring', label: 'Incoming Call Ringtone', desc: 'Melodic chime sequence loop for incoming call alerts', playFn: () => { soundEngine.startIncomingRingtone(); setTimeout(() => soundEngine.stopIncomingRingtone(), 2500); } },
                            { key: 'call_connect', label: 'Call Connect & End Chimes', desc: 'Reassuring join triad and release chords', playFn: () => soundEngine.playCallConnected() },
                            { key: 'toggle_clicks', label: 'Mute & Camera Toggle Clicks', desc: 'Clean micro-chimes on toggling microphone or camera', playFn: () => soundEngine.playToggleMute(false) },
                            { key: 'user_online', label: 'Contact Online Notification', desc: 'Discreet soft chime when a contact comes online', playFn: () => soundEngine.playUserOnline() }
                          ].map((item, idx) => (
                            <div 
                              key={item.key} 
                              className="sound-item-card"
                              style={{ animationDelay: `${idx * 30}ms` }}
                            >
                              <div style={{ flex: 1, paddingRight: '12px' }}>
                                <div style={{ fontWeight: '500', fontSize: '12px', color: 'var(--text-color)' }}>
                                  {item.label}
                                </div>
                                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                  {item.desc}
                                </div>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <button
                                  type="button"
                                  className="sound-sample-btn"
                                  onClick={item.playFn}
                                  title="Sample Sound"
                                >
                                  <Play size={12} style={{ marginLeft: '1px' }} />
                                </button>

                                <label className="toggle-switch" style={{ position: 'relative', display: 'inline-block', width: '36px', height: '20px', flexShrink: 0 }}>
                                  <input 
                                    type="checkbox" 
                                    checked={!!(individualSounds && individualSounds[item.key])}
                                    onChange={() => toggleIndividualSound(item.key)}
                                    style={{ opacity: 0, width: 0, height: 0 }}
                                  />
                                  <span style={{
                                    position: 'absolute',
                                    cursor: 'pointer',
                                    top: 0, left: 0, right: 0, bottom: 0,
                                    backgroundColor: (individualSounds && individualSounds[item.key]) ? 'var(--accent-main)' : 'rgba(255, 255, 255, 0.15)',
                                    transition: '.2s',
                                    borderRadius: '20px'
                                  }}>
                                    <span style={{
                                      position: 'absolute',
                                      content: '""',
                                      height: '14px',
                                      width: '14px',
                                      left: (individualSounds && individualSounds[item.key]) ? '19px' : '3px',
                                      bottom: '3px',
                                      backgroundColor: 'white',
                                      transition: '.2s',
                                      borderRadius: '50%'
                                    }} />
                                  </span>
                                </label>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Blocked Contacts Management */}
            <div className="settings-section">
              <label style={{ display: 'block', marginBottom: '8px' }}>Blocked Contacts</label>
              <p className="section-description">
                Manage accounts you have blocked. Blocked users cannot send messages or place calls to you.
              </p>
              
              <div className="blocked-contacts-list">
                {(!blockedUsers || blockedUsers.length === 0) ? (
                  <div className="empty-blocked-state">
                    <Ban size={16} style={{ color: 'var(--text-muted)' }} />
                    <span>No blocked contacts</span>
                  </div>
                ) : (
                  blockedUsers.map(username => (
                    <div key={username} className="blocked-contact-item">
                      <div className="blocked-contact-info">
                        {renderAvatar(username, null, null, { width: '34px', height: '34px', fontSize: '13px' })}
                        <div className="blocked-contact-text">
                          <span className="blocked-contact-name">@{username}</span>
                          <span className="blocked-contact-status">Blocked</span>
                        </div>
                      </div>
                      <button 
                        type="button"
                        className="unblock-action-btn"
                        onClick={() => onUnblockUser?.(username)}
                        title={`Unblock @${username}`}
                      >
                        <Unlock size={14} /> Unblock
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Form feedback indicators */}
            {error && (
              <div className="settings-feedback error-feedback">
                <ShieldAlert size={16} />
                <span>{error}</span>
              </div>
            )}

            {/* Submit Control with In-Button State Feedback */}
            <button
              type="button"
              className={`save-profile-btn ${success ? 'is-success' : ''}`}
              disabled={saving}
              onClick={handleSave}
            >
              {saving ? (
                <span className="btn-state-content">
                  <div className="btn-spinner" />
                  Saving changes...
                </span>
              ) : success ? (
                <span className="btn-state-content">
                  <Check size={16} strokeWidth={2.6} />
                  Saved Successfully
                </span>
              ) : (
                'Save Profile'
              )}
            </button>
          </div>

          {/* Secure Logout Section */}
          <div className="settings-danger-zone">
            <button className="settings-logout-btn" onClick={onLogout}>
              <LogOut size={18} />
              Sign Out Securely
            </button>
          </div>
        </div>
        </div>
      </div>

      {/* Non-Shifting Floating Bottom Toast */}
      {success && (
        <div className="settings-floating-toast" role="status" aria-live="polite">
          <CheckCircle size={16} className="toast-icon" />
          <span>Profile updated successfully</span>
        </div>
      )}
    </div>
  );
}
