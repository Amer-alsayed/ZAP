import React, { useState, useEffect } from 'react';
import { Play, Pause } from 'lucide-react';
import { VoiceNotePreloader } from './MediaLoaders';
import { audioProgressManager } from '../utils/chatHelpers';

// ==========================================
// Isolated Voice Note Player Component
// Subscribes locally to audioProgressManager so MessageList never re-renders during playback
// ==========================================
export const VoiceNotePlayerItem = React.memo(({
  msg,
  file,
  isSent,
  isPlaying,
  playbackRate,
  onTogglePlay,
  onPlaybackRateChange,
  selectionModeRef,
  formatMessageTime,
  formatTime
}) => {
  const [progress, setProgress] = useState(() => audioProgressManager.getProgress(msg.id));
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const totalDuration = file?.duration || 0;

  useEffect(() => {
    const unsub = audioProgressManager.subscribe(msg.id, (prog, currentSec) => {
      setProgress(prog);
      setCurrentTimeSec(currentSec);
    });
    return unsub;
  }, [msg.id]);

  const displayTime = isPlaying || progress > 0
    ? currentTimeSec
    : (progress / 100) * totalDuration;

  return (
    <div className="voice-note-player-compact">
      <VoiceNotePreloader fileMetadata={file} />
      {/* Row 1 (Top): Circular Play Button + Progress Scrubber Track */}
      <div className="voice-row-top">
        <button 
          className="play-pause-btn-compact" 
          onClick={() => { if (!selectionModeRef?.current) onTogglePlay(msg.id, file); }}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" style={{ marginLeft: '1.5px' }} />}
        </button>

        <div 
          className="voice-slider-container"
          onMouseDown={(e) => { e.stopPropagation(); }}
          onTouchStart={(e) => { e.stopPropagation(); }}
          onPointerDown={(e) => { e.stopPropagation(); }}
        >
          <input 
            type="range"
            className="voice-slider"
            min="0"
            max="100"
            step="0.1"
            value={progress}
            onMouseDown={(e) => { e.stopPropagation(); }}
            onTouchStart={(e) => { e.stopPropagation(); }}
            onPointerDown={(e) => { e.stopPropagation(); }}
            onInput={(e) => {
              const seekPct = parseFloat(e.target.value) / 100;
              if (!selectionModeRef?.current) onTogglePlay(msg.id, file, seekPct, false);
            }}
            onChange={(e) => {
              const seekPct = parseFloat(e.target.value) / 100;
              if (!selectionModeRef?.current) onTogglePlay(msg.id, file, seekPct, false);
            }}
            style={{
              background: `linear-gradient(to right, var(--accent-color) ${progress}%, rgba(255, 255, 255, 0.15) ${progress}%)`
            }}
          />
        </div>
      </div>

      {/* Row 2 (Bottom): Duration (Left) + Speed & Timestamp (Right) */}
      <div className="voice-row-bottom">
        <span className="voice-duration">
          {formatTime(displayTime)} / {formatTime(totalDuration)}
        </span>
        <div className="voice-bottom-right">
          <button 
            className="voice-speed-btn" 
            title={`Playback speed ${playbackRate}x`}
            aria-label={`Playback speed ${playbackRate}x`}
            onClick={(e) => {
              e.stopPropagation();
              const nextRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
              onPlaybackRateChange(nextRate);
            }}
          >
            {playbackRate}x
          </button>
          <span className="voice-inline-meta">
            <span className="inline-meta-time">{formatMessageTime(msg.timestamp)}</span>
            {isSent && (
              <span className="inline-meta-ticks">
                {msg.status === 0 && <span className="tick-single">✓</span>}
                {msg.status === 1 && <span className="tick-delivered">✓✓</span>}
                {msg.status === 2 && <span className="tick-read">✓✓</span>}
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
});

export default VoiceNotePlayerItem;
