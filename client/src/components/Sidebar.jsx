import React, { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, UserPlus, MessageSquare, ShieldCheck, ShieldAlert, Settings, Phone, PhoneOff, Video, VideoOff, Mic, Image, FileText, PanelLeftClose, PanelLeftOpen, Trash2, Ban, X, AlertTriangle, Pencil } from 'lucide-react';
import ZapLogo from './ZapLogo';
import { searchUser } from '../services/api';
import { emitGetUserStatus } from '../services/socket';

const formatSidebarTime = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const renderAvatar = (username, displayName, avatarIcon, customSizeStyle = {}) => {
  const displayInitials = (displayName || username || 'U').substring(0, 2).toUpperCase();
  
  let avatarColor = 'var(--accent-color)'; // default accent theme color
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
            blue: 'var(--accent-color)',
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

  const isSentByMe = lastMsg.sender?.toLowerCase() === currentUser?.username?.toLowerCase();

  const renderTicks = () => {
    if (!isSentByMe) return null;
    let ticksColor = 'rgba(255, 255, 255, 0.4)';
    let ticksText = '✓';

    if (lastMsg.status === 1) {
      ticksText = '✓✓';
    } else if (lastMsg.status === 2) {
      ticksText = '✓✓';
      ticksColor = 'var(--accent-text)';
    }

    return (
      <span style={{ 
        color: ticksColor, 
        marginRight: '4px', 
        fontSize: '11px', 
        fontWeight: 'bold', 
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
        lineHeight: 1
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
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
          {isVoice ? <Phone size={13} style={{ opacity: 0.7 }} /> : <Video size={13} style={{ opacity: 0.7 }} />}
          Outgoing Call
        </span>
      );
    } else {
      content = (
        <span style={{ 
          display: 'inline-flex', 
          alignItems: 'center', 
          gap: '5px', 
          color: isMissed ? '#ff453a' : 'inherit',
          fontWeight: isMissed ? '500' : 'normal'
        }}>
          {isMissed ? (
            isVoice ? <PhoneOff size={13} /> : <VideoOff size={13} />
          ) : (
            isVoice ? <Phone size={13} /> : <Video size={13} />
          )}
          {isMissed ? 'Missed Call' : 'Incoming Call'}
        </span>
      );
    }
  } else if (lastMsg.mediaType === 'voice' || lastMsg.mediaType === 'audio') {
    content = (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
        <Mic size={13} style={{ opacity: 0.7 }} />
        Voice Message
      </span>
    );
  } else if (lastMsg.mediaType === 'image') {
    content = (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
        <Image size={13} style={{ opacity: 0.7 }} />
        Photo
      </span>
    );
  } else if (lastMsg.mediaType === 'file') {
    const isImg = lastMsg.fileMetadata?.mimeType?.startsWith('image/');
    const isVid = lastMsg.fileMetadata?.mimeType?.startsWith('video/');
    content = (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
        {isImg ? <Image size={13} style={{ opacity: 0.7 }} /> : isVid ? <Video size={13} style={{ opacity: 0.7 }} /> : <FileText size={13} style={{ opacity: 0.7 }} />}
        {isImg ? 'Photo' : isVid ? 'Video' : 'Document'}
      </span>
    );
  } else {
    content = <span>{lastMsg.text || 'Message'}</span>;
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', gap: '1.5px' }}>
      {renderTicks()}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
        {content}
      </span>
    </span>
  );
};

const Sidebar = React.memo(function Sidebar({
  currentUser,
  contacts,
  activeContact,
  setActiveContact,
  addContact,
  onDeleteChat,
  onBlockChat,
  onUnblockContact,
  onRenameContact,
  blockedUsers = [],
  onLogout,
  onShowSettings,
  onShowRecents,
  isMinimized,
  onToggleMinimize,
  showSettings = false,
  showRecents = false,
  isNavigatingBack = false
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [searchError, setSearchError] = useState('');
  const [loadingSearch, setLoadingSearch] = useState(false);

  const searchInputRef = useRef(null);
  const searchDebounceRef = useRef(null);
  const errorTimeoutRef = useRef(null);
  const searchReqIdRef = useRef(0);

  // Clean up debounce & error timers on unmount
  useEffect(() => {
    return () => {
      window.clearTimeout(searchDebounceRef.current);
      window.clearTimeout(errorTimeoutRef.current);
    };
  }, []);

  // Holding / Long-press context menu state
  const [modalDialog, setModalDialog] = useState(null); // { contact, step: 'menu' | 'confirm-delete' | 'confirm-block' }
  const [isModalClosing, setIsModalClosing] = useState(false);
  const longPressTimerRef = useRef(null);
  const isLongPressTriggeredRef = useRef(false);

  const listRef = useRef(null);
  const positionsRef = useRef(new Map());
  const prevOrderRef = useRef([]);

  const filteredContacts = useMemo(() => {
    return [...contacts]
      .sort((a, b) => {
        const aLastMsg = a.messages && a.messages.length > 0 ? a.messages[a.messages.length - 1] : null;
        const bLastMsg = b.messages && b.messages.length > 0 ? b.messages[b.messages.length - 1] : null;
        
        const aTime = (aLastMsg && !isNaN(new Date(aLastMsg.timestamp).getTime())) ? new Date(aLastMsg.timestamp).getTime() : 0;
        const bTime = (bLastMsg && !isNaN(new Date(bLastMsg.timestamp).getTime())) ? new Date(bLastMsg.timestamp).getTime() : 0;
        
        return bTime - aTime; // Newest messages at the top
      })
      .filter(contact => {
        const query = searchQuery.trim().toLowerCase();
        return (
          (contact.username || '').toLowerCase().includes(query) ||
          (contact.displayName || '').toLowerCase().includes(query) ||
          (contact.customName || '').toLowerCase().includes(query)
        );
      });
  }, [contacts, searchQuery]);

  useLayoutEffect(() => {
    if (!listRef.current) return;
    
    // Get current order of usernames in list
    const currentOrder = filteredContacts.map(c => c.username);
    
    // Only run reordering animations if the contact list order changed
    const isOrderChanged = prevOrderRef.current.length > 0 && 
      prevOrderRef.current.length === currentOrder.length && 
      prevOrderRef.current.some((username, index) => username !== currentOrder[index]);

    const children = listRef.current.children;

    if (isOrderChanged) {
      for (const child of children) {
        const key = child.getAttribute('data-key');
        const prevTop = positionsRef.current.get(key);
        if (prevTop !== undefined) {
          const currentTop = child.getBoundingClientRect().top;
          const deltaY = prevTop - currentTop;
          
          if (deltaY !== 0) {
            // Apply inverted offset synchronously without animation
            child.style.transform = `translateY(${deltaY}px)`;
            child.style.transition = 'none';
            
            // Force reflow
            void child.offsetHeight;
            
            // Animate to new position with spring physics
            requestAnimationFrame(() => {
              child.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
              child.style.transform = '';
            });
          }
        }
      }
    }

    // Save positions and order for next render
    const newPositions = new Map();
    for (const child of children) {
      const key = child.getAttribute('data-key');
      if (key) {
        newPositions.set(key, child.getBoundingClientRect().top);
      }
    }
    positionsRef.current = newPositions;
    prevOrderRef.current = currentOrder;
  });

  const executeSearch = useCallback(async (queryStr) => {
    const query = (queryStr ?? searchQuery).trim();
    if (!query) {
      setSearchResult(null);
      setSearchError('');
      setLoadingSearch(false);
      return;
    }

    if (query.toLowerCase() === currentUser?.username?.toLowerCase()) {
      setSearchError('You cannot add yourself');
      setSearchResult(null);
      setLoadingSearch(false);
      window.clearTimeout(errorTimeoutRef.current);
      errorTimeoutRef.current = window.setTimeout(() => {
        setSearchError('');
      }, 3500);
      return;
    }

    const currentReqId = ++searchReqIdRef.current;
    setLoadingSearch(true);
    setSearchError('');

    try {
      const data = await searchUser(query, currentUser?.token);
      if (searchReqIdRef.current !== currentReqId) return;

      const foundUser = data?.user || data;
      if (foundUser && foundUser.username) {
        let liveStatus = 'offline';
        try {
          const statusRes = await emitGetUserStatus(foundUser.username);
          if (statusRes && statusRes.status) {
            liveStatus = statusRes.status;
          }
        } catch (statusErr) {
          console.warn('Could not fetch initial live status for searched user:', statusErr);
        }
        if (searchReqIdRef.current === currentReqId) {
          setSearchResult({ ...foundUser, status: liveStatus });
          setSearchError('');
        }
      } else {
        if (searchReqIdRef.current === currentReqId) {
          setSearchResult(null);
          setSearchError('Failed to find user');
          window.clearTimeout(errorTimeoutRef.current);
          errorTimeoutRef.current = window.setTimeout(() => {
            setSearchError('');
          }, 3500);
        }
      }
    } catch (err) {
      if (searchReqIdRef.current === currentReqId) {
        setSearchResult(null);
        setSearchError(err.message || 'Failed to find user');
        window.clearTimeout(errorTimeoutRef.current);
        errorTimeoutRef.current = window.setTimeout(() => {
          setSearchError('');
        }, 3500);
      }
    } finally {
      if (searchReqIdRef.current === currentReqId) {
        setLoadingSearch(false);
      }
    }
  }, [searchQuery, currentUser]);

  const handleSearchInputChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);

    window.clearTimeout(searchDebounceRef.current);
    window.clearTimeout(errorTimeoutRef.current);
    setSearchError('');

    const trimmed = val.trim();
    if (!trimmed) {
      searchReqIdRef.current++;
      setSearchResult(null);
      setLoadingSearch(false);
      return;
    }

    // If existing search result doesn't match the current typing, dismiss it immediately
    if (searchResult) {
      const q = trimmed.toLowerCase();
      const match = (searchResult.username?.toLowerCase().includes(q)) || 
                    (searchResult.displayName?.toLowerCase().includes(q));
      if (!match) {
        setSearchResult(null);
      }
    }

    // Debounced search (450ms) for effortless typing
    if (trimmed.length >= 2) {
      searchDebounceRef.current = window.setTimeout(() => {
        executeSearch(trimmed);
      }, 450);
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    window.clearTimeout(searchDebounceRef.current);
    if (!searchQuery.trim()) {
      setSearchResult(null);
      setSearchError('');
      setLoadingSearch(false);
      return;
    }
    executeSearch(searchQuery);
  };

  const handleClearSearch = () => {
    window.clearTimeout(searchDebounceRef.current);
    window.clearTimeout(errorTimeoutRef.current);
    searchReqIdRef.current++;
    setSearchQuery('');
    setSearchResult(null);
    setSearchError('');
    setLoadingSearch(false);
    searchInputRef.current?.focus();
  };

  const handleAddOrOpenContact = () => {
    if (!searchResult) return;
    const existing = contacts.find(c => c.username?.toLowerCase() === searchResult.username?.toLowerCase());
    if (existing) {
      setActiveContact?.(existing);
    } else {
      addContact?.(searchResult);
    }
    setSearchResult(null);
    setSearchQuery('');
    setSearchError('');
    setLoadingSearch(false);
  };

  // Long press / Holding handlers
  const handleContactPressStart = useCallback((contact, e) => {
    if (e.button === 2) return; // Right click is handled by onContextMenu
    isLongPressTriggeredRef.current = false;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = window.setTimeout(() => {
      isLongPressTriggeredRef.current = true;
      if (navigator.vibrate) navigator.vibrate(20);
      setModalDialog({ contact, step: 'menu' });
    }, 450);
  }, []);

  const handleContactPressEnd = useCallback(() => {
    window.clearTimeout(longPressTimerRef.current);
  }, []);

  const handleContextMenu = useCallback((contact, e) => {
    e.preventDefault();
    window.clearTimeout(longPressTimerRef.current);
    isLongPressTriggeredRef.current = true;
    if (navigator.vibrate) navigator.vibrate(20);
    setModalDialog({ contact, step: 'menu' });
  }, []);

  const [renameInput, setRenameInput] = useState('');

  const closeModal = useCallback(() => {
    if (isModalClosing) return;
    setIsModalClosing(true);
    setTimeout(() => {
      setModalDialog(null);
      setIsModalClosing(false);
    }, 220);
  }, [isModalClosing]);

  const handleTriggerRename = (contact) => {
    setRenameInput(contact.customName || contact.displayName || '');
    setModalDialog({ contact, step: 'rename' });
  };

  const handleSaveRename = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!modalDialog || !modalDialog.contact) return;
    onRenameContact?.(modalDialog.contact.username, renameInput);
    closeModal();
  };

  const handleTriggerDelete = (contact) => {
    setModalDialog({ contact, step: 'confirm-delete' });
  };

  const handleTriggerBlock = (contact) => {
    setModalDialog({ contact, step: 'confirm-block' });
  };

  const handleConfirmAction = () => {
    if (!modalDialog || !modalDialog.contact || isModalClosing) return;
    const { step, contact } = modalDialog;
    if (step === 'confirm-delete') {
      onDeleteChat?.(contact.username);
    } else if (step === 'confirm-block') {
      onBlockChat?.(contact.username);
    }
    setIsModalClosing(true);
    setTimeout(() => {
      setModalDialog(null);
      setIsModalClosing(false);
    }, 220);
  };

  const isExistingContact = searchResult 
    ? contacts.some(c => c.username?.toLowerCase() === searchResult.username?.toLowerCase())
    : false;

  return (
    <div className={`sidebar ${isMinimized ? 'sidebar-minimized' : ''}`}>
      {/* App Branding Header */}
      <div className="sidebar-header">
        <div className="app-branding">
          <ZapLogo size={32} glow />
          <span className="app-name">ZAP</span>
        </div>
      </div>

      {/* User Search */}
      <div className="search-container">
        <form onSubmit={handleSearchSubmit} className="search-box">
          <Search size={18} />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search username..."
            value={searchQuery}
            onChange={handleSearchInputChange}
          />
          {searchQuery && (
            <button 
              type="button" 
              className="search-clear-btn" 
              onClick={handleClearSearch}
              title="Clear search"
              aria-label="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </form>

        {loadingSearch && <div className="search-loading-text">Searching...</div>}
        
        {searchError && (
          <div className="search-error-msg">
            <ShieldAlert size={16} /> {searchError}
          </div>
        )}

        {searchResult && (
          <div className="search-result-card">
            <div className="search-result-info">
              {renderAvatar(searchResult.username, searchResult.displayName, searchResult.avatarIcon, { width: '38px', height: '38px', fontSize: '14px' })}
              <span style={{ fontSize: '14.5px', color: 'var(--text-primary)', fontWeight: '500' }}>
                {searchResult.displayName || searchResult.username}
                {searchResult.displayName && <span style={{ color: 'var(--text-muted)', fontSize: '12.5px', marginLeft: '6px', fontWeight: '400' }}>@{searchResult.username}</span>}
              </span>
            </div>
            {blockedUsers.includes(searchResult.username.toLowerCase()) ? (
              <button 
                className="add-contact-btn unblock-btn-sidebar" 
                onClick={() => onUnblockContact?.(searchResult.username)}
                title={`Unblock @${searchResult.username}`}
              >
                Unblock
              </button>
            ) : (
              <button className="add-contact-btn" onClick={handleAddOrOpenContact}>
                {isExistingContact ? 'Open Chat' : 'Add Chat'}
              </button>
            )}
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
          <div ref={listRef} className="contacts-list">
            {filteredContacts.map((contact) => {
              const isSelected = !isNavigatingBack && activeContact?.username === contact.username;
              const lastMsg = contact.messages && contact.messages.length > 0 
                ? contact.messages[contact.messages.length - 1]
                : null;

              return (
                <div
                  key={contact.username}
                  data-key={contact.username}
                  className={`contact-item ${isSelected ? 'active' : ''} ${contact.isTyping ? 'typing' : ''}`}
                  onMouseDown={(e) => handleContactPressStart(contact, e)}
                  onMouseUp={handleContactPressEnd}
                  onMouseLeave={handleContactPressEnd}
                  onTouchStart={(e) => handleContactPressStart(contact, e)}
                  onTouchEnd={handleContactPressEnd}
                  onTouchCancel={handleContactPressEnd}
                  onContextMenu={(e) => handleContextMenu(contact, e)}
                  onClick={() => {
                    if (isLongPressTriggeredRef.current) {
                      isLongPressTriggeredRef.current = false;
                      return;
                    }
                    setActiveContact(contact);
                    setSearchQuery('');
                    if (document.activeElement && typeof document.activeElement.blur === 'function') {
                      document.activeElement.blur();
                    }
                  }}
                  title="Click to chat • Hold to delete or block"
                >
                  <div className="contact-avatar-container">
                    {renderAvatar(contact.username, contact.customName || contact.displayName, contact.avatarIcon)}
                    <div className={`status-dot ${contact.status === 'online' ? 'online' : 'offline'}`} />
                    {isMinimized && contact.unreadCount > 0 && (
                      <span key={contact.unreadCount} className="unread-badge minimized-badge">{contact.unreadCount}</span>
                    )}
                  </div>
                  <div className="contact-info">
                    <div className="contact-name-row">
                      <span className="contact-name">
                        <span className="contact-display-name">
                          {contact.customName || contact.displayName || contact.username}
                        </span>
                        {contact.isVerified && <ShieldCheck size={14} className="contact-verified-badge" title="E2EE Verified Identity" />}
                      </span>
                      {lastMsg && (
                        <span className="last-msg-time">
                          {formatSidebarTime(lastMsg.timestamp)}
                        </span>
                      )}
                    </div>
                    <div className="contact-preview-row">
                      <div className={`contact-preview-text ${contact.isTyping ? 'typing-text' : ''}`}>
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
            })}
          </div>
        )}
      </div>

      {/* Sidebar Footer Controls */}
      <div className="sidebar-footer">
        <button 
          className={`sidebar-settings-btn ${showSettings ? 'active' : ''}`} 
          onClick={onShowSettings}
          title="Settings"
          aria-label="Settings"
        >
          <Settings size={20} />
        </button>
        <button 
          className={`sidebar-calls-btn ${showRecents ? 'active' : ''}`} 
          onClick={onShowRecents} 
          title="Recent Calls" 
          aria-label="Recent Calls"
        >
          <Phone size={20} />
        </button>
        <button className="minimize-btn" onClick={onToggleMinimize} title={isMinimized ? "Expand Sidebar" : "Minimize Sidebar"} aria-label={isMinimized ? "Expand Sidebar" : "Minimize Sidebar"}>
          {isMinimized ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
        </button>
      </div>

      {/* Contact Action & Confirmation Unified Modal Flow */}
      {(modalDialog || isModalClosing) && modalDialog && createPortal(
        <div className={`modal-overlay contact-action-overlay ${isModalClosing ? 'closing' : ''}`} onClick={closeModal}>
          <div className="contact-action-modal glass" onClick={(e) => e.stopPropagation()}>
            {modalDialog.step === 'menu' ? (
              <div className="modal-step-wrapper" key="menu-step">
                <div className="contact-action-header">
                  {renderAvatar(modalDialog.contact.username, modalDialog.contact.customName || modalDialog.contact.displayName, modalDialog.contact.avatarIcon, { width: '48px', height: '48px', fontSize: '18px' })}
                  <div className="contact-action-header-info">
                    <h4>{modalDialog.contact.customName || modalDialog.contact.displayName || modalDialog.contact.username}</h4>
                    <span>@{modalDialog.contact.username}</span>
                  </div>
                  <button className="contact-action-close" onClick={closeModal} aria-label="Close">
                    <X size={18} />
                  </button>
                </div>

                <div className="contact-action-body">
                  <button 
                    className="contact-action-option rename-option"
                    onClick={() => handleTriggerRename(modalDialog.contact)}
                  >
                    <div className="action-icon-circle rename-icon">
                      <Pencil size={17} />
                    </div>
                    <div className="action-option-text">
                      <span className="action-title">Rename Contact</span>
                      <span className="action-desc">Set custom nickname visible only to you</span>
                    </div>
                  </button>

                  <button 
                    className="contact-action-option delete-option"
                    onClick={() => handleTriggerDelete(modalDialog.contact)}
                  >
                    <div className="action-icon-circle delete-icon">
                      <Trash2 size={18} />
                    </div>
                    <div className="action-option-text">
                      <span className="action-title">Delete Chat</span>
                      <span className="action-desc">Remove conversation history from your device</span>
                    </div>
                  </button>

                  <button 
                    className="contact-action-option block-option"
                    onClick={() => handleTriggerBlock(modalDialog.contact)}
                  >
                    <div className="action-icon-circle block-icon">
                      <Ban size={18} />
                    </div>
                    <div className="action-option-text">
                      <span className="action-title">Block User</span>
                      <span className="action-desc">Block messages, calls and remove chat</span>
                    </div>
                  </button>
                </div>

                <div className="contact-action-footer">
                  <button className="contact-action-cancel-btn" onClick={closeModal}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : modalDialog.step === 'rename' ? (
              <div className="modal-step-wrapper rename-step-wrapper" key="rename-step">
                <div className="contact-action-header">
                  {renderAvatar(modalDialog.contact.username, renameInput.trim() || modalDialog.contact.displayName, modalDialog.contact.avatarIcon, { width: '48px', height: '48px', fontSize: '18px' })}
                  <div className="contact-action-header-info">
                    <h4>Rename @{modalDialog.contact.username}</h4>
                    <span>Custom nickname on your device</span>
                  </div>
                  <button className="contact-action-close" onClick={closeModal} aria-label="Close">
                    <X size={18} />
                  </button>
                </div>

                <form onSubmit={handleSaveRename} className="rename-modal-form">
                  <div className="rename-input-container">
                    <input 
                      type="text" 
                      className="rename-input-field" 
                      value={renameInput} 
                      onChange={(e) => setRenameInput(e.target.value.slice(0, 28))}
                      placeholder={modalDialog.contact.displayName || modalDialog.contact.username}
                      maxLength={28}
                      autoFocus
                    />
                    {renameInput && (
                      <button 
                        type="button" 
                        className="rename-clear-btn" 
                        onClick={() => setRenameInput('')}
                        title="Clear nickname"
                        aria-label="Clear nickname"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  <div className="rename-actions-row">
                    <button 
                      type="button" 
                      className="rename-back-btn" 
                      onClick={() => setModalDialog({ contact: modalDialog.contact, step: 'menu' })}
                    >
                      Back
                    </button>
                    <button type="submit" className="rename-confirm-btn">
                      Save Nickname
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="modal-step-wrapper confirmation-step-wrapper" key={modalDialog.step}>
                <div className="confirmation-icon-container">
                  {modalDialog.step === 'confirm-delete' ? (
                    <div className="confirmation-icon delete-icon">
                      <Trash2 size={24} />
                    </div>
                  ) : (
                    <div className="confirmation-icon block-icon">
                      <Ban size={24} />
                    </div>
                  )}
                </div>

                <h3 className="confirmation-title">
                  {modalDialog.step === 'confirm-delete' ? 'Delete Conversation?' : `Block @${modalDialog.contact?.username}?`}
                </h3>

                <p className="confirmation-desc">
                  {modalDialog.step === 'confirm-delete'
                    ? `Are you sure you want to delete your conversation with @${modalDialog.contact?.username}? All messages will be permanently removed from your device.`
                    : `@${modalDialog.contact?.username} will be blocked from sending you messages or calling you. This conversation will also be removed.`}
                </p>

                <div className="confirmation-actions">
                  <button className="confirmation-cancel-btn" onClick={() => setModalDialog({ contact: modalDialog.contact, step: 'menu' })}>
                    Cancel
                  </button>
                  <button 
                    className={`confirmation-danger-btn ${modalDialog.step === 'confirm-block' ? 'block-confirm' : 'delete-confirm'}`}
                    onClick={handleConfirmAction}
                  >
                    {modalDialog.step === 'confirm-delete' ? 'Delete Chat' : 'Block & Delete'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
});

export default Sidebar;
