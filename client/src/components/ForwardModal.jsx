import React, { useState, useEffect, useMemo } from 'react';
import { Forward, X, Search, MessageSquare } from 'lucide-react';

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

const ForwardModal = ({ message, contacts, blockedUsers = [], onClose, onConfirm }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [forwardingTo, setForwardingTo] = useState(null);

  useEffect(() => {
    setSearchQuery('');
    setForwardingTo(null);
  }, [message]);

  useEffect(() => {
    if (!message) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [message, onClose]);

  const filteredContacts = useMemo(() => {
    const blocked = new Set(blockedUsers.map(b => String(b).toLowerCase()));
    const query = searchQuery.trim().toLowerCase();
    return contacts.filter(c => {
      if (blocked.has(c.username.toLowerCase())) return false;
      if (!query) return true;
      const name = (c.customName || c.displayName || c.username || '').toLowerCase();
      return name.includes(query) || (c.username || '').toLowerCase().includes(query);
    });
  }, [contacts, blockedUsers, searchQuery]);

  if (!message) return null;

  const previewText = buildForwardPreview(message);

  const handleSelect = async (contact) => {
    if (forwardingTo) return;
    setForwardingTo(contact.username);
    try {
      await onConfirm(contact.username);
    } finally {
      setForwardingTo(null);
    }
  };

  return (
    <div className="forward-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Forward message">
      <div className="forward-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="forward-modal-header">
          <div className="forward-modal-title-row">
            <Forward size={18} style={{ color: 'var(--accent-color)' }} />
            <h3>Forward Message</h3>
          </div>
          <button className="forward-modal-close" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </div>

        <div className="forward-preview-box">{previewText}</div>

        <div className="forward-search-wrap">
          <Search size={15} className="forward-search-icon" />
          <input
            type="text"
            className="forward-search-input"
            placeholder="Search contacts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className="forward-contact-list">
          {filteredContacts.length === 0 ? (
            <div className="forward-empty-state">
              <MessageSquare size={22} />
              <span>No contacts found</span>
            </div>
          ) : (
            filteredContacts.map((contact) => (
              <button
                key={contact.username}
                type="button"
                className={`forward-contact-item ${forwardingTo === contact.username ? 'is-sending' : ''}`}
                onClick={() => handleSelect(contact)}
                disabled={Boolean(forwardingTo)}
              >
                <span className="forward-contact-avatar">
                  {contact.avatarIcon || (contact.customName || contact.displayName || contact.username || '?').charAt(0).toUpperCase()}
                </span>
                <span className="forward-contact-details">
                  <span className="forward-contact-name">
                    {contact.customName || contact.displayName || contact.username}
                  </span>
                  <span className="forward-contact-username">@{contact.username}</span>
                </span>
                <span className="forward-contact-action">
                  {forwardingTo === contact.username ? 'Sending...' : 'Send'}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default ForwardModal;
