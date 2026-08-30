import React from 'react';
import { ImagePreviewLoader, VideoPreviewLoader } from './MediaLoaders';

// WhatsApp-style Media Collage Grid with Fullscreen Gallery Modal Support
export const MediaAlbumGrid = React.memo(function MediaAlbumGrid({ 
  albumItems, 
  onImageClick, 
  selectionMode, 
  isLast, 
  handleImageLoad, 
  onOpenGallery 
}) {
  const total = albumItems.length;

  const displayItems = albumItems.slice(0, 4);
  const remainingCount = total - 3;

  let gridClass = 'album-grid-4';
  if (total === 2) gridClass = 'album-grid-2';
  else if (total === 3) gridClass = 'album-grid-3';

  return (
    <div className="media-album-wrapper">
      <div className={`media-album-grid ${gridClass}`}>
        {displayItems.map((item, idx) => {
          const isFourthWithMore = idx === 3 && total > 4;
          const file = item.fileMetadata;
          const isImage = file?.mimeType?.startsWith('image/');
          const isVideo = file?.mimeType?.startsWith('video/');

          return (
            <div 
              key={item.id || idx} 
              className={`album-grid-cell cell-${idx + 1}`}
              onClick={(e) => {
                if (selectionMode) return;
                e.stopPropagation();
                if (onOpenGallery) onOpenGallery(albumItems, idx);
              }}
            >
              {isImage ? (
                <ImagePreviewLoader 
                  fileMetadata={file} 
                  onImageClick={() => {
                    if (!selectionMode && onOpenGallery) onOpenGallery(albumItems, idx);
                  }}
                  onImageLoad={handleImageLoad} 
                />
              ) : isVideo ? (
                <VideoPreviewLoader fileMetadata={file} compact={true} />
              ) : null}

              {isFourthWithMore && (
                <div 
                  className="album-more-overlay"
                  role="button"
                  title={`View all ${total} media items in full screen`}
                  onClick={(e) => {
                    if (selectionMode) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (onOpenGallery) onOpenGallery(albumItems, 3);
                  }}
                >
                  <span className="album-more-text">+{remainingCount}</span>
                  <span className="album-more-sub">See all {total}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default MediaAlbumGrid;
