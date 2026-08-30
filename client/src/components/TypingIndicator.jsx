import React from 'react';

// ==========================================
// Isolated Typing Indicator — isolated to prevent MessageList re-render on typing
// ==========================================
export const TypingIndicator = React.memo(({ isVisible, typingBubbleRef }) => {
  return (
    <div 
      ref={typingBubbleRef} 
      className={`typing-indicator-wrapper ${isVisible ? 'visible' : ''}`}
      aria-hidden={!isVisible}
      aria-live="polite"
    >
      <div className="typing-indicator-inner-grid">
        <div className="message-wrapper received" style={{ marginBottom: '8px' }}>
          <div className="typing-bubble">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        </div>
      </div>
    </div>
  );
});

export default TypingIndicator;
