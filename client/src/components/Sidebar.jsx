import React, { useState, useEffect } from 'react';
import { Search, UserPlus, MessageSquare, ShieldCheck, ShieldAlert, Settings, Phone, PhoneOff, Video, VideoOff, Mic, Image, FileText, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { searchUser } from '../services/api';
import { emitGetUserStatus } from '../services/socket';

export const renderAvatar = (username, displayName, avatarIcon, customSizeStyle = {}) => {
  const displayInitials = (displayName || username).substring(0, 2).toUpperCase();
  
  let avatarColor = '#0a84ff'; // default accent blue
  let avatarEmoji = null;
  let avatarImage = null;

  if (avatarIcon) {
    try {
      const parsed = JSON.parse(avatarIcon);
      if (parsed.image) {
        avatarImage = parsed.image; // base64 string
      } else {
        if (parsed.color) {
          const colorMap = {
            blue: '#0a84ff',
            purple: '#bf5af2',
            emerald: '#30d158',
            orange: '#ff9f0a',
            rose: '#ff375f'
          };
          avatarColor = colorMap[parsed.color] || parsed.color;
        }
        if (parsed.emoji) {
          avatarEmoji = parsed.emoji;
        }
      }
    } catch (e) {
      // Ignore parse error
    }
  }

  // Render base64 image if present
  if (avatarImage) {
    return (
      <div 
        className="avatar" 
        style={{ 
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...customSizeStyle 
        }}
      >
        <img 
          src={avatarImage} 
          alt={`${username}'s avatar`} 
          style={{ 
            width: '100%', 
            height: '100%', 
            objectFit: 'cover' 
          }} 
        />
      </div>
    );
  }

  return (
    <div 
      className="avatar" 
      style={{ 
        backgroundColor: avatarColor, 
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: '600',
        color: '#ffffff',
        ...customSizeStyle 
      }}
    >
      {avatarEmoji ? avatarEmoji : displayInitials}
    </div>
  );
};

export const renderLastMessagePreview = (lastMsg, currentUser) => {
  if (!lastMsg) return 'No messages yet';

  const isSentByMe = lastMsg.sender?.toLowerCase() === currentUser.username?.toLowerCase();

  const renderTicks = () => {
    if (!isSentByMe) return null;
    let ticksColor = 'var(--text-subtle)';
    let ticksText = '✓';

    if (lastMsg.status === 1) {
      ticksText = '✓✓';
    } else if (lastMsg.status === 2) {
      ticksText = '✓✓';
      ticksColor = '#38bdf8'; // sky blue
    }

    return (
      <span style={{ 
        color: ticksColor, 
        marginRight: '5px', 
        fontSize: '11px', 
        fontWeight: 'bold', 
        fontFamily: 'sans-serif',
        display: 'inline-block',
        flexShrink: 0
      }}>
        {ticksText}
      </span>
    );
  };

  let content = null;

  if (lastMsg.mediaType === 'call') {
    let callData = { callType: 'voice', status: 'completed' };
    try {
      callData = JSON.parse(lastMsg.text);
    } catch (e) {
      // Fallback
    }
    const isVoice = callData.callType === 'voice';
    const isMissed = callData.status === 'missed' || callData.status === 'cancelled';

    if (isSentByMe) {
      content = (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          {isVoice ? <Phone size={11} style={{ opacity: 0.7 }} /> : <Video size={11} style={{ opacity: 0.7 }} />}
          Outgoing Call
        </span>
      );
    } else {
      content = (
        <span style={{ 
          display: 'inline-flex', 
          alignItems: 'center', 
          gap: '4px', 
          color: isMissed ? '#ff453a' : 'inherit',
          fontWeight: isMissed ? '500' : 'normal'
        }}>
          {isMissed ? (
            isVoice ? <PhoneOff size={11} /> : <VideoOff size={11} />
          ) : (
            isVoice ? <Phone size={11} /> : <Video size={11} />
          )}
          {isMissed ? 'Missed Call' : 'Incoming Call'}
        </span>
      );
    }
  } else if (lastMsg.mediaType === 'voice') {
    content = (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        <Mic size={11} style={{ opacity: 0.7 }} />
        Voice Message
      </span>
    );
  } else if (lastMsg.mediaType === 'file') {
    const isImg = lastMsg.fileMetadata?.mimeType?.startsWith('image/');
    const isVid = lastMsg.fileMetadata?.mimeType?.startsWith('video/');
    content = (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        {isImg ? <Image size={11} style={{ opacity: 0.7 }} /> : isVid ? <Video size={11} style={{ opacity: 0.7 }} /> : <FileText size={11} style={{ opacity: 0.7 }} />}
        {isImg ? 'Photo' : isVid ? 'Video' : 'Document'}
      </span>
    );
  } else {
    content = <span>{lastMsg.text}</span>;
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
      {renderTicks()}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
        {content}
      </span>
    </span>
  );
};

export default function Sidebar({ currentUser, contacts, activeContact, setActiveContact, addContact, onLogout, onShowSettings, onShowRecents, isMinimized, onToggleMinimize, showSettings = false, showRecents = false }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [searchError, setSearchError] = useState('');
  const [loadingSearch, setLoadingSearch] = useState(false);

  // Auto-clear search results/errors when search input is cleared
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setSearchResult(null);
      setSearchError('');
    }
  }, [searchQuery]);

  const handleSearch = async (e) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (!query || query.toLowerCase() === currentUser.username.toLowerCase()) return;

    setLoadingSearch(true);
    setSearchError('');
    setSearchResult(null);

    try {
      const data = await searchUser(query, currentUser.token);
      setSearchResult(data);
    } catch (err) {
      setSearchError(err.message || 'User not found');
    } finally {
      setLoadingSearch(false);
    }
  };

  const handleAddContact = () => {
    if (!searchResult) return;
    addContact({
      username: searchResult.username,
      displayName: searchResult.displayName,
      avatarIcon: searchResult.avatarIcon,
      publicIdentityKey: searchResult.publicIdentityKey,
      publicSigningKey: searchResult.publicSigningKey,
      status: 'offline', // Will check dynamically
      unreadCount: 0
    });
    setSearchResult(null);
    setSearchQuery('');
  };

  const filteredContacts = contacts.filter(contact => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return (
      (contact.username || '').toLowerCase().includes(query) ||
      (contact.displayName || '').toLowerCase().includes(query)
    );
  });

  return (
    <div className="sidebar glass">
      {/* Sidebar Header */}
      <div className="sidebar-header">
        <div className="profile-info">
          {renderAvatar(currentUser.username, currentUser.displayName, currentUser.avatarIcon)}
          <div className="username-display">
            <h3>{currentUser.displayName || currentUser.username}</h3>
            <span><ShieldCheck size={12} /> Encrypted Session</span>
          </div>
        </div>
      </div>

      {/* User Search */}
      <div className="search-container">
        <form onSubmit={handleSearch} className="search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search username..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </form>

        {loadingSearch && <div style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center' }}>Searching...</div>}
        
        {searchError && (
          <div style={{ fontSize: '13px', color: 'var(--danger-color)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <ShieldAlert size={14} /> {searchError}
          </div>
        )}

        {searchResult && (
          <div className="search-result-card">
            <div className="search-result-info">
              {renderAvatar(searchResult.username, searchResult.displayName, searchResult.avatarIcon, { width: '32px', height: '32px', fontSize: '13px' })}
              <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: '500' }}>
                {searchResult.displayName || searchResult.username}
                {searchResult.displayName && <span style={{ color: 'var(--text-muted)', fontSize: '11px', marginLeft: '4px', fontWeight: '400' }}>@{searchResult.username}</span>}
              </span>
            </div>
            <button className="add-contact-btn" onClick={handleAddContact}>
              Add Chat
            </button>
          </div>
        )}
      </div>

      {/* Contacts List */}
      <div className="contacts-header">Conversations</div>
      <div className="contacts-list-container">
        {contacts.length === 0 ? (
          !isMinimized ? (
            <div className="no-contacts">
              <MessageSquare size={36} strokeWidth={1} style={{ marginBottom: '8px', color: 'var(--text-subtle)' }} />
              <p>No active chats.</p>
              <p style={{ fontSize: '12px', color: 'var(--text-subtle)', marginTop: '4px' }}>Search a username above to start a secure chat.</p>
            </div>
          ) : null
        ) : filteredContacts.length === 0 ? (
          !isMinimized ? (
            <div className="no-contacts">
              <Search size={36} strokeWidth={1} style={{ marginBottom: '8px', color: 'var(--text-subtle)' }} />
              <p>No matches found.</p>
              <p style={{ fontSize: '12px', color: 'var(--text-subtle)', marginTop: '4px' }}>No active conversations match "{searchQuery}".</p>
            </div>
          ) : null
        ) : (
          filteredContacts.map((contact) => {
            const isSelected = activeContact?.username === contact.username;
            const lastMsg = contact.messages && contact.messages.length > 0 
              ? contact.messages[contact.messages.length - 1]
              : null;

            return (
              <div
                key={contact.username}
                className={`contact-item ${isSelected ? 'active' : ''} ${contact.isTyping ? 'typing' : ''}`}
                onClick={() => {
                  setActiveContact(contact);
                  setSearchQuery('');
                }}
              >
                <div className="contact-avatar-container">
                  {renderAvatar(contact.username, contact.displayName, contact.avatarIcon)}
                  <div className={`status-dot ${contact.status === 'online' ? 'online' : 'offline'}`} />
                  {isMinimized && contact.unreadCount > 0 && (
                    <span key={contact.unreadCount} className="unread-badge minimized-badge">{contact.unreadCount}</span>
                  )}
                </div>
                <div className="contact-info">
                  <div className="contact-name-row">
                    <span className="contact-name" style={{ display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {contact.displayName || contact.username}
                      </span>
                      {contact.isVerified && <ShieldCheck size={14} style={{ color: 'var(--accent-color)', flexShrink: 0 }} title="E2EE Verified Identity" />}
                    </span>
                    {lastMsg && (
                      <span className="last-msg-time">
                        {new Date(lastMsg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                  {contact.displayName && (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '-2px', marginBottom: '2px', fontFamily: 'monospace' }}>
                      @{contact.username}
                    </div>
                  )}
                  <div className="contact-preview-row">
                    <div style={{
                      flex: 1,
                      minWidth: 0,
                      color: contact.isTyping ? 'var(--text-link)' : 'var(--text-muted)',
                      fontWeight: contact.isTyping ? '500' : 'normal',
                      fontSize: '13px'
                    }}>
                      {contact.isTyping 
                        ? 'typing...'
                        : renderLastMessagePreview(lastMsg, currentUser)
                      }
                    </div>
                    {contact.unreadCount > 0 && (
                      <span key={contact.unreadCount} className="unread-badge">{contact.unreadCount}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="sidebar-footer">
        <button className={`sidebar-settings-btn ${showSettings ? 'active' : ''}`} title="Settings" onClick={onShowSettings}>
          <Settings size={20} />
        </button>
        <button className={`sidebar-calls-btn ${showRecents ? 'active' : ''}`} title="Recent Calls" onClick={onShowRecents}>
          <Phone size={20} />
        </button>
        <button className="minimize-btn" onClick={onToggleMinimize} title={isMinimized ? "Expand Sidebar" : "Minimize Sidebar"}>
          {isMinimized ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
        </button>
      </div>
    </div>
  );
}
