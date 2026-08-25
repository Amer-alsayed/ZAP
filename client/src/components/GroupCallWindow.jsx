import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  Mic, MicOff, Video, VideoOff, Phone, PhoneOff, MonitorUp,
  Minimize2, Maximize2, Users, Loader2
} from 'lucide-react';
import { renderAvatar } from './Sidebar';

const formatElapsed = (secs) => {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const CallTile = ({ user, stream, isLocal, peerState }) => {
  const videoRef = React.useRef(null);

  React.useEffect(() => {
    if (videoRef.current && stream) {
      try { videoRef.current.srcObject = stream; } catch (e) {}
    }
  }, [stream]);

  const hasVideo = Boolean(stream && stream.getVideoTracks().some(t => t.readyState === 'live'));

  return (
    <div className={`gcall-tile ${hasVideo ? '' : 'no-video'}`}>
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className="gcall-video"
        />
      ) : (
        <div className="gcall-tile-placeholder">
          {renderAvatar(user.username, user.displayName, user.avatarIcon, { width: '72px', height: '72px', fontSize: '26px' })}
        </div>
      )}

      <div className="gcall-tile-bottom">
        <span className={`gcall-mic-dot ${peerState?.muted ? 'muted' : ''}`}>
          {peerState?.muted ? <MicOff size={11} /> : <Mic size={11} />}
        </span>
        <span className="gcall-tile-name">{user.displayName || user.username}{isLocal ? ' (You)' : ''}</span>
        {peerState?.screenSharing && <MonitorUp size={12} style={{ color: 'var(--accent-text)', flexShrink: 0 }} />}
      </div>
    </div>
  );
};

const GroupCallWindow = ({
  visible,
  isIncoming,
  waitingOut,
  mediaType,
  group,
  localStream,
  remoteUsers = [],
  myUsername = '',
  elapsed = 0,
  isMuted,
  isCameraOff,
  isScreenSharing,
  minimized,
  onToggleMinimize,
  onAccept,
  onDecline,
  onEnd,
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare
}) => {
  // ===== PiP drag state (identical physics to the DM call PiP) =====
  const overlayRef = useRef(null);
  const currentPosRef = useRef({ x: 0, y: 0 });
  const dragStartRef = useRef(null);
  const isDraggingRef = useRef(false);
  const isAnimatingRef = useRef(false);
  const lastTargetCornerRef = useRef('right-bottom');
  const velocityRef = useRef({ vx: 0, vy: 0, lastX: 0, lastY: 0, lastTime: 0 });
  const [isDraggingPip, setIsDraggingPip] = useState(false);

  const getDockBounds = useCallback(() => {
    const isMobile = window.innerWidth <= 768;
    const pipWidth = isMobile ? 240 : 280;
    const pipHeight = isMobile ? 150 : 180;
    const margin = isMobile ? 16 : 24;
    const defaultLeft = window.innerWidth - pipWidth - margin;
    const defaultTop = window.innerHeight - pipHeight - margin;
    return {
      minX: -defaultLeft + margin,
      maxX: 0,
      minY: -defaultTop + margin,
      maxY: 0,
      defaultLeft,
      defaultTop,
      pipWidth,
      pipHeight
    };
  }, []);

  const calculateSnapTarget = useCallback((posX, posY, vx, vy) => {
    const { minX, maxX, minY, maxY } = getDockBounds();
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    let snapX = posX > midX ? maxX : minX;
    if (vx > 0.35) snapX = maxX;
    else if (vx < -0.35) snapX = minX;

    let snapY = posY > midY ? maxY : minY;
    if (vy > 0.35) snapY = maxY;
    else if (vy < -0.35) snapY = minY;

    lastTargetCornerRef.current = (snapX === minX ? 'left' : 'right') + '-' + (snapY === minY ? 'top' : 'bottom');
    return { targetX: snapX, targetY: snapY };
  }, [getDockBounds]);

  const handleMouseMove = useCallback((e) => {
    if (!isDraggingRef.current) return;
    e.preventDefault();

    const dx = e.clientX - dragStartRef.current.mouseX;
    const dy = e.clientY - dragStartRef.current.mouseY;

    const now = performance.now();
    const dt = Math.max(1, now - velocityRef.current.lastTime);
    velocityRef.current.vx = (e.clientX - velocityRef.current.lastX) / dt;
    velocityRef.current.vy = (e.clientY - velocityRef.current.lastY) / dt;
    velocityRef.current.lastX = e.clientX;
    velocityRef.current.lastY = e.clientY;
    velocityRef.current.lastTime = now;

    const { minX, maxX, minY, maxY } = getDockBounds();
    let curX = dragStartRef.current.pipX + dx;
    let curY = dragStartRef.current.pipY + dy;

    if (curX < minX) curX = minX + (curX - minX) * 0.3;
    else if (curX > maxX) curX = maxX + (curX - maxX) * 0.3;
    if (curY < minY) curY = minY + (curY - minY) * 0.3;
    else if (curY > maxY) curY = maxY + (curY - maxY) * 0.3;

    currentPosRef.current = { x: curX, y: curY };
    const tilt = Math.max(-5, Math.min(5, velocityRef.current.vx * 3));
    if (overlayRef.current) {
      overlayRef.current.style.transform = `translate3d(${curX}px, ${curY}px, 0) scale(1.03) rotate(${tilt}deg)`;
    }
  }, [getDockBounds]);

  const handleMouseUp = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDraggingPip(false);
    document.body.classList.remove('dragging-pip');
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);

    const { targetX, targetY } = calculateSnapTarget(
      currentPosRef.current.x,
      currentPosRef.current.y,
      velocityRef.current.vx,
      velocityRef.current.vy
    );
    currentPosRef.current = { x: targetX, y: targetY };
    if (overlayRef.current) {
      overlayRef.current.style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`;
    }
  }, [calculateSnapTarget, handleMouseMove]);

  const handleMouseDown = (e) => {
    if (!minimized) return;
    if (e.target.closest('button')) return;
    e.preventDefault();
    if (window.getSelection) window.getSelection().removeAllRanges();
    document.body.classList.add('dragging-pip');

    isDraggingRef.current = true;
    setIsDraggingPip(true);

    const now = performance.now();
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      pipX: currentPosRef.current.x,
      pipY: currentPosRef.current.y
    };
    velocityRef.current = { vx: 0, vy: 0, lastX: e.clientX, lastY: e.clientY, lastTime: now };

    if (overlayRef.current) overlayRef.current.style.transition = 'none';
    document.addEventListener('mousemove', handleMouseMove, { passive: false });
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleTouchStart = (e) => {
    if (!minimized) return;
    if (e.target.closest('button')) return;
    const touch = e.touches[0];
    if (!touch) return;
    handleMouseDown(touch);
  };

  // ===== Minimize / Expand: same FLIP keyframe animation as the DM call =====
  const handleMinimize = useCallback((e) => {
    if (e) e.stopPropagation();
    if (isAnimatingRef.current) return;
    const overlay = overlayRef.current;
    if (!overlay) {
      onToggleMinimize();
      return;
    }

    isAnimatingRef.current = true;

    const { defaultLeft, defaultTop, pipWidth, pipHeight } = getDockBounds();
    const posX = currentPosRef.current.x;
    const posY = currentPosRef.current.y;

    onToggleMinimize();

    requestAnimationFrame(() => {
      const anim = overlay.animate([
        {
          top: '0px',
          left: '0px',
          width: `${window.innerWidth}px`,
          height: `${window.innerHeight}px`,
          borderRadius: '0px',
          transform: 'translate3d(0px, 0px, 0)',
          backgroundColor: 'rgba(0, 0, 0, 0.95)',
          boxShadow: 'none'
        },
        {
          top: `${defaultTop}px`,
          left: `${defaultLeft}px`,
          width: `${pipWidth}px`,
          height: `${pipHeight}px`,
          borderRadius: '20px',
          transform: `translate3d(${posX}px, ${posY}px, 0)`,
          backgroundColor: 'rgba(12, 12, 14, 0.96)',
          boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.1)'
        }
      ], {
        duration: 360,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        fill: 'forwards'
      });

      anim.onfinish = () => {
        anim.cancel();
        isAnimatingRef.current = false;
      };
    });
  }, [getDockBounds, onToggleMinimize]);

  const handleExpand = useCallback((e) => {
    if (e) e.stopPropagation();
    if (isAnimatingRef.current) return;
    const overlay = overlayRef.current;
    if (!overlay) {
      onToggleMinimize();
      return;
    }

    isAnimatingRef.current = true;

    const { defaultLeft, defaultTop, pipWidth, pipHeight } = getDockBounds();
    const posX = currentPosRef.current.x;
    const posY = currentPosRef.current.y;

    onToggleMinimize();

    requestAnimationFrame(() => {
      const anim = overlay.animate([
        {
          top: `${defaultTop}px`,
          left: `${defaultLeft}px`,
          width: `${pipWidth}px`,
          height: `${pipHeight}px`,
          borderRadius: '20px',
          transform: `translate3d(${posX}px, ${posY}px, 0)`,
          backgroundColor: 'rgba(12, 12, 14, 0.96)',
          boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.1)'
        },
        {
          top: '0px',
          left: '0px',
          width: `${window.innerWidth}px`,
          height: `${window.innerHeight}px`,
          borderRadius: '0px',
          transform: 'translate3d(0px, 0px, 0)',
          backgroundColor: 'rgba(0, 0, 0, 0.95)',
          boxShadow: 'none'
        }
      ], {
        duration: 360,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        fill: 'forwards'
      });

      anim.onfinish = () => {
        anim.cancel();
        isAnimatingRef.current = false;
      };
    });
  }, [getDockBounds, onToggleMinimize]);

  // Keep the PiP docked to its corner on window resize (same as DM)
  useEffect(() => {
    const handleWindowResize = () => {
      if (!minimized) return;
      const { minX, maxX, minY, maxY } = getDockBounds();
      const corner = lastTargetCornerRef.current;

      const newX = corner.includes('left') ? minX : maxX;
      const newY = corner.includes('top') ? minY : maxY;

      currentPosRef.current = { x: newX, y: newY };
      if (overlayRef.current) {
        overlayRef.current.style.transform = `translate3d(${newX}px, ${newY}px, 0)`;
      }
    };

    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [minimized, getDockBounds]);

  if (!visible || !group) return null;

  // Plain computation (not a hook): safe after the conditional return above
  const tiles = [
    {
      username: myUsername,
      displayName: null,
      avatarIcon: null,
      stream: localStream,
      state: { muted: isMuted, cameraOff: isCameraOff, screenSharing: isScreenSharing },
      isLocal: true
    },
    ...remoteUsers
  ];

  const pipStyle = minimized ? {
    transform: `translate3d(${currentPosRef.current.x}px, ${currentPosRef.current.y}px, 0)`,
    cursor: isDraggingPip ? 'grabbing' : 'grab'
  } : {};

  // Focus tile for PiP: first connected remote, falling back to the local stream
  const focus = remoteUsers.find(u => u.stream) || remoteUsers[0] || null;
  const focusStream = focus?.stream || localStream || null;
  const focusHasVideo = Boolean(focusStream && focusStream.getVideoTracks().some(t => t.readyState === 'live'));

  // ---------- Incoming call prompt (identical to DM incoming pill) ----------
  if (isIncoming) {
    return (
      <div className="incoming-call-pill-container">
        <div className="incoming-call-pill glass">
          <div className="incoming-pill-avatar">
            {renderAvatar(group.name || 'G', null, group.avatarIcon, { width: '100%', height: '100%', borderRadius: '50%' })}
          </div>

          <div className="incoming-pill-info">
            <div className="incoming-pill-name">
              <span>{group.name}</span>
              <Users size={13} style={{ color: 'var(--text-muted)', marginLeft: '5px' }} />
            </div>
            <div className="incoming-pill-type">
              {mediaType === 'video' ? 'Incoming Group Video Call...' : 'Incoming Group Voice Call...'}
            </div>
          </div>

          <div className="incoming-pill-actions">
            <button className="pill-btn accept" onClick={onAccept} title="Accept Call">
              {mediaType === 'video' ? <Video size={18} /> : <Phone size={18} />}
            </button>
            <button className="pill-btn decline" onClick={onDecline} title="Decline Call">
              <PhoneOff size={18} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Single persistent overlay: fullscreen ⇄ PiP via class toggle ----------
  return (
    <div
      ref={overlayRef}
      className={`call-overlay gcall-overlay-stage ${minimized ? 'pip-mode' : ''} ${isDraggingPip ? 'is-dragging' : ''}`}
      style={pipStyle}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      {minimized ? (
        <>
          <div className="gcall-pip-focus">
            {focusHasVideo ? (
              <video
                autoPlay
                playsInline
                muted={!focus}
                className="gcall-video"
                ref={(el) => { if (el && focusStream) { try { el.srcObject = focusStream; } catch (e) {} } }}
              />
            ) : (
              <div className="gcall-tile-placeholder">
                {renderAvatar(focus?.username || group.name || 'G', focus?.displayName || null, focus?.avatarIcon || group.avatarIcon, { width: '56px', height: '56px', fontSize: '20px' })}
              </div>
            )}
            <div className="gcall-tile-bottom">
              <span className={`gcall-mic-dot ${isMuted ? 'muted' : ''}`}>
                {isMuted ? <MicOff size={11} /> : <Mic size={11} />}
              </span>
              <span className="gcall-tile-name">{group.name}</span>
            </div>
          </div>

          <div className="pip-video-call-controls">
            <button type="button" className={`call-btn mute ${isMuted ? 'active' : ''}`} onClick={onToggleMute} title={isMuted ? 'Unmute' : 'Mute'}>
              {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <button type="button" className={`call-btn mute ${isCameraOff ? 'active' : ''}`} onClick={onToggleCamera} title={isCameraOff ? 'Turn camera on' : 'Turn camera off'}>
              {isCameraOff ? <VideoOff size={16} /> : <Video size={16} />}
            </button>
            <button type="button" className={`call-btn screen-share ${isScreenSharing ? 'sharing-active' : ''}`} onClick={onToggleScreenShare} title={isScreenSharing ? 'Stop sharing' : 'Share screen'}>
              <MonitorUp size={16} />
            </button>
            <button type="button" className="call-btn maximize" onClick={handleExpand} title="Maximize Call">
              <Maximize2 size={16} />
            </button>
            <button type="button" className="call-btn decline" onClick={onEnd} title="End Call">
              <PhoneOff size={16} />
            </button>
          </div>
        </>
      ) : (
        <>
          {waitingOut && (
            <div className="gcall-waiting-strip">
              <Loader2 size={14} className="spinner-rotating" />
              <span>Waiting for others to join…</span>
            </div>
          )}

          <div className="gcall-grid">
            {tiles.map((t) => (
              <CallTile
                key={t.isLocal ? '__me__' : t.username}
                user={t}
                stream={t.stream}
                isLocal={t.isLocal}
                peerState={t.state}
              />
            ))}
          </div>

          <div className="video-call-controls">
            {waitingOut
              ? <span className="call-timer"><Loader2 size={14} className="spinner-rotating" style={{ display: 'inline-block' }} /></span>
              : <span className="call-timer">{formatElapsed(elapsed)}</span>}
            <button
              type="button"
              className={`call-btn mute ${isMuted ? 'active' : ''}`}
              onClick={onToggleMute}
              title={isMuted ? 'Unmute' : 'Mute'}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            <button
              type="button"
              className={`call-btn mute ${isCameraOff ? 'active' : ''}`}
              onClick={onToggleCamera}
              title={isCameraOff ? 'Turn camera on' : 'Turn camera off'}
              aria-label={isCameraOff ? 'Turn camera on' : 'Turn camera off'}
            >
              {isCameraOff ? <VideoOff size={18} /> : <Video size={18} />}
            </button>
            <button
              type="button"
              className={`call-btn screen-share ${isScreenSharing ? 'sharing-active' : ''}`}
              onClick={onToggleScreenShare}
              title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
              aria-label={isScreenSharing ? 'Stop sharing' : 'Share screen'}
            >
              <MonitorUp size={18} />
            </button>
            <button type="button" className="call-btn minimize" onClick={handleMinimize} title="Minimize Call (PiP)" aria-label="Minimize Call (PiP)">
              <Minimize2 size={20} />
            </button>
            <button type="button" className="call-btn decline" onClick={onEnd} title="Leave Call" aria-label="Leave call">
              <PhoneOff size={18} />
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default GroupCallWindow;
