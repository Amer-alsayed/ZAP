import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Video as VideoIcon, Play } from 'lucide-react';
import ZapLogo from './ZapLogo';
import CustomVideoPlayer from './CustomVideoPlayer';
import { loadOrFetchDecryptedMedia, setCachedMedia, getMemoryMediaUrl, inferMimeType } from '../services/mediaCache';
import { useLazyInView, createThumbnailBlob, globalMediaSessionCache, getSkeletonAspect } from '../utils/chatHelpers';

// ==========================================
// Helper component: Decrypted image loader
// ==========================================
export function ImagePreviewLoader({ fileMetadata, onImageClick, onImageLoad, isFullRes = false }) {
  const fileUrl = fileMetadata?.url;
  const containerRef = useRef(null);
  const isInViewRaw = useLazyInView(containerRef, '900px');
  const isCachedEarly = Boolean(fileUrl && (getMemoryMediaUrl(fileUrl, isFullRes) || globalMediaSessionCache.has(fileUrl)));
  const isInView = isCachedEarly || isInViewRaw;
  
  const [imgSrc, setImgSrc] = useState(() => {
    if (!fileUrl) return null;
    const memoryUrl = getMemoryMediaUrl(fileUrl, isFullRes);
    if (memoryUrl) return memoryUrl;
    if (globalMediaSessionCache.has(fileUrl)) {
      const cached = globalMediaSessionCache.get(fileUrl);
      return isFullRes ? cached.fullUrl : cached.thumbUrl;
    }
    return null;
  });
  const [error, setError] = useState(null);
  const hasRetriedRef = useRef(false);
  const [isLoaded, setIsLoaded] = useState(() => {
    if (!fileUrl) return false;
    return Boolean(getMemoryMediaUrl(fileUrl, isFullRes) || globalMediaSessionCache.has(fileUrl));
  });
  const fullResUrlRef = useRef(
    fileUrl
      ? (getMemoryMediaUrl(fileUrl, true) || (globalMediaSessionCache.has(fileUrl) ? globalMediaSessionCache.get(fileUrl).fullUrl : null))
      : null
  );

  useEffect(() => {
    if (!fileUrl) return;
    if (!isInView) return;

    const memoryUrl = getMemoryMediaUrl(fileUrl, isFullRes);
    if (memoryUrl) {
      setImgSrc(memoryUrl);
      fullResUrlRef.current = getMemoryMediaUrl(fileUrl, true) || memoryUrl;
      setIsLoaded(true);
      if (onImageLoad) onImageLoad();
      return;
    }

    if (globalMediaSessionCache.has(fileUrl)) {
      const cached = globalMediaSessionCache.get(fileUrl);
      setImgSrc(isFullRes ? cached.fullUrl : cached.thumbUrl);
      fullResUrlRef.current = cached.fullUrl;
      setIsLoaded(true);
      if (onImageLoad) onImageLoad();
      return;
    }

    let active = true;

    const loadAndDecrypt = async () => {
      try {
        const fullBlob = await loadOrFetchDecryptedMedia(fileMetadata);
        if (!active) return;
        
        const fullUrl = getMemoryMediaUrl(fileUrl, true) || URL.createObjectURL(fullBlob);

        const thumbBlob = await createThumbnailBlob(fullBlob, 480);
        if (!active) return;

        const thumbUrl = (thumbBlob === fullBlob) ? fullUrl : URL.createObjectURL(thumbBlob);

        const cacheEntry = { fullUrl, thumbUrl };
        globalMediaSessionCache.set(fileUrl, cacheEntry);
        setCachedMedia(fileUrl, fullBlob, fileMetadata.mimeType, thumbBlob);

        fullResUrlRef.current = fullUrl;
        setImgSrc(isFullRes ? fullUrl : thumbUrl);
        setIsLoaded(true);
        if (onImageLoad) onImageLoad();
      } catch (err) {
        if (active) setError(err.message || 'Media loading failed');
      }
    };

    loadAndDecrypt();

    return () => {
      active = false;
    };
  }, [fileUrl, isFullRes, isInView]);

  if (error) return <span ref={containerRef} style={{ color: 'var(--text-muted, #a0aec0)', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', padding: '6px 10px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '6px' }}><AlertTriangle size={14} style={{ color: '#e53e3e' }} /> {error}</span>;

  const skeletonAspect = !isFullRes ? getSkeletonAspect(fileUrl, fileMetadata?.width, fileMetadata?.height) : null;
  const containerStyle = !isFullRes && !isLoaded ? { '--skeleton-aspect': skeletonAspect } : undefined;

  return (
    <div ref={containerRef} className={`image-loader-container ${isLoaded ? 'is-ready' : 'is-decrypting'} ${isFullRes ? 'is-fullres' : ''}`} style={containerStyle}>
      <div className="image-skeleton-loader" aria-hidden={isLoaded}>
        <div className="skeleton-shimmer-bg" />
        <div className="skeleton-shimmer-wave" />
        <div className="media-decrypt-spinner-badge">
          <div className="media-decrypt-spinner-ring" />
          <ZapLogo size={22} variant="accent" glow={false} className="media-decrypt-logo" />
        </div>
        {fileMetadata?.size && (
          <span className="media-decrypt-size-pill">
            {(fileMetadata.size / 1024).toFixed(0)} KB
          </span>
        )}
      </div>
      
      {imgSrc && (
        <img 
          className={`message-image ${isLoaded ? 'loaded' : 'is-loading'}`}
          src={imgSrc} 
          alt="" 
          loading="lazy"
          decoding="async"
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          onClick={onImageClick ? () => onImageClick(fullResUrlRef.current || imgSrc) : undefined}
          onLoad={() => {
            setIsLoaded(true);
            if (onImageLoad) onImageLoad();
          }}
          onError={() => {
            if (!hasRetriedRef.current && fileMetadata?.url) {
              hasRetriedRef.current = true;
              loadOrFetchDecryptedMedia(fileMetadata, true).then((blob) => {
                const correctMime = inferMimeType(fileMetadata.name, fileMetadata.mimeType);
                const fixedBlob = new Blob([blob], { type: correctMime });
                const newUrl = URL.createObjectURL(fixedBlob);
                setImgSrc(newUrl);
                setIsLoaded(true);
              }).catch(() => {
                setError('Image failed to load');
              });
            } else {
              setError('Image failed to load');
            }
          }}
          style={{
            cursor: onImageClick ? 'pointer' : 'default'
          }}
        />
      )}
    </div>
  );
}

// ==========================================
// Helper component: Decrypted video loader — lazy
// ==========================================
export function VideoPreviewLoader({ fileMetadata, compact = false }) {
  const [videoSrc, setVideoSrc] = useState(null);
  const [error, setError] = useState(false);
  const objectUrlRef = useRef(null);
  const containerRef = useRef(null);
  const isInViewRaw = useLazyInView(containerRef, '900px');
  const isCached = Boolean(fileMetadata?.url && (getMemoryMediaUrl(fileMetadata.url, false) || globalMediaSessionCache.has(fileMetadata.url)));
  const isInView = isCached || isInViewRaw;

  useEffect(() => {
    if (!isInView) return;
    let active = true;

    const mem = fileMetadata?.url ? getMemoryMediaUrl(fileMetadata.url, false) : null;
    if (mem) {
      setVideoSrc(mem);
      return;
    }
    if (fileMetadata?.url && globalMediaSessionCache.has(fileMetadata.url)) {
      const cached = globalMediaSessionCache.get(fileMetadata.url);
      setVideoSrc(cached.fullUrl || cached.thumbUrl);
      return;
    }

    const loadAndDecrypt = async () => {
      try {
        const blob = await loadOrFetchDecryptedMedia(fileMetadata);
        if (!active) return;
        const localUrl = URL.createObjectURL(blob);
        objectUrlRef.current = localUrl;
        setVideoSrc(localUrl);
      } catch (err) {
        console.error(err);
        if (active) setError(true);
      }
    };

    loadAndDecrypt();

    return () => {
      active = false;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [fileMetadata, isInView]);

  const skeletonAspect = getSkeletonAspect(fileMetadata?.url);
  const showSkeleton = !videoSrc;

  if (error) return <span ref={containerRef} style={{ color: 'var(--danger-color)', display: 'flex', alignItems: 'center', gap: '4px' }}><AlertTriangle size={14} /> Video Decryption Failed</span>;

  if (compact) {
    return (
      <div
        ref={containerRef}
        className={`video-loader-container ${showSkeleton ? 'is-decrypting' : 'is-ready'} cvp-compact-host`}
        style={showSkeleton ? { '--skeleton-aspect': skeletonAspect } : undefined}
      >
        {showSkeleton && (
          <div className="image-skeleton-loader video-skeleton" aria-hidden={false}>
            <div className="skeleton-shimmer-bg" />
            <div className="skeleton-shimmer-wave" />
            <div className="media-decrypt-spinner-badge">
              <div className="media-decrypt-spinner-ring" />
              <VideoIcon size={18} style={{ color: 'var(--accent-color)', opacity: 0.95 }} />
            </div>
            <span className="media-decrypt-size-pill">{isInView ? 'Decrypting…' : 'Video'}</span>
          </div>
        )}
        {videoSrc && (
          <div className="cvp-compact-thumb">
            <video
              src={videoSrc}
              muted
              playsInline
              preload="metadata"
              className="cvp-compact-video"
              onLoadedMetadata={(e) => {
                try { e.currentTarget.currentTime = 0.1; } catch (_) {}
              }}
            />
            <div className="cvp-compact-play-badge" aria-hidden="true">
              <Play size={14} fill="white" style={{ marginLeft: '1px' }} />
            </div>
            <div className="cvp-compact-duration">
              <VideoIcon size={10} />
              <span>Video</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`video-loader-container ${showSkeleton ? 'is-decrypting' : 'is-ready'}`}
      style={showSkeleton ? { '--skeleton-aspect': skeletonAspect } : undefined}
    >
      {showSkeleton && (
        <div className="image-skeleton-loader video-skeleton" aria-hidden={false}>
          <div className="skeleton-shimmer-bg" />
          <div className="skeleton-shimmer-wave" />
          <div className="media-decrypt-spinner-badge">
            <div className="media-decrypt-spinner-ring" />
            <VideoIcon size={18} style={{ color: 'var(--accent-color)', opacity: 0.95 }} />
          </div>
          <span className="media-decrypt-size-pill">{isInView ? 'Decrypting…' : 'Video'}</span>
        </div>
      )}
      {videoSrc && (
        <div className="cvp-host">
          <CustomVideoPlayer src={videoSrc} fileMetadata={fileMetadata} compact={false} />
        </div>
      )}
    </div>
  );
}

// ==========================================
// Helper component: Background voice note pre-cache loader — lazy
// ==========================================
export function VoiceNotePreloader({ fileMetadata }) {
  const ref = useRef(null);
  const isInViewRaw = useLazyInView(ref, '1000px');
  const isCached = Boolean(fileMetadata?.url && getMemoryMediaUrl(fileMetadata.url, false));
  const isInView = isCached || isInViewRaw;
  useEffect(() => {
    if (!isInView) return;
    if (fileMetadata && fileMetadata.url) {
      loadOrFetchDecryptedMedia(fileMetadata).catch((err) => {
        console.warn('Voice note pre-cache warning:', err);
      });
    }
  }, [fileMetadata, isInView]);

  return <span ref={ref} style={{ display: 'contents' }} aria-hidden="true" />;
}
