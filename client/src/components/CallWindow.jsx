import React, { useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, Video, Mic, MicOff, VideoOff, Volume2, ShieldCheck, Minimize2, Maximize2, Monitor, MonitorOff, Maximize, Minimize } from 'lucide-react';
import { renderAvatar } from './Sidebar';
import { soundEngine } from '../services/soundEffects';

export default function CallWindow({ 
  callState,         // 'idle' | 'calling' | 'incoming' | 'connected'
  mediaType,         // 'voice' | 'video'
  callerName, 
  callContact,       // Contact details object containing avatar and display name
  localStream, 
  remoteStream, 
  onAccept, 
  onDecline, 
  onHangUp,
  
  // Lifted media states and handlers
  isMuted,
  isCameraOff,
  isScreenSharing,
  remoteScreenSharing,
  remoteCameraOff,
  remoteMuted,
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare
}) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isCallMinimized, setIsCallMinimized] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const controlsTimerRef = useRef(null);
  const [renderState, setRenderState] = useState(callState);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef(null);
  
  const [isFullscreen, setIsFullscreen] = useState(false);
  const overlayRef = useRef(null);

  const [isSwapped, setIsSwapped] = useState(false);

  // Auto-reset swap state and exit browser fullscreen when screen sharing ends or when call resets to idle
  const prevScreenSharingRef = useRef(isScreenSharing || remoteScreenSharing);
  useEffect(() => {
    const wasSharing = prevScreenSharingRef.current;
    const isSharing = isScreenSharing || remoteScreenSharing;
    prevScreenSharingRef.current = isSharing;

    setIsSwapped(false);

    if (wasSharing && !isSharing) {
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    }
  }, [isScreenSharing, remoteScreenSharing]);

  useEffect(() => {
    if (callState === 'idle') {
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    }
  }, [callState]);

  // Synchronous callback refs for 100% immediate stream attachment upon DOM insertion
  const bindLocalVideo = (node) => {
    localVideoRef.current = node;
    if (node && localStream) {
      if (node.srcObject !== localStream) {
        node.srcObject = localStream;
      }
      node.play().catch(e => console.log("local play error:", e));
    }
  };

  const bindRemoteVideo = (node) => {
    remoteVideoRef.current = node;
    if (node && remoteStream) {
      if (node.srcObject !== remoteStream) {
        node.srcObject = remoteStream;
      }
      node.play().catch(e => console.log("remote play error:", e));
    }
  };

  // Bind media streams to video elements with guaranteed re-attachment on layout swap
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      if (localVideoRef.current.srcObject !== localStream) {
        localVideoRef.current.srcObject = localStream;
      }
      localVideoRef.current.play().catch(e => console.log("local play error:", e));
    }
  }, [localStream, renderState, mediaType, isScreenSharing, isCameraOff, isSwapped]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      if (remoteVideoRef.current.srcObject !== remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
      remoteVideoRef.current.play().catch(e => console.log("remote play error:", e));
    }
  }, [remoteStream, renderState, mediaType, remoteScreenSharing, remoteCameraOff, isSwapped]);

  const toggleBrowserFullscreen = (e) => {
    if (e) {
      e.stopPropagation();
    }
    const element = overlayRef.current;
    if (!element) return;

    if (isCallMinimized) {
      setIsCallMinimized(false);
    }

    if (!document.fullscreenElement) {
      element.requestFullscreen?.()
        .then(() => setIsFullscreen(true))
        .catch((err) => console.error("Error entering fullscreen:", err));
    } else {
      document.exitFullscreen?.()
        .then(() => setIsFullscreen(false))
        .catch((err) => console.error("Error exiting fullscreen:", err));
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const resetControlsTimer = () => {
    setShowControls(true);
    if (controlsTimerRef.current) {
      clearTimeout(controlsTimerRef.current);
    }
    controlsTimerRef.current = setTimeout(() => {
      if (renderState === 'connected' && !isCallMinimized && mediaType === 'video') {
        setShowControls(false);
      }
    }, 3500);
  };

  const handleOverlayClick = (e) => {
    // Ignore click triggers on active control buttons
    if (e.target.closest('button')) {
      resetControlsTimer();
      return;
    }

    if (showControls) {
      // Hide immediately
      setShowControls(false);
      if (controlsTimerRef.current) {
        clearTimeout(controlsTimerRef.current);
        controlsTimerRef.current = null;
      }
    } else {
      // Show immediately and start inactivity auto-hide timer
      resetControlsTimer();
    }
  };

  // Dragging coordinates state for picture-in-picture window
  const [pipPosition, setPipPosition] = useState({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, pipX: 0, pipY: 0 });

  // Sync internal state to allow exit transitions when unmounting
  useEffect(() => {
    if (callState !== 'idle') {
      if (renderState !== callState) {
        if (closeTimerRef.current) {
          clearTimeout(closeTimerRef.current);
          closeTimerRef.current = null;
        }
        setRenderState(callState);
        setIsClosing(false);
      }
    } else if (renderState !== 'idle' && !isClosing) {
      setIsClosing(true);
      closeTimerRef.current = setTimeout(() => {
        setRenderState('idle');
        setIsClosing(false);
        closeTimerRef.current = null;
      }, 350); // Matches the cubic-bezier exit duration in CSS
    }
  }, [callState, renderState, isClosing]);

  // Clean up and reset states on call reset
  useEffect(() => {
    if (callState === 'idle') {
      setIsCallMinimized(false);
      setPipPosition({ x: 0, y: 0 });
    }
  }, [callState]);

  // Reset PiP position when maximizing call
  useEffect(() => {
    if (!isCallMinimized) {
      setPipPosition({ x: 0, y: 0 });
    }
  }, [isCallMinimized]);

  // Reset controls timer when call status or minimization toggles
  useEffect(() => {
    if (renderState === 'connected' && !isCallMinimized && mediaType === 'video') {
      resetControlsTimer();
    } else {
      setShowControls(true);
      if (controlsTimerRef.current) {
        clearTimeout(controlsTimerRef.current);
      }
    }
  }, [renderState, isCallMinimized, mediaType]);

  useEffect(() => {
    return () => {
      if (controlsTimerRef.current) {
        clearTimeout(controlsTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
      document.body.classList.remove('dragging-pip');
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, []);

  // Bind media streams to video elements with guaranteed re-attachment on layout swap
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      if (localVideoRef.current.srcObject !== localStream) {
        localVideoRef.current.srcObject = localStream;
      }
      localVideoRef.current.play().catch(e => console.log("local play error:", e));
    }
  }, [localStream, renderState, mediaType, isScreenSharing, isCameraOff, isSwapped]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      if (remoteVideoRef.current.srcObject !== remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
      remoteVideoRef.current.play().catch(e => console.log("remote play error:", e));
    }
  }, [remoteStream, renderState, mediaType, remoteScreenSharing, remoteCameraOff, isSwapped]);

  useEffect(() => {
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(e => console.log("remote audio play error:", e));
    }
  }, [remoteStream, renderState, mediaType, remoteMuted]);

  // Call timer
  useEffect(() => {
    let timer = null;
    if (renderState === 'connected') {
      setCallDuration(0);
      timer = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      clearInterval(timer);
    }
    return () => clearInterval(timer);
  }, [renderState]);

  const formatDuration = (secs) => {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
  };

  // Mouse Drag Event Handlers with viewport boundary constraints
  const handleMouseDown = (e) => {
    if (!isCallMinimized) return;
    if (e.target.closest('button')) return; // Ignore drag triggers on active buttons

    e.preventDefault();
    if (window.getSelection) {
      window.getSelection().removeAllRanges();
    }
    document.body.classList.add('dragging-pip');

    isDraggingRef.current = true;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      pipX: pipPosition.x,
      pipY: pipPosition.y
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.mouseX;
    const dy = e.clientY - dragStartRef.current.mouseY;

    // PiP window size matching index.css dimensions
    const pipWidth = 280;
    const pipHeight = 180;
    const margin = 24;

    // Calculate default alignment positions relative to window size
    const defaultLeft = window.innerWidth - pipWidth - margin;
    const defaultTop = window.innerHeight - pipHeight - margin;

    // Constraint limits (relative to default position at right: 24px, bottom: 24px)
    // maxX = 0 and maxY = 0 prevents the PiP window from ever being pushed off-screen to the right or bottom
    const minX = -defaultLeft + margin;
    const maxX = 0;
    const minY = -defaultTop + margin;
    const maxY = 0;

    const targetX = Math.max(minX, Math.min(maxX, dragStartRef.current.pipX + dx));
    const targetY = Math.max(minY, Math.min(maxY, dragStartRef.current.pipY + dy));

    setPipPosition({ x: targetX, y: targetY });
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
    document.body.classList.remove('dragging-pip');
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  // Touch Drag Event Handlers with viewport boundary constraints
  const handleTouchStart = (e) => {
    if (!isCallMinimized) return;
    if (e.target.closest('button')) return;

    e.preventDefault();
    if (window.getSelection) {
      window.getSelection().removeAllRanges();
    }
    document.body.classList.add('dragging-pip');

    isDraggingRef.current = true;
    dragStartRef.current = {
      mouseX: e.touches[0].clientX,
      mouseY: e.touches[0].clientY,
      pipX: pipPosition.x,
      pipY: pipPosition.y
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
  };

  const handleTouchMove = (e) => {
    if (!isDraggingRef.current) return;
    e.preventDefault();
    
    const dx = e.touches[0].clientX - dragStartRef.current.mouseX;
    const dy = e.touches[0].clientY - dragStartRef.current.mouseY;

    const pipWidth = 280;
    const pipHeight = 180;
    const margin = 24;

    const defaultLeft = window.innerWidth - pipWidth - margin;
    const defaultTop = window.innerHeight - pipHeight - margin;

    const minX = -defaultLeft + margin;
    const maxX = 0;
    const minY = -defaultTop + margin;
    const maxY = 0;

    const targetX = Math.max(minX, Math.min(maxX, dragStartRef.current.pipX + dx));
    const targetY = Math.max(minY, Math.min(maxY, dragStartRef.current.pipY + dy));

    setPipPosition({ x: targetX, y: targetY });
  };

  const handleTouchEnd = () => {
    isDraggingRef.current = false;
    document.body.classList.remove('dragging-pip');
    document.removeEventListener('touchmove', handleTouchMove);
    document.removeEventListener('touchend', handleTouchEnd);
  };

  if (renderState === 'idle') return null;

  const activeUsername = callContact?.username || callerName || 'Unknown';
  const activeDisplayName = callContact?.displayName || activeUsername;
  const activeAvatarIcon = callContact?.avatarIcon || null;
  const isVerified = !!callContact?.isVerified;

  if (renderState === 'incoming') {
    return (
      <div className={`incoming-call-pill-container ${isClosing ? 'closing' : ''}`}>
        <div className="incoming-call-pill glass">
          <div className="incoming-pill-avatar">
            {renderAvatar(activeUsername, activeDisplayName, activeAvatarIcon, { width: '100%', height: '100%', borderRadius: '50%' })}
          </div>
          
          <div className="incoming-pill-info">
            <div className="incoming-pill-name">
              <span>{activeDisplayName}</span>
              {isVerified && <ShieldCheck size={12} style={{ color: 'var(--success-color)', marginLeft: '3px' }} />}
            </div>
            <div className="incoming-pill-type">
              {mediaType === 'video' ? 'Incoming Video Call...' : 'Incoming Voice Call...'}
            </div>
          </div>

          <div className="incoming-pill-actions">
            <button className="pill-btn accept" onClick={onAccept} title="Accept Call">
              {mediaType === 'video' ? <Video size={16} /> : <Phone size={16} />}
            </button>
            <button className="pill-btn decline" onClick={onDecline} title="Decline Call">
              <PhoneOff size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Dynamic style binding for dragging transitions
  const pipStyle = isCallMinimized ? {
    transform: `translate3d(${pipPosition.x}px, ${pipPosition.y}px, 0)`,
    cursor: isDraggingRef.current ? 'grabbing' : 'grab'
  } : {};

  return (
    <div 
      ref={overlayRef}
      className={`call-overlay ${isClosing ? 'closing' : ''} ${isCallMinimized ? 'pip-mode' : ''} ${!showControls ? 'controls-hidden' : ''} ${isFullscreen ? 'browser-fullscreen' : ''}`}
      style={pipStyle}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onMouseMove={resetControlsTimer}
      onClick={handleOverlayClick}
    >

      {(renderState === 'calling' || renderState === 'ringing') && (
        <div className="call-card glass">
          <div className="call-avatar" style={{ overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center', animation: 'pulse-glow 2s infinite' }}>
            {renderAvatar(activeUsername, activeDisplayName, activeAvatarIcon, { width: '100%', height: '100%', borderRadius: '50%', fontSize: '40px' })}
          </div>
          <div>
            <h2 style={{ fontSize: '22px', marginBottom: '8px' }}>
              {renderState === 'calling' ? 'Calling...' : 'Ringing...'}
            </h2>
            <p style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', flexWrap: 'wrap' }}>
              <span>{renderState === 'calling' ? 'Calling' : 'Ringing'}</span>
              <strong>{activeDisplayName}</strong>
              {isVerified && <ShieldCheck size={14} style={{ color: 'var(--accent-color)' }} />}
              <span>(@{activeUsername})...</span>
            </p>
          </div>
          <div className="call-actions">
            {isCallMinimized ? (
              <button className="call-btn maximize" onClick={() => setIsCallMinimized(false)} title="Maximize Call">
                <Maximize2 size={24} />
              </button>
            ) : (
              <button className="call-btn minimize" onClick={() => setIsCallMinimized(true)} title="Minimize Call">
                <Minimize2 size={24} />
              </button>
            )}
            <button className="call-btn decline" onClick={onHangUp} title="Cancel Call">
              <PhoneOff size={24} />
            </button>
          </div>
        </div>
      )}

      {renderState === 'connected' && (
        <>
          {mediaType === 'video' ? (
            <div className="video-grid">
              {/* 
                COMPREHENSIVE WEBRTC STREAM MATRIX:
                - Default Main: Remote Screen Share > Local Screen Share > Remote Camera/Avatar.
                - Thumbnail is rendered ONLY when the secondary stream has an active video track.
                - Swap toggles between Main and Thumbnail streams seamlessly.
              */}
              {(() => {
                const hasRemoteVideoTrack = !remoteCameraOff || remoteScreenSharing;
                const hasLocalVideoTrack = !isCameraOff || isScreenSharing;

                let defaultMain = 'remote';
                if (remoteScreenSharing) {
                  defaultMain = 'remote';
                } else if (isScreenSharing) {
                  defaultMain = 'local';
                } else {
                  defaultMain = 'remote';
                }

                const activeMainStream = isSwapped 
                  ? (defaultMain === 'remote' ? 'local' : 'remote') 
                  : defaultMain;

                const activeThumbnailStream = activeMainStream === 'remote' ? 'local' : 'remote';

                // Render thumbnail ONLY if the thumbnail stream has active video
                const showThumbnail = !isCallMinimized && (
                  activeThumbnailStream === 'remote' ? hasRemoteVideoTrack : hasLocalVideoTrack
                );

                return (
                  <>
                    {/* MAIN DISPLAY AREA */}
                    {activeMainStream === 'remote' ? (
                      hasRemoteVideoTrack ? (
                        <video 
                          className={`remote-video ${remoteScreenSharing ? 'screen-sharing' : ''}`} 
                          ref={bindRemoteVideo} 
                          autoPlay 
                          playsInline 
                        />
                      ) : (
                        <div className="remote-video-avatar-container">
                          <div className="call-avatar" style={{ width: '100px', height: '100px', fontSize: '40px', border: '3px solid rgba(255,255,255,0.08)', animation: 'pulse-glow 2.5s infinite' }}>
                            {renderAvatar(activeUsername, activeDisplayName, activeAvatarIcon, { width: '100%', height: '100%', borderRadius: '50%', fontSize: '40px' })}
                          </div>
                          <span className="remote-avatar-label">
                            {activeDisplayName}'s Camera is Off
                          </span>
                        </div>
                      )
                    ) : (
                      /* Main View: Local Stream */
                      hasLocalVideoTrack ? (
                        <video 
                          className={`remote-video ${isScreenSharing ? 'screen-sharing local-screen-share' : 'local-screen-share'}`} 
                          ref={bindLocalVideo} 
                          autoPlay 
                          playsInline 
                          muted 
                        />
                      ) : (
                        <div className="remote-video-avatar-container">
                          <div className="call-avatar" style={{ width: '100px', height: '100px', fontSize: '40px', border: '3px solid rgba(255,255,255,0.08)', animation: 'pulse-glow 2.5s infinite' }}>
                            {renderAvatar(activeUsername, activeDisplayName, activeAvatarIcon, { width: '100%', height: '100%', borderRadius: '50%', fontSize: '40px' })}
                          </div>
                          <span className="remote-avatar-label">
                            Your Camera is Off
                          </span>
                        </div>
                      )
                    )}

                    {/* THUMBNAIL AREA (Top-Right Clickable) */}
                    {showThumbnail && (
                      <div 
                        className="local-video-container clickable-thumbnail" 
                        onClick={() => setIsSwapped(prev => !prev)}
                        title="Click to swap main view"
                      >
                        {activeThumbnailStream === 'local' ? (
                          <>
                            <video 
                              className={isScreenSharing ? "local-video local-screen-share" : "local-video"} 
                              ref={bindLocalVideo} 
                              autoPlay 
                              playsInline 
                              muted 
                            />
                            <span className="thumbnail-badge">
                              {isScreenSharing ? 'Your Screen (Swap)' : 'You (Swap)'}
                            </span>
                          </>
                        ) : (
                          <>
                            <video 
                              className={remoteScreenSharing ? "local-video screen-sharing" : "local-video"} 
                              ref={bindRemoteVideo} 
                              autoPlay 
                              playsInline 
                            />
                            <span className="thumbnail-badge">
                              {remoteScreenSharing ? `${activeDisplayName}'s Screen (Swap)` : `${activeDisplayName} (Swap)`}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}

              {/* CONTROLS OVERLAY BAR */}
              <div className={isCallMinimized ? "pip-video-call-controls" : "video-call-controls"}>
                {!isCallMinimized && <span className="call-timer">{formatDuration(callDuration)}</span>}
                
                <button 
                  className={`call-btn mute ${isMuted ? 'active' : ''}`} 
                  onClick={() => {
                    soundEngine.playToggleMute(!isMuted);
                    onToggleMute();
                  }}
                  title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
                  aria-label={isMuted ? "Unmute Microphone" : "Mute Microphone"}
                >
                  {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
                </button>
                
                <button 
                  className={`call-btn mute ${isCameraOff ? 'active' : ''}`} 
                  onClick={() => {
                    soundEngine.playToggleMute(!isCameraOff);
                    onToggleCamera();
                  }}
                  title={isCameraOff ? "Turn Camera On" : "Turn Camera Off"}
                  aria-label={isCameraOff ? "Turn Camera On" : "Turn Camera Off"}
                >
                  {isCameraOff ? <VideoOff size={18} /> : <Video size={18} />}
                </button>

                {!!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && (
                  <button 
                    className={`call-btn mute ${isScreenSharing ? 'active' : ''}`} 
                    onClick={() => {
                      soundEngine.playToggleMute(!isScreenSharing);
                      onToggleScreenShare();
                    }}
                    title={isScreenSharing ? "Stop Sharing Screen" : "Share Screen"}
                    aria-label={isScreenSharing ? "Stop Sharing Screen" : "Share Screen"}
                  >
                    {isScreenSharing ? <MonitorOff size={18} /> : <Monitor size={18} />}
                  </button>
                )}
                
                {!isCallMinimized && (
                  <button 
                    className={`call-btn mute ${isFullscreen ? 'active' : ''}`} 
                    onClick={toggleBrowserFullscreen}
                    title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Mode"}
                    aria-label={isFullscreen ? "Exit Fullscreen" : "Fullscreen Mode"}
                  >
                    {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                  </button>
                )}

                {/* Hide PiP minimize button when in Browser Fullscreen mode to prevent UI conflict */}
                {!isFullscreen && (
                  isCallMinimized ? (
                    <button 
                      className="call-btn maximize" 
                      onClick={() => {
                        setIsCallMinimized(false);
                        if (document.fullscreenElement) {
                          document.exitFullscreen?.().catch(() => {});
                        }
                      }}
                      title="Expand Call Window"
                      aria-label="Expand Call Window"
                    >
                      <Maximize2 size={18} />
                    </button>
                  ) : (
                    <button 
                      className="call-btn minimize" 
                      onClick={() => setIsCallMinimized(true)}
                      title="Minimize Call (PiP)"
                      aria-label="Minimize Call (PiP)"
                    >
                      <Minimize2 size={18} />
                    </button>
                  )
                )}
                
                <button 
                  className="call-btn decline" 
                  onClick={onHangUp}
                  title="End Call"
                  aria-label="End Call"
                >
                  <PhoneOff size={18} />
                </button>
              </div>
            </div>
          ) : (
            // Voice call UI
            <div className="call-card glass">
              <div className="call-avatar" style={{ overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center', animation: 'pulse-glow 2s infinite' }}>
                {renderAvatar(activeUsername, activeDisplayName, activeAvatarIcon, { width: '100%', height: '100%', borderRadius: '50%', fontSize: '40px' })}
              </div>
              <div>
                <h2 style={{ fontSize: '22px', marginBottom: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                  {activeDisplayName}
                  {isVerified && <ShieldCheck size={18} style={{ color: 'var(--accent-color)' }} />}
                </h2>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '0', marginBottom: '12px', fontFamily: 'monospace' }}>
                  @{activeUsername}
                </p>
                <p style={{ color: 'var(--success-color)', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', fontSize: '14px' }}>
                  <Volume2 size={16} /> Secure E2EE Connection
                </p>
                <div className="pip-duration-text" style={{ marginTop: '10px', fontSize: '15px', color: 'var(--text-muted)' }}>
                  Duration: {formatDuration(callDuration)}
                </div>
              </div>
              
              {/* Invisible audio element to play remote stream */}
              <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />

              <div className="call-actions">
                <button 
                  className={`call-btn mute ${isMuted ? 'active' : ''}`} 
                  onClick={onToggleMute}
                  title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
                >
                  {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
                </button>

                <button 
                  className={`call-btn mute ${isCameraOff ? 'active' : ''}`} 
                  onClick={onToggleCamera}
                  title={isCameraOff ? "Turn Camera On" : "Turn Camera Off"}
                >
                  {isCameraOff ? <VideoOff size={24} /> : <Video size={24} />}
                </button>

                <button 
                  className={`call-btn mute ${isScreenSharing ? 'active' : ''}`} 
                  onClick={onToggleScreenShare}
                  title={isScreenSharing ? "Stop Sharing Screen" : "Share Screen"}
                >
                  {isScreenSharing ? <MonitorOff size={24} /> : <Monitor size={24} />}
                </button>

                {!isCallMinimized && (
                  <button 
                    className={`call-btn mute ${isFullscreen ? 'active' : ''}`} 
                    onClick={toggleBrowserFullscreen}
                    title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Mode"}
                  >
                    {isFullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
                  </button>
                )}

                {/* Hide PiP minimize button when in Browser Fullscreen mode to prevent UI conflict */}
                {!isFullscreen && (
                  isCallMinimized ? (
                    <button className="call-btn maximize" onClick={() => setIsCallMinimized(false)} title="Maximize Call">
                      <Maximize2 size={24} />
                    </button>
                  ) : (
                    <button className="call-btn minimize" onClick={() => setIsCallMinimized(true)} title="Minimize Call">
                      <Minimize2 size={24} />
                    </button>
                  )
                )}
                <button className="call-btn decline" onClick={onHangUp} title="Hang up">
                  <PhoneOff size={24} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
