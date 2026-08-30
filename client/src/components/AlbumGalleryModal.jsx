import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Download, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { loadOrFetchDecryptedMedia } from '../services/mediaCache';
import { ImagePreviewLoader, VideoPreviewLoader } from './MediaLoaders';

// Fullscreen Interactive Album Gallery Modal
export const AlbumGalleryModal = ({ items, initialIndex = 0, isExiting = false, onClose }) => {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [isOpen, setIsOpen] = useState(false);
  const currentItem = items[activeIndex];
  const total = items.length;
  const touchStartRef = useRef(null);
  const isClosingRef = useRef(false);

  useEffect(() => {
    window.__isMediaModalOpen = true;
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    const timer = requestAnimationFrame(() => setIsOpen(true));
    return () => {
      cancelAnimationFrame(timer);
      window.__isMediaModalOpen = false;
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
    };
  }, []);

  const handleClose = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    setIsOpen(false);
    setTimeout(() => {
      onClose();
    }, 250);
  }, [onClose]);

  const handleOverlayClick = useCallback((e) => {
    if (
      e.target.closest('.gallery-nav-btn') ||
      e.target.closest('.gallery-action-btn') ||
      e.target.closest('.album-gallery-filmstrip') ||
      e.target.closest('.message-image') ||
      e.target.closest('.message-video') ||
      e.target.closest('.gallery-caption-bar') ||
      e.target.closest('.cvp-root') ||
      e.target.closest('.cvp-controls') ||
      e.target.closest('.cvp-btn')
    ) {
      return;
    }
    handleClose();
  }, [handleClose]);

  const handlePrev = useCallback(() => {
    setActiveIndex(prev => (prev > 0 ? prev - 1 : total - 1));
  }, [total]);

  const handleNext = useCallback(() => {
    setActiveIndex(prev => (prev < total - 1 ? prev + 1 : 0));
  }, [total]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') handleClose();
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'ArrowRight') handleNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose, handlePrev, handleNext]);

  const file = currentItem?.fileMetadata;
  const isImage = file?.mimeType?.startsWith('image/');
  const isVideo = file?.mimeType?.startsWith('video/');

  const handleDownloadCurrent = async () => {
    if (!file) return;
    try {
      const blob = await loadOrFetchDecryptedMedia(file);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name || 'media';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    }
  };

  return createPortal(
    <div 
      className={`album-gallery-modal-overlay ${(isOpen && !isExiting) ? 'visible' : ''}`}
      onClick={handleOverlayClick}
      onTouchStart={(e) => {
        touchStartRef.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touchStartRef.current === null) return;
        const deltaX = e.changedTouches[0].clientX - touchStartRef.current;
        if (deltaX > 45) handlePrev();
        else if (deltaX < -45) handleNext();
        touchStartRef.current = null;
      }}
    >
      {/* Top Navigation Bar */}
      <div className="album-gallery-header">
        <div className="album-gallery-title-info">
          {total > 1 && <span className="album-gallery-counter">{activeIndex + 1} of {total}</span>}
          {file?.name && <span className="album-gallery-filename">{file.name}</span>}
        </div>
        <div className="album-gallery-actions">
          <button 
            className="gallery-action-btn" 
            onClick={handleDownloadCurrent}
            title="Download file"
            aria-label="Download file"
          >
            <Download size={19} />
          </button>
          <button 
            className="gallery-action-btn close-btn" 
            onClick={handleClose}
            title="Close viewer"
            aria-label="Close viewer"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Main Full-Size Media Container */}
      <div className="album-gallery-main">
        {total > 1 && (
          <button 
            className="gallery-nav-btn prev-btn" 
            onClick={(e) => {
              e.stopPropagation();
              handlePrev();
            }}
            title="Previous (Left Arrow)"
            aria-label="Previous"
          >
            <ChevronLeft size={28} />
          </button>
        )}

        <div className="album-gallery-stage">
          {isImage ? (
            <ImagePreviewLoader 
              fileMetadata={file} 
              isFullRes={true}
            />
          ) : isVideo ? (
            <VideoPreviewLoader fileMetadata={file} />
          ) : null}
          {currentItem?.text && (
            <div className="gallery-caption-bar">
              <p>{currentItem.text}</p>
            </div>
          )}
        </div>

        {total > 1 && (
          <button 
            className="gallery-nav-btn next-btn" 
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            title="Next (Right Arrow)"
            aria-label="Next"
          >
            <ChevronRight size={28} />
          </button>
        )}
      </div>

      {/* Bottom Filmstrip Carousel */}
      {total > 1 && (
        <div className="album-gallery-filmstrip" onClick={(e) => e.stopPropagation()}>
          <div className="filmstrip-track">
            {items.map((item, idx) => {
              const itemFile = item.fileMetadata;
              const isActive = idx === activeIndex;
              return (
                <button
                  key={item.id || idx}
                  className={`filmstrip-thumb ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveIndex(idx)}
                  title={`Photo ${idx + 1}`}
                >
                  <ImagePreviewLoader fileMetadata={itemFile} />
                  {isActive && <div className="active-thumb-glow" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};

export default AlbumGalleryModal;
