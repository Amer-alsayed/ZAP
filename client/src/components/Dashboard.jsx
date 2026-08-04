import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Phone, Video, ShieldCheck, ArrowLeft } from 'lucide-react';
import { renderAvatar } from './Sidebar';

export default function Dashboard({ currentUser, contacts, onInitiateCall, onSelectContact, onBack, showBackButton }) {
  const [activeTab, setActiveTab] = useState('all'); // 'all' or 'missed'
  const recentsContainerRef = useRef(null);
  const recentsBounceWrapperRef = useRef(null);

  // Parse call logs from all contact messages
  const callLogs = useMemo(() => {
    const logs = [];
    if (!contacts) return logs;
    contacts.forEach(contact => {
      if (contact.messages) {
        contact.messages.forEach(msg => {
          if (msg.mediaType === 'call') {
            try {
              const callData = JSON.parse(msg.text);
              const isSentByMe = msg.sender?.toLowerCase() === currentUser?.username?.toLowerCase();
              logs.push({
                id: msg.id || msg.timestamp,
                timestamp: msg.timestamp,
                sender: msg.sender,
                callType: callData.callType || 'voice', // voice or video
                status: callData.status || 'ended', // missed, connected, etc.
                duration: callData.duration || 0,
                isSentByMe,
                contact
              });
            } catch (e) {
              // fallback if not JSON
            }
          }
        });
      }
    });

    // Sort logs by newest first with NaN protection
    logs.sort((a, b) => {
      const tA = (a.timestamp && !isNaN(new Date(a.timestamp).getTime())) ? new Date(a.timestamp).getTime() : 0;
      const tB = (b.timestamp && !isNaN(new Date(b.timestamp).getTime())) ? new Date(b.timestamp).getTime() : 0;
      return tB - tA;
    });

    return logs;
  }, [contacts, currentUser]);

  // Filter based on active tab
  const filteredCalls = useMemo(() => {
    return callLogs.filter(log => {
      if (activeTab === 'missed') {
        return (log.status === 'missed' || log.status === 'cancelled' || log.status === 'declined') && !log.isSentByMe;
      }
      return true;
    });
  }, [callLogs, activeTab]);

  // Hook for elastic overscroll bounce (rubber-banding)
  useEffect(() => {
    const container = recentsContainerRef.current;
    const wrapper = recentsBounceWrapperRef.current;
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
  }, [activeTab, filteredCalls.length]);

  const formatCallTimeOnly = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDuration = (seconds) => {
    if (!seconds) return 'Missed';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  // Group headers: Today, Yesterday, Weekday, or specific Calendar Date
  const getGroupTitle = (timestamp) => {
    if (!timestamp) return 'Earlier';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return 'Earlier';

    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const isSameDay = (d1, d2) => 
      d1.getDate() === d2.getDate() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getFullYear() === d2.getFullYear();

    if (isSameDay(date, today)) {
      return 'Today';
    } else if (isSameDay(date, yesterday)) {
      return 'Yesterday';
    } else {
      const diffTime = Math.abs(today - date);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays < 7) {
        return date.toLocaleDateString([], { weekday: 'long' });
      } else {
        return date.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
      }
    }
  };

  // Group call logs by day
  const groupedCalls = useMemo(() => {
    const groups = {};
    filteredCalls.forEach(log => {
      const title = getGroupTitle(log.timestamp);
      if (!groups[title]) {
        groups[title] = [];
      }
      groups[title].push(log);
    });
    return groups;
  }, [filteredCalls]);

  return (
    <div className="recents-container">
      {/* FaceTime-style Top Header */}
      <div className="recents-header">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {showBackButton && (
            <button className="back-btn" onClick={onBack} title="Back" aria-label="Back to conversations" style={{ marginRight: '8px' }}>
              <ArrowLeft size={18} />
            </button>
          )}
          <h1 className="recents-title">Recents</h1>
        </div>
        
        {/* Segmented Control: All / Missed */}
        <div className="segmented-control">
          <div 
            className="segmented-slider" 
            style={{ 
              transform: activeTab === 'missed' ? 'translateX(100%)' : 'translateX(0)' 
            }} 
          />
          <button 
            className={`control-btn ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All
          </button>
          <button 
            className={`control-btn ${activeTab === 'missed' ? 'active' : ''}`}
            onClick={() => setActiveTab('missed')}
          >
            Missed
          </button>
        </div>
        
        <div style={{ width: '80px' }} /> {/* Spacer to balance the title on desktop */}
      </div>

      {/* Recents Scrollable List */}
      <div className="recents-list-wrapper" ref={recentsContainerRef}>
        {filteredCalls.length === 0 ? (
          <div className="recents-empty">
            <Phone size={48} style={{ opacity: 0.15, marginBottom: '16px' }} />
            <h3>No Recents</h3>
            <p>{activeTab === 'missed' ? 'You have no missed calls.' : 'Your call history is empty.'}</p>
          </div>
        ) : (
          <div className="recents-bounce-wrapper" ref={recentsBounceWrapperRef} style={{ width: '100%' }}>
            <div className="recents-list" key={activeTab}>
              {Object.entries(groupedCalls).map(([groupTitle, logs]) => (
                <React.Fragment key={groupTitle}>
                  {/* Clean flat group date headers */}
                  <div className="recents-group-header">{groupTitle}</div>
                  {logs.map((log) => {
                    const isMissed = (log.status === 'missed' || log.status === 'cancelled' || log.status === 'declined') && !log.isSentByMe;
                    return (
                      <div className="recents-row" key={log.id}>
                        {/* Clickable Area: Opens conversation */}
                        <div className="recents-row-clickable" onClick={() => onSelectContact(log.contact)}>
                          <div className="recents-avatar">
                            {renderAvatar(log.contact?.username, log.contact?.displayName, log.contact?.avatarIcon)}
                          </div>
                          
                          <div className="recents-details">
                            <div className="recents-name-row">
                              <span className={`recents-name ${isMissed ? 'missed-red' : ''}`}>
                                {log.contact?.displayName || log.contact?.username || 'Unknown'}
                              </span>
                              {log.contact?.isVerified && (
                                <ShieldCheck size={13} style={{ color: 'var(--success-color)', flexShrink: 0 }} />
                              )}
                            </div>
                            
                            <div className="recents-subtitle-row">
                              {log.callType === 'video' ? (
                                <Video size={12} className="recents-type-icon" />
                              ) : (
                                <Phone size={12} className="recents-type-icon" />
                              )}
                              <span className="recents-subtitle">
                                {log.isSentByMe ? (
                                  log.status === 'declined'
                                    ? `Declined ${log.callType === 'video' ? 'Video Call' : 'Voice Call'}`
                                    : `Outgoing ${log.callType === 'video' ? 'Video Call' : 'Voice Call'}`
                                ) : (
                                  log.status === 'declined'
                                    ? `Declined ${log.callType === 'video' ? 'Video Call' : 'Voice Call'}`
                                    : `${(log.status === 'missed' || log.status === 'cancelled') ? 'Missed' : 'Incoming'} ${log.callType === 'video' ? 'Video Call' : 'Voice Call'}`
                                )}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Right Side: Timestamp and Callback Actions */}
                        <div className="recents-right">
                          <span className="recents-time">{formatCallTimeOnly(log.timestamp)}</span>
                          
                          <div className="recents-actions">
                            {/* Direct Call Back button */}
                            <button 
                              className="recents-icon-btn call" 
                              title={`Call back ${log.callType}`}
                              onClick={() => onInitiateCall(log.callType, log.contact?.username)}
                            >
                              {log.callType === 'video' ? <Video size={16} /> : <Phone size={16} />}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
