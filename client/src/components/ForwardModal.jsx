import React, { useState, useEffect, useMemo } from 'react';
import { Forward, X, Search, MessageSquare } from 'lucide-react';
import { renderAvatar } from './Sidebar';

const buildForwardPreview = (message) => {
  if (!message) return '';
  if (message.isAlbum) return `[${message.albumItems.length} Photos]`;
  if (message.isMultiFile) return `[${message.fileItems.length} Files]`;
  if (message.mediaType === 'file' && message.fileMetadata) {
    const mime = message.fileMetadata.mimeType || '';
    if (mime.startsWith('image/')) return 'Photo';
    if (mime.startsWith('video/')) return 'Video';
    if (mime.startsWith('audio/')) return message.fileMetadata.name || 'Voice Note';
    return message.fileMetadata.name || 'File';
  }
  return message.text || '';
};

const ForwardModal = ({ message, contacts = [], groups = [], blockedUsers = [], onClose, onConfirm }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState(null);
  const [forwardingTo, setForwardingTo] = useState(null);
  const [isClosing, setIsClosing] = useState(false);

  // App-consistent exit: fade + scale out before unmounting (same 0.22s curve
  // as the contact action modals), then hand control back to the parent
  const requestClose = () => {
    if (isClosing || forwardingTo) return;
    setIsClosing(true);
    setTimeout(onClose, 220);
  };

  useEffect(() => {
    // Fresh state for every newly opened forward session (the modal component
    // stays mounted, so lingering isClosing/search/selection must be cleared)
    setIsClosing(false);
    setSearchQuery('');
    setSelectedKey(null);
    setForwardingTo(null);
  }, [message]);

  useEffect(() => {
    if (!message) return;
    const onKey = (e) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [message, isClosing, forwardingTo]);

  const blocked = useMemo(() => new Set(blockedUsers.map(b => String(b).toLowerCase())), [blockedUsers]);

  const targets = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const matches = (name, username) =>
      !query || name.toLowerCase().includes(query) || String(username).toLowerCase().includes(query);

    const contactTargets = contacts
      .filter(c => {
        if (blocked.has(c.username.toLowerCase())) return false;
        const name = c.customName || c.displayName || c.username || '';
        return matches(name, c.username);
      })
      .map(c => ({
        type: 'contact',
        key: `c_${c.username}`,
        id: c.username,
        name: c.customName || c.displayName || c.username,
        sub: `@${c.username}`,
        avatarIcon: c.avatarIcon
      }));

    const groupTargets = groups
      .filter(g => matches(g.name || '', g.id))
      .map(g => ({
        type: 'group',
        key: `g_${g.id}`,
        id: g.id,
        name: g.name || `Group ${g.id}`,
        sub: `${(g.members || []).length} members`,
        avatarIcon: g.avatarIcon
      }));

    return [...contactTargets, ...groupTargets];
  }, [contacts, groups, blocked, searchQuery]);

  if (!message) return null;

  const previewText = buildForwardPreview(message);

  const handleSelect = (target) => {
    if (forwardingTo || isClosing) return;
    setSelectedKey(prev => (prev === target.key ? null : target.key));
  };

  const handleSend = async (target) => {
    if (forwardingTo || isClosing) return;
    setForwardingTo(target.key);
    let succeeded = false;
    try {
      await onConfirm(target);
      succeeded = true;
    } finally {
      setForwardingTo(null);
    }
    // Success follows the app's animated close; failures keep the modal
    // open with the row back to idle so the user can retry elsewhere
    if (succeeded) requestClose();
  };

  return (
    <div
      className={`forward-modal-overlay ${isClosing ? 'closing' : ''}`}
      onClick={forwardingTo ? undefined : requestClose}
      role="dialog"
      aria-modal="true"
      aria-label="Forward message"
    >
      <div className="forward-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="forward-modal-header">
          <div className="create-group-title-icon"><Forward size={16} /></div>
          <h3>Forward Message</h3>
          <button className="create-group-close" onClick={requestClose} disabled={Boolean(forwardingTo)} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="forward-preview-box">{previewText}</div>

        <div className="forward-search-wrap">
          <Search size={15} className="forward-search-icon" />
          <input
            type="text"
            className="forward-search-input"
            placeholder="Search chats & groups..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className="forward-contact-list">
          {targets.length === 0 ? (
            <div className="forward-empty-state">
              <MessageSquare size={22} />
              <span>No chats or groups found</span>
            </div>
          ) : (
            targets.map((target) => {
              const isSelected = selectedKey === target.key;
              const isSending = forwardingTo === target.key;
              return (
                <div
                  key={target.key}
                  role="button"
                  tabIndex={forwardingTo ? -1 : 0}
                  aria-pressed={isSelected}
                  className={`forward-contact-item ${isSelected ? 'is-selected' : ''} ${isSending ? 'is-sending' : ''}`}
                  onClick={() => handleSelect(target)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelect(target);
                    }
                  }}
                >
                  <span className={`forward-contact-avatar ${target.type === 'group' ? 'is-group' : ''}`}>
                    {target.type === 'group'
                      ? (target.avatarIcon
                          ? renderAvatar(target.name, null, target.avatarIcon, { width: '100%', height: '100%', borderRadius: '50%', fontSize: '13px' })
                          : <MessageSquare size={14} />)
                      : renderAvatar(target.id, target.name, target.avatarIcon || null, { width: '100%', height: '100%', borderRadius: '50%' })}
                  </span>
                  <span className="forward-contact-details">
                    <span className="forward-contact-name">{target.name}</span>
                    <span className="forward-contact-username">{target.sub}</span>
                  </span>
                  <button
                    type="button"
                    className={`forward-contact-action ${isSelected || isSending ? 'is-active' : ''}`}
                    disabled={!isSelected || Boolean(forwardingTo)}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSend(target);
                    }}
                  >
                    {isSending ? 'Sending...' : 'Send'}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default ForwardModal;
