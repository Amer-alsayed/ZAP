import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Phone, Video, ShieldCheck, ArrowLeft, Info } from 'lucide-react';
import { renderAvatar } from './Sidebar';
import { useElasticBounce } from '../hooks/useElasticBounce';

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
  useElasticBounce(recentsContainerRef, recentsBounceWrapperRef);

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

  const [expandedCallKeys, setExpandedCallKeys] = useState({});

  const toggleExpand = (key, e) => {
    e.stopPropagation();
    setExpandedCallKeys(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  // Group call logs by day and aggregate consecutive calls from the same user
  const groupedCalls = useMemo(() => {
    const groups = {};
    filteredCalls.forEach(log => {
      const title = getGroupTitle(log.timestamp);
      if (!groups[title]) {
        groups[title] = [];
      }
      const list = groups[title];
      const prev = list.length > 0 ? list[list.length - 1] : null;

      const isSameUser = prev && prev.contact?.username?.toLowerCase() === log.contact?.username?.toLowerCase();
      const isSameType = prev && prev.callType === log.callType;
      const isSameDirection = prev && prev.isSentByMe === log.isSentByMe;

      if (isSameUser && isSameType && isSameDirection) {
        prev.count = (prev.count || 1) + 1;
        prev.attempts.push(log);
      } else {
        list.push({
          ...log,
          count: 1,
          attempts: [log]
        });
      }
    });
    return groups;
  }, [filteredCalls]);

  return (
    <div className="recents-container">
      {/* FaceTime-style Top Header */}
      <div className="recents-header">
        <div className="recents-header-left">
          {showBackButton && (
            <button className="back-btn" onClick={onBack} title="Back" aria-label="Back to conversations" style={{ marginRight: '8px' }}>
              <ArrowLeft size={20} />
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

        <div className="recents-header-right" />
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
                    const isExpanded = !!expandedCallKeys[log.id];
                    return (
                      <div className={`recents-row-wrapper ${isExpanded ? 'is-expanded' : ''}`} key={log.id}>
                        <div className="recents-row">
                          {/* Clickable Area: Opens conversation */}
                          <div className="recents-row-clickable" onClick={() => onSelectContact(log.contact)}>
                            <div className="recents-avatar">
                              {renderAvatar(log.contact?.username, log.contact?.displayName, log.contact?.avatarIcon)}
                            </div>
                            
                            <div className="recents-details">
                              <div className="recents-name-row">
                                <span className={`recents-name ${isMissed ? 'missed-red' : ''}`}>
                                  {log.contact?.displayName || log.contact?.username || 'Unknown'}
                                  {log.count > 1 && <span className="recents-count-badge"> ({log.count})</span>}
                                </span>
                                {log.contact?.isVerified && (
                                  <ShieldCheck size={16} style={{ color: 'var(--success-color)', flexShrink: 0 }} />
                                )}
                              </div>
                              
                              <div className="recents-subtitle-row">
                                {log.callType === 'video' ? (
                                  <Video size={14} className="recents-type-icon" />
                                ) : (
                                  <Phone size={14} className="recents-type-icon" />
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
                              {/* Details / Attempts Info button on the left */}
                              {log.count > 1 && (
                                <button 
                                  className={`recents-info-btn ${isExpanded ? 'active' : ''}`}
                                  onClick={(e) => toggleExpand(log.id, e)}
                                  title={isExpanded ? "Hide call attempts" : "Show call details"}
                                  aria-label={isExpanded ? "Hide call attempts" : "Show call details"}
                                >
                                  <Info size={17} />
                                </button>
                              )}

                              {/* Direct Call Back button on the right */}
                              <button 
                                className="recents-icon-btn call" 
                                title={`Call back ${log.callType}`}
                                onClick={() => onInitiateCall(log.callType, log.contact?.username)}
                                aria-label={`Call back ${log.callType}`}
                              >
                                {log.callType === 'video' ? <Video size={17} /> : <Phone size={17} />}
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Expandable attempt details drawer with smooth animated grid transition */}
                        {log.count > 1 && (
                          <div className="recents-drawer-collapse">
                            <div className="recents-drawer-inner">
                              <div className="recents-expanded-drawer">
                                {log.attempts.map((att, attIdx) => (
                                  <div className="recents-attempt-item" key={att.id || attIdx}>
                                    <div className="attempt-left">
                                      <span className="attempt-bullet">•</span>
                                      <span className="attempt-status">
                                        {att.isSentByMe ? 'Outgoing' : (att.status === 'missed' || att.status === 'cancelled') ? 'Missed' : 'Incoming'}
                                      </span>
                                      {att.duration > 0 && (
                                        <span className="attempt-duration">({formatDuration(att.duration)})</span>
                                      )}
                                    </div>
                                    <span className="attempt-time">{formatCallTimeOnly(att.timestamp)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
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
