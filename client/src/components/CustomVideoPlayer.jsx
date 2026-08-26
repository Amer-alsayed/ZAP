import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play, Pause, Volume2, VolumeX, Volume1,
  Maximize, Minimize, PictureInPicture2,
  RotateCcw, RotateCw, Loader2, AlertTriangle, RefreshCw
} from 'lucide-react';
import './CustomVideoPlayer.css';

const STORAGE_VOLUME = 'chatra_video_volume';
const STORAGE_MUTED = 'chatra_video_muted';
const STORAGE_RATE = 'chatra_video_rate';

function formatTime(sec) {
  if (!isFinite(sec) || isNaN(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60);
  const h = Math.floor(m / 60);
  if (h > 0) {
    return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function CustomVideoPlayer({
  src,
  fileMetadata = null,
  compact = false,
  poster = null,
  onLoadError = null,
  autoPlay = false,
  className = ''
}) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const progressRef = useRef(null);
  const volumeTrackRef = useRef(null);
  const hideTimerRef = useRef(null);
  const lastTapRef = useRef({ time: 0, x: 0 });
  const isDraggingProgressRef = useRef(false);
  const isDraggingVolumeRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedPct, setBufferedPct] = useState(0);
  const [volume, setVolume] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem(STORAGE_VOLUME));
      if (!isNaN(v) && v >= 0 && v <= 1) return v;
    } catch (e) {}
    return 1;
  });
  const [isMuted, setIsMuted] = useState(() => {
    try { return localStorage.getItem(STORAGE_MUTED) === 'true'; } catch (e) { return false; }
  });
  const [playbackRate, setPlaybackRate] = useState(() => {
    try {
      const r = parseFloat(localStorage.getItem(STORAGE_RATE));
      if ([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].includes(r)) return r;
    } catch (e) {}
    return 1;
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPiP, setIsPiP] = useState(false);
  const [isControlsVisible, setIsControlsVisible] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isEnded, setIsEnded] = useState(false);
  const [seekAnim, setSeekAnim] = useState(null); // 'back' | 'forward' | null
  const seekAnimTimerRef = useRef(null);

  const pipSupported = typeof document !== 'undefined' && !!document.pictureInPictureEnabled && !!HTMLVideoElement.prototype.requestPictureInPicture;
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const showControls = useCallback(() => {
    setIsControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (isPlaying && !isDraggingProgressRef.current && !isDraggingVolumeRef.current) {
      hideTimerRef.current = setTimeout(() => setIsControlsVisible(false), 3200);
    }
  }, [isPlaying]);

  const hideControlsIfPlaying = useCallback(() => {
    if (isPlaying && !isDraggingProgressRef.current && isControlsVisible) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setIsControlsVisible(false), 2800);
    }
  }, [isPlaying, isControlsVisible]);

  // Initial volume / rate apply
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = isMuted ? 0 : volume;
    v.muted = isMuted;
    v.playbackRate = playbackRate;
  }, []); // only on mount, subsequent changes handled separately

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = isMuted ? 0 : volume;
      videoRef.current.muted = isMuted;
    }
    try { localStorage.setItem(STORAGE_VOLUME, String(volume)); } catch (e) {}
    try { localStorage.setItem(STORAGE_MUTED, String(isMuted)); } catch (e) {}
  }, [volume, isMuted]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
    try { localStorage.setItem(STORAGE_RATE, String(playbackRate)); } catch (e) {}
  }, [playbackRate]);

  // Reset state when src changes
  useEffect(() => {
    setHasError(false);
    setErrorMsg('');
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setBufferedPct(0);
    setIsEnded(false);
    setIsBuffering(false);
    setIsControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    // Reset dynamic aspect ratio so skeleton shows before metadata
    if (containerRef.current) {
      containerRef.current.style.aspectRatio = '';
    }
  }, [src]);

  // Global single-play coordination — pause other videos when one starts
  useEffect(() => {
    const handleGlobalPlay = (e) => {
      const otherVideo = e.detail;
      const myVideo = videoRef.current;
      if (!myVideo || !otherVideo || myVideo === otherVideo) return;
      if (!myVideo.paused) {
        myVideo.pause();
      }
    };
    window.addEventListener('chatra-video-play', handleGlobalPlay);
    return () => window.removeEventListener('chatra-video-play', handleGlobalPlay);
  }, []);

  // Video event wiring
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onLoadedMetadata = () => {
      const d = video.duration;
      if (isFinite(d)) setDuration(d);
      setHasError(false);
      // Dynamically adapt container aspect to video's natural ratio
      // Keeps portrait videos tall but capped by max-height, landscape wide but not absurd
      if (!compact && containerRef.current && video.videoWidth && video.videoHeight) {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const ratio = vw / vh;
        // Clamp extreme ratios to avoid giant bubbles: limit tall to 9:14 and wide to 21:9
        let clampedW = vw;
        let clampedH = vh;
        if (ratio > 2.33) { // ultra-wide
          clampedH = vw / 2.33;
        } else if (ratio < 0.56) { // ultra-tall (e.g., 9:16 = 0.5625)
          clampedW = vh * 0.56;
        }
        containerRef.current.style.aspectRatio = `${clampedW} / ${clampedH}`;
      }
      if (autoPlay) {
        video.play().catch(() => {});
      }
    };
    const onTimeUpdate = () => {
      if (!isDraggingProgressRef.current) setCurrentTime(video.currentTime);
    };
    const onProgress = () => {
      try {
        if (video.buffered.length > 0) {
          const end = video.buffered.end(video.buffered.length - 1);
          const dur = video.duration || duration;
          const pct = dur > 0 ? (end / dur) * 100 : 0;
          setBufferedPct(Math.min(100, pct));
        }
      } catch (e) {}
    };
    const onWaiting = () => setIsBuffering(true);
    const onCanPlay = () => setIsBuffering(false);
    const onPlaying = () => {
      setIsBuffering(false);
      setIsPlaying(true);
      setIsEnded(false);
      setHasError(false);
      // Notify other players to pause (single-play policy like voice notes)
      try { window.dispatchEvent(new CustomEvent('chatra-video-play', { detail: video })); } catch (e) {}
    };
    const onPlay = () => {
      setIsPlaying(true);
      setIsEnded(false);
      try { window.dispatchEvent(new CustomEvent('chatra-video-play', { detail: video })); } catch (e) {}
    };
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setIsEnded(true);
      setIsControlsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
    const onError = () => {
      const err = video.error;
      let msg = 'Video failed to load';
      if (err) {
        if (err.code === 4) msg = 'Unsupported video format';
        else if (err.code === 3) msg = 'Video decoding failed';
        else if (err.code === 2) msg = 'Network error while loading video';
        else if (err.message) msg = err.message;
      }
      setHasError(true);
      setErrorMsg(msg);
      setIsBuffering(false);
      setIsPlaying(false);
      if (typeof onLoadError === 'function') onLoadError(msg);
    };
    const onVolumeChange = () => {
      // sync if changed via other means
      if (!isDraggingVolumeRef.current) {
        setVolume(video.volume);
        setIsMuted(video.muted || video.volume === 0);
      }
    };
    const onDurationChange = () => {
      if (isFinite(video.duration)) setDuration(video.duration);
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('progress', onProgress);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    video.addEventListener('volumechange', onVolumeChange);
    video.addEventListener('durationchange', onDurationChange);

    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('progress', onProgress);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      video.removeEventListener('volumechange', onVolumeChange);
      video.removeEventListener('durationchange', onDurationChange);
    };
  }, [src, autoPlay, onLoadError, compact]);

  // Fullscreen & PiP listeners
  useEffect(() => {
    const onFsChange = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement || null;
      const active = fsEl === containerRef.current || (containerRef.current && containerRef.current.contains(fsEl));
      setIsFullscreen(Boolean(active));
    };
    const onEnterPiP = () => setIsPiP(true);
    const onLeavePiP = () => setIsPiP(false);
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    const video = videoRef.current;
    if (video) {
      video.addEventListener('enterpictureinpicture', onEnterPiP);
      video.addEventListener('leavepictureinpicture', onLeavePiP);
    }
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
      if (video) {
        video.removeEventListener('enterpictureinpicture', onEnterPiP);
        video.removeEventListener('leavepictureinpicture', onLeavePiP);
      }
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (seekAnimTimerRef.current) clearTimeout(seekAnimTimerRef.current);
    };
  }, []);

  // Auto-hide logic when playing
  useEffect(() => {
    if (isPlaying && isControlsVisible && !hasError && !isEnded) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setIsControlsVisible(false), 3200);
    } else if (!isPlaying) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setIsControlsVisible(true);
    }
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, [isPlaying, hasError, isEnded]);

  const togglePlay = useCallback((e) => {
    if (e) {
      // If click originated while bubble is in selection mode, don't play — let row toggle selection
      const selActive = document.querySelector('.message-row.row-selected') || document.querySelector('.selection-mode-message') || document.querySelector('.message-wrapper.is-selected');
      if (selActive) {
        return;
      }
      e.stopPropagation();
      e.preventDefault();
    }
    const video = videoRef.current;
    if (!video) return;
    if (hasError) return;
    if (video.paused || video.ended) {
      if (video.ended) video.currentTime = 0;
      const p = video.play();
      if (p && typeof p.catch === 'function') {
        p.catch((err) => {
          // autoplay blocked - keep paused and show controls
          setIsBuffering(false);
          setIsPlaying(false);
          // Not an error, just need user gesture - ensure controls visible
          setIsControlsVisible(true);
        });
      }
      showControls();
    } else {
      video.pause();
      setIsControlsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    }
  }, [hasError, showControls]);

  const seekTo = useCallback((timeSec) => {
    const video = videoRef.current;
    if (!video || !isFinite(duration) || duration <= 0) return;
    const clamped = Math.max(0, Math.min(duration, timeSec));
    video.currentTime = clamped;
    setCurrentTime(clamped);
    if (video.paused) {
      // preview seek while paused
    }
    showControls();
  }, [duration, showControls]);

  const handleSeekAnim = useCallback((dir) => {
    setSeekAnim(dir);
    if (seekAnimTimerRef.current) clearTimeout(seekAnimTimerRef.current);
    seekAnimTimerRef.current = setTimeout(() => setSeekAnim(null), 650);
  }, []);

  const seekBy = useCallback((deltaSec) => {
    const video = videoRef.current;
    if (!video) return;
    const t = (video.currentTime || 0) + deltaSec;
    seekTo(t);
    handleSeekAnim(deltaSec < 0 ? 'back' : 'forward');
  }, [seekTo, handleSeekAnim]);

  // Progress dragging
  const getProgressFraction = useCallback((clientX) => {
    const rect = progressRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const x = clientX - rect.left;
    const frac = x / rect.width;
    return Math.max(0, Math.min(1, frac));
  }, []);

  const handleProgressPointerDown = useCallback((e) => {
    if (hasError) return;
    e.stopPropagation();
    e.preventDefault();
    isDraggingProgressRef.current = true;
    const video = videoRef.current;
    // capture pointer
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    const frac = getProgressFraction(e.clientX);
    const t = frac * (duration || 0);
    if (video && isFinite(duration)) {
      // do not pause, just seek
      video.currentTime = t;
      setCurrentTime(t);
    }
    showControls();

    const onMove = (ev) => {
      const f = getProgressFraction(ev.clientX);
      const nt = f * (duration || 0);
      if (video && isFinite(duration)) {
        video.currentTime = nt;
        setCurrentTime(nt);
      }
    };
    const onUp = (ev) => {
      isDraggingProgressRef.current = false;
      const f = getProgressFraction(ev.clientX);
      const nt = f * (duration || 0);
      if (video && isFinite(duration)) {
        video.currentTime = nt;
        setCurrentTime(nt);
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      // resume hide timer
      if (isPlaying) {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => setIsControlsVisible(false), 2500);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [duration, hasError, getProgressFraction, showControls, isPlaying]);

  const getVolumeFraction = useCallback((clientX) => {
    const rect = volumeTrackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const x = clientX - rect.left;
    return Math.max(0, Math.min(1, x / rect.width));
  }, []);

  const handleVolumePointerDown = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    isDraggingVolumeRef.current = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    const frac = getVolumeFraction(e.clientX);
    setVolume(frac);
    setIsMuted(frac === 0 ? true : false);
    const video = videoRef.current;
    if (video) {
      video.volume = frac;
      video.muted = frac === 0;
    }
    showControls();
    const onMove = (ev) => {
      const f = getVolumeFraction(ev.clientX);
      setVolume(f);
      setIsMuted(f === 0 ? true : false);
      if (video) {
        video.volume = f;
        video.muted = f === 0;
      }
    };
    const onUp = (ev) => {
      isDraggingVolumeRef.current = false;
      const f = getVolumeFraction(ev.clientX);
      setVolume(f);
      setIsMuted(f === 0);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [getVolumeFraction, showControls]);

  const toggleMute = useCallback((e) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    const video = videoRef.current;
    if (!video) return;
    if (isMuted || video.volume === 0) {
      const restore = volume > 0.05 ? volume : 1;
      setIsMuted(false);
      setVolume(restore);
      video.muted = false;
      video.volume = restore;
    } else {
      setIsMuted(true);
      video.muted = true;
    }
    showControls();
  }, [isMuted, volume, showControls]);

  const cycleRate = useCallback((e) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    const rates = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    const idx = rates.indexOf(playbackRate);
    const next = rates[(idx + 1) % rates.length];
    setPlaybackRate(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
    showControls();
  }, [playbackRate, showControls]);

  const toggleFullscreen = useCallback(async (e) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    const el = containerRef.current;
    const video = videoRef.current;
    if (!el) return;
    try {
      if (!isFullscreen) {
        if (el.requestFullscreen) await el.requestFullscreen();
        else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
        else if (video && video.webkitEnterFullscreen) {
          // iOS Safari fallback - enters native fullscreen
          video.webkitEnterFullscreen();
          return;
        } else if (el.msRequestFullscreen) await el.msRequestFullscreen();
      } else {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
        else if (document.msExitFullscreen) await document.msExitFullscreen();
      }
    } catch (err) {
      // fallback for webkit video fullscreen
      try {
        if (!isFullscreen && video && video.webkitEnterFullscreen) {
          video.webkitEnterFullscreen();
        }
      } catch (_) {}
    }
    showControls();
  }, [isFullscreen, showControls]);

  const togglePiP = useCallback(async (e) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (!isPiP) {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('PiP failed', err);
    }
    showControls();
  }, [isPiP, showControls]);

  const handleRetry = useCallback((e) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    const video = videoRef.current;
    if (!video) return;
    setHasError(false);
    setErrorMsg('');
    setIsBuffering(true);
    // force reload
    const srcVal = video.src;
    video.load();
    // slight delay then try play
    setTimeout(() => {
      video.play().catch(() => setIsBuffering(false));
    }, 150);
  }, []);

  const handleContainerClick = useCallback((e) => {
    // If error, ignore (retry button handles)
    if (hasError) return;
    // If message is in selection mode, let the row handle selection instead of playing
    // Detect via DOM — mirrors MessageList selectionMode
    if (e.target.closest('.cvp-controls') || e.target.closest('.cvp-btn') || e.target.closest('.cvp-center-btn')) {
      // Click on controls already handled by their own handlers; don't double-handle
      return;
    }
    if (document.querySelector('.message-row.row-selected') || document.querySelector('.selection-mode-message') || document.querySelector('.message-wrapper.is-selected')) {
      // In selection mode, propagate to row for toggleSelected — do not consume
      return;
    }
    // On mobile, single tap toggles controls; on desktop click on video toggles play
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    if (isTouch) {
      // toggle controls
      if (isControlsVisible && isPlaying) {
        setIsControlsVisible(false);
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      } else {
        showControls();
      }
      // Do not stopPropagation — allow swipe/long-press detection on the bubble to run
      return;
    }
    // desktop: if click directly on video area (not controls), toggle play
    if (e.target === videoRef.current || e.target === containerRef.current) {
      togglePlay(e);
    }
  }, [hasError, isControlsVisible, isPlaying, showControls, togglePlay]);

  const handleVideoTouchStart = useCallback((e) => {
    // Intentionally NOT calling stopPropagation — allow bubble swipe-to-reply / hold-to-select
    // Only controls block swipe (guarded in ChatArea handleMessageTouchStart)
  }, []);

  const handleVideoPointerDown = useCallback((e) => {
    // Same — video surface should behave like image bubble for swipe/long-press
  }, []);

  const handleDoubleClick = useCallback((e) => {
    if (hasError) return;
    e.stopPropagation();
    e.preventDefault();
    // on double click, toggle fullscreen on desktop; on video area seek on mobile mimic?
    const isCoarse = window.matchMedia('(pointer: coarse)').matches;
    if (!isCoarse) {
      toggleFullscreen(e);
      return;
    }
    // coarse pointer double tap already handled via touch?
    toggleFullscreen(e);
  }, [hasError, toggleFullscreen]);

  const handleTouchEnd = useCallback((e) => {
    if (hasError) return;
    // detect double tap for seek
    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch) return;
    const now = Date.now();
    const x = touch.clientX;
    const delta = now - lastTapRef.current.time;
    const dist = Math.abs(x - lastTapRef.current.x);
    const isDouble = delta < 350 && dist < 40;
    lastTapRef.current = { time: now, x };

    if (!isDouble) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mid = rect.left + rect.width / 2;
    if (x < mid) {
      seekBy(-10);
    } else {
      seekBy(10);
    }
  }, [seekBy, hasError]);

  const handleKeyDown = useCallback((e) => {
    const video = videoRef.current;
    if (!video) return;
    // ensure player is focused
    let handled = true;
    switch (e.key) {
      case ' ':
      case 'k':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (e.shiftKey) seekBy(-10);
        else seekBy(-5);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (e.shiftKey) seekBy(10);
        else seekBy(5);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setVolume(v => {
          const nv = Math.min(1, v + 0.08);
          if (video) { video.volume = nv; video.muted = false; }
          setIsMuted(false);
          return nv;
        });
        break;
      case 'ArrowDown':
        e.preventDefault();
        setVolume(v => {
          const nv = Math.max(0, v - 0.08);
          if (video) { video.volume = nv; video.muted = nv === 0; }
          setIsMuted(nv === 0);
          return nv;
        });
        break;
      case 'm':
      case 'M':
        toggleMute();
        break;
      case 'f':
      case 'F':
        toggleFullscreen();
        break;
      case 'p':
      case 'P':
        if (pipSupported) togglePiP();
        break;
      case ',':
        if (e.shiftKey) cycleRate();
        else seekBy(-0.05);
        break;
      case '.':
        if (e.shiftKey) cycleRate();
        break;
      default:
        handled = false;
        break;
    }
    if (handled) {
      showControls();
    }
  }, [togglePlay, seekBy, toggleMute, toggleFullscreen, togglePiP, pipSupported, cycleRate, showControls]);

  // Keep controls visible on mouse move
  const handleMouseMove = useCallback((e) => {
    // Don't interfere with dragging
    if (isDraggingProgressRef.current || isDraggingVolumeRef.current) return;
    showControls();
    // If pointer is over video but not controls, keep showing
    hideControlsIfPlaying();
  }, [showControls, hideControlsIfPlaying]);

  // Ensure controls show when hovering bottom area
  const handleControlsEnter = useCallback(() => {
    showControls();
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  }, [showControls]);

  if (!src) {
    return (
      <div className={`cvp-root cvp-error-state ${className} ${compact ? 'compact' : ''}`}>
        <div className="cvp-error-overlay visible">
          <AlertTriangle size={18} />
          <span>Video unavailable</span>
        </div>
      </div>
    );
  }

  const showCenterPlay = !isPlaying || isEnded || hasError;
  const showBigPlayPulse = isEnded;

  return (
    <div
      ref={containerRef}
      className={`cvp-root ${className} ${compact ? 'cvp-compact' : ''} ${isFullscreen ? 'is-fullscreen' : ''} ${isControlsVisible ? 'controls-visible' : 'controls-hidden'} ${hasError ? 'has-error' : ''} ${isEnded ? 'is-ended' : ''} ${isPlaying ? 'is-playing' : 'is-paused'} ${isBuffering ? 'is-buffering' : ''}`}
      tabIndex={0}
      role="region"
      aria-label={fileMetadata?.name ? `Video player: ${fileMetadata.name}` : 'Video player'}
      onClick={handleContainerClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => {
        if (isPlaying && !isDraggingProgressRef.current) {
          if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
          hideTimerRef.current = setTimeout(() => setIsControlsVisible(false), 900);
        }
      }}
      onTouchStart={handleVideoTouchStart}
      onTouchEnd={handleTouchEnd}
      onPointerDown={handleVideoPointerDown}
      onKeyDown={handleKeyDown}
      onDoubleClick={handleDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <video
        ref={videoRef}
        className="cvp-video"
        src={src}
        poster={poster || undefined}
        preload="metadata"
        playsInline
        crossOrigin="anonymous"
        disablePictureInPicture={false}
        controlsList="nodownload noplaybackrate noremoteplayback"
        disableRemotePlayback
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        onClick={(e) => {
          // In selection mode, let the bubble handle selection — don't intercept
          if (document.querySelector('.message-row.row-selected') || document.querySelector('.selection-mode-message') || document.querySelector('.message-wrapper.is-selected')) {
            return;
          }
          // Allow swipe/long-press to work — don't stopPropagation for video surface
          const isCoarse = window.matchMedia('(pointer: coarse)').matches;
          if (!isCoarse) {
            e.stopPropagation();
            togglePlay(e);
          } else {
            // mobile: container handles toggle
            // don't stopPropagation here either — keep bubble gestures alive
            if (isControlsVisible && isPlaying) setIsControlsVisible(false);
            else showControls();
          }
        }}
        onContextMenu={(e) => {
          // Block browser's "Save video / Open in new tab" menu — match image behavior (user-select: none)
          e.preventDefault();
        }}
        onTouchStart={(e) => {
          // Don't block swipe/long-press; controls already guard via ChatArea
        }}
      />

      {/* Top gradient scrim with filename */}
      <div className="cvp-top-scrim" aria-hidden={!isControlsVisible}>
        {fileMetadata?.name && (
          <span className="cvp-file-name" title={fileMetadata.name}>{fileMetadata.name}</span>
        )}
      </div>

      {/* Center play / replay */}
      <button
        className={`cvp-center-btn ${showCenterPlay ? 'visible' : ''} ${showBigPlayPulse ? 'pulse' : ''}`}
        onClick={togglePlay}
        onPointerDown={(e) => {
          const sel = document.querySelector('.message-row.row-selected') || document.querySelector('.selection-mode-message');
          if (!sel) e.stopPropagation();
        }}
        onTouchStart={(e) => {
          const sel = document.querySelector('.message-row.row-selected') || document.querySelector('.selection-mode-message');
          if (!sel) e.stopPropagation();
        }}
        onContextMenu={(e) => e.preventDefault()}
        aria-label={isEnded ? 'Replay' : isPlaying ? 'Pause' : 'Play'}
        tabIndex={-1}
      >
        {isEnded ? <RotateCcw size={26} /> : isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" style={{ marginLeft: isPlaying ? 0 : '3px' }} />}
      </button>

      {/* Buffering spinner */}
      {isBuffering && !hasError && !isEnded && (
        <div className="cvp-buffer-indicator" aria-hidden="true">
          <div className="cvp-buffer-ring">
            <Loader2 size={22} className="spinner-rotating" style={{ color: 'var(--accent-color)' }} />
          </div>
        </div>
      )}

      {/* Seek animation flashes like YouTube */}
      {seekAnim && (
        <div className={`cvp-seek-flash ${seekAnim}`} aria-hidden="true">
          <div className="cvp-seek-flash-inner">
            {seekAnim === 'back' ? <RotateCcw size={18} /> : <RotateCw size={18} />}
            <span>{seekAnim === 'back' ? '-10s' : '+10s'}</span>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {hasError && (
        <div className="cvp-error-overlay visible" role="alert">
          <div className="cvp-error-card glass">
            <div className="cvp-error-icon">
              <AlertTriangle size={18} />
            </div>
            <div className="cvp-error-text">
              <span className="cvp-error-title">Video failed to load</span>
              <span className="cvp-error-msg">{errorMsg || 'This video may be corrupted or in an unsupported format.'}</span>
            </div>
            <button className="cvp-retry-btn" onClick={handleRetry} aria-label="Retry">
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        </div>
      )}

      {/* Bottom controls */}
      <div
        className={`cvp-controls glass ${isControlsVisible ? 'visible' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onMouseEnter={handleControlsEnter}
        aria-hidden={!isControlsVisible && isPlaying}
      >
        {/* Progress bar (full width) */}
        <div
          ref={progressRef}
          className={`cvp-progress-wrap ${isDraggingProgressRef.current ? 'dragging' : ''}`}
          onPointerDown={handleProgressPointerDown}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={duration || 100}
          aria-valuenow={currentTime}
          aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
          tabIndex={-1}
        >
          <div className="cvp-progress-track" aria-hidden="true">
            <div className="cvp-progress-buffered" style={{ width: `${bufferedPct}%` }} />
            <div className="cvp-progress-filled" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="cvp-progress-thumb" style={{ left: `${progressPct}%` }} aria-hidden="true" />
          <div className="cvp-progress-hover-glow" style={{ width: `${progressPct}%` }} aria-hidden="true" />
        </div>

        <div className="cvp-controls-row">
          <div className="cvp-controls-left">
            <button
              className="cvp-btn cvp-play-btn"
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pause (k)' : 'Play (k)'}
              title={isPlaying ? 'Pause (k)' : 'Play (k)'}
            >
              {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" style={{ marginLeft: '1px' }} />}
            </button>

            <button
              className="cvp-btn cvp-seek-btn cvp-seek-back"
              onClick={(e) => { e.stopPropagation(); seekBy(-10); }}
              aria-label="Rewind 10 seconds (ArrowLeft)"
              title="Rewind 10s (←)"
            >
              <RotateCcw size={15} />
            </button>
            <button
              className="cvp-btn cvp-seek-btn cvp-seek-fwd"
              onClick={(e) => { e.stopPropagation(); seekBy(10); }}
              aria-label="Forward 10 seconds (ArrowRight)"
              title="Forward 10s (→)"
            >
              <RotateCw size={15} />
            </button>

            <span className="cvp-time" aria-live="off">
              <span className="cvp-time-current">{formatTime(currentTime)}</span>
              <span className="cvp-time-sep"> / </span>
              <span className="cvp-time-total">{formatTime(duration)}</span>
            </span>
          </div>

          <div className="cvp-controls-right">
            <div className="cvp-volume-group">
              <button
                className="cvp-btn cvp-volume-btn"
                onClick={toggleMute}
                aria-label={isMuted || volume === 0 ? 'Unmute (m)' : 'Mute (m)'}
                title={isMuted || volume === 0 ? 'Unmute (m)' : 'Mute (m)'}
              >
                {isMuted || volume === 0 ? <VolumeX size={16} /> : volume < 0.5 ? <Volume1 size={16} /> : <Volume2 size={16} />}
              </button>
              <div
                ref={volumeTrackRef}
                className="cvp-volume-slider"
                onPointerDown={handleVolumePointerDown}
                role="slider"
                aria-label="Volume"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round((isMuted ? 0 : volume) * 100)}
                title={`Volume ${Math.round((isMuted ? 0 : volume) * 100)}%`}
              >
                <div className="cvp-volume-track">
                  <div className="cvp-volume-filled" style={{ width: `${isMuted ? 0 : volume * 100}%` }} />
                  <div className="cvp-volume-thumb" style={{ left: `${isMuted ? 0 : volume * 100}%` }} />
                </div>
              </div>
            </div>

            <button
              className="cvp-btn cvp-speed-btn"
              onClick={cycleRate}
              aria-label={`Playback speed ${playbackRate}x (Shift+, /.)`}
              title={`Speed: ${playbackRate}x`}
            >
              {playbackRate}x
            </button>

            {pipSupported && (
              <button
                className={`cvp-btn cvp-pip-btn ${isPiP ? 'active' : ''}`}
                onClick={togglePiP}
                aria-label={isPiP ? 'Exit Picture-in-Picture' : 'Picture-in-Picture (p)'}
                title={isPiP ? 'Exit PiP' : 'Picture-in-Picture'}
              >
                <PictureInPicture2 size={15} />
              </button>
            )}

            <button
              className="cvp-btn cvp-fs-btn"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen (f)' : 'Fullscreen (f)'}
              title={isFullscreen ? 'Exit fullscreen (f)' : 'Fullscreen (f)'}
            >
              {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
            </button>
          </div>
        </div>
      </div>

      {/* Click-to-play hit area helper for accessibility - hidden */}
      <span className="cvp-a11y-hint" aria-hidden="true" />
    </div>
  );
}
