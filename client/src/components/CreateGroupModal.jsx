import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Search, Users, Check, ShieldCheck, Camera, Trash2 } from 'lucide-react';
import { renderAvatar } from './Sidebar';
import { searchUser } from '../services/api';

// Same center-crop + compression pipeline as the profile avatar in Settings
const processGroupImage = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = 128;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => reject(new Error('Failed to load image file'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
};

const CreateGroupModal = ({ contacts = [], currentUser, blockedUsers = [], onClose, onCreate }) => {
  const [groupName, setGroupName] = useState('');
  const [avatarImage, setAvatarImage] = useState('');
  const [selectedMembers, setSelectedMembers] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchedUser, setSearchedUser] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const searchReqIdRef = useRef(0);
  const pendingProfilesRef = useRef(new Map());
  const fileInputRef = useRef(null);

  // App-consistent exit: fade + scale out before unmounting (same 0.22s curve
  // as the contact action modals), then hand control back to the parent
  const requestClose = () => {
    if (isClosing || isCreating) return;
    setIsClosing(true);
    setTimeout(onClose, 220);
  };

  useEffect(() => {
    if (currentUser) {
      pendingProfilesRef.current.set(currentUser.username.toLowerCase(), currentUser);
    }
  }, [currentUser]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !isCreating) requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose, isCreating]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const availableContacts = useMemo(() => {
    const blocked = new Set(blockedUsers.map(b => String(b).toLowerCase()));
    return contacts.filter(c => !blocked.has(c.username.toLowerCase()));
  }, [contacts, blockedUsers]);

  const toggleMember = (usernameLower) => {
    setSelectedMembers(prev => {
      const next = new Set(prev);
      if (next.has(usernameLower)) {
        next.delete(usernameLower);
      } else {
        next.add(usernameLower);
      }
      return next;
    });
  };

  const handleSearch = async (queryStr) => {
    const query = (queryStr ?? '').trim();
    setSearchedUser(null);
    setError('');
    if (!query || query.length < 3) return;
    if (query.toLowerCase() === currentUser?.username?.toLowerCase()) {
      setError('You are added to the group automatically');
      return;
    }
    if (selectedMembers.has(query.toLowerCase())) return;

    const reqId = ++searchReqIdRef.current;
    setIsSearching(true);
    try {
      const data = await searchUser(query, currentUser?.token);
      if (reqId !== searchReqIdRef.current) return;
      const found = data?.user || data;
      if (found && found.username && found.publicIdentityKey) {
        setSearchedUser(found);
      } else {
        setError('Failed to find user');
      }
    } catch (err) {
      if (reqId === searchReqIdRef.current) {
        setError(err.message || 'Failed to find user');
      }
    } finally {
      if (reqId === searchReqIdRef.current) setIsSearching(false);
    }
  };

  const handleSearchInputChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
    setError('');
  };

  const handleAddSearchedUser = () => {
    if (!searchedUser) return;
    const lower = searchedUser.username.toLowerCase();
    setSelectedMembers(prev => new Set([...prev, lower]));
    // Cache the full profile so the app can derive envelopes without extra lookups
    pendingProfilesRef.current.set(lower, searchedUser);
    setSearchedUser(null);
    setSearchQuery('');
  };

  const getSelectedContactObjects = () => {
    return [...selectedMembers].map(lower => {
      const fromContacts = availableContacts.find(c => c.username.toLowerCase() === lower);
      if (fromContacts) return fromContacts;
      const cached = pendingProfilesRef.current.get(lower);
      if (cached) return cached;
      return { username: lower };
    });
  };

  const canProceed = groupName.trim().length > 0;

  const handleAvatarFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file');
      return;
    }
    try {
      const compressed = await processGroupImage(file);
      setAvatarImage(compressed);
      setError('');
    } catch {
      setError('Failed to process image');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveAvatar = () => {
    setAvatarImage('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCreate = async () => {
    const name = groupName.trim();
    if (!name) {
      setError('Please enter a group name');
      return;
    }
    if (selectedMembers.size === 0) {
      setError('Select at least one member');
      return;
    }
    setIsCreating(true);
    setError('');
    try {
      await onCreate({
        name,
        avatarIcon: avatarImage ? JSON.stringify({ image: avatarImage }) : null,
        members: getSelectedContactObjects()
      });
    } catch (err) {
      setError(err.message || 'Failed to create group');
      setIsCreating(false);
    }
  };

  const filteredContactsForList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return availableContacts.filter(c => {
      if (!q) return true;
      const name = (c.customName || c.displayName || c.username || '').toLowerCase();
      return name.includes(q) || c.username.toLowerCase().includes(q);
    });
  }, [availableContacts, searchQuery]);

  return (
    <div className={`create-group-overlay ${isClosing ? 'closing' : ''}`} onClick={isCreating ? undefined : requestClose} role="dialog" aria-modal="true" aria-label="Create group">
      <div className="create-group-modal glass" onClick={(e) => e.stopPropagation()}>
        <div className="create-group-header">
          <div className="create-group-title-row">
            <div className="create-group-title-icon"><Users size={18} /></div>
            <h3>New Secure Group</h3>
          </div>
          <button className="create-group-close" onClick={requestClose} disabled={isCreating} aria-label="Close">
            <X size={17} />
          </button>
        </div>

        <div className="create-group-body">
          <div className="create-group-identity-row">
            <div className="group-avatar-upload">
              {renderAvatar(groupName.trim() || 'G', null, avatarImage ? JSON.stringify({ image: avatarImage }) : null, { width: '64px', height: '64px', fontSize: '24px' })}
              <button
                type="button"
                className="group-avatar-cam-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={isCreating}
                title={avatarImage ? 'Change photo' : 'Add photo'}
                aria-label="Add group photo"
              >
                <Camera size={13} />
              </button>
            </div>
            <input
              type="text"
              className="create-group-name-input"
              placeholder="Group name"
              value={groupName}
              maxLength={32}
              onChange={(e) => setGroupName(e.target.value)}
              autoFocus
              disabled={isCreating}
            />
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleAvatarFileChange}
          />

          {avatarImage && (
            <button type="button" className="group-avatar-remove-btn" onClick={handleRemoveAvatar} disabled={isCreating}>
              <Trash2 size={13} /> Remove photo
            </button>
          )}

          <div className="create-group-members-label-row">
            <span className="create-group-picker-label">Members</span>
            <span className="create-group-member-count">{selectedMembers.size} selected</span>
          </div>

          <div className="create-group-search-wrap">
            <Search size={14} className="create-group-search-icon" />
            <input
              type="text"
              className="create-group-search-input"
              placeholder="Find by exact username..."
              value={searchQuery}
              onChange={handleSearchInputChange}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSearch(); } }}
              disabled={isCreating}
            />
            {isSearching && <span className="create-group-search-spinner" />}
          </div>

          {error && <div className="create-group-error">{error}</div>}

          {searchedUser && (
            <div className="create-group-search-result">
              {renderAvatar(searchedUser.username, searchedUser.displayName, searchedUser.avatarIcon, { width: '34px', height: '34px', fontSize: '13px' })}
              <div className="create-group-search-result-info">
                <span className="create-group-result-name">{searchedUser.displayName || searchedUser.username}</span>
                <span className="create-group-result-username">@{searchedUser.username}</span>
              </div>
              <button type="button" className="create-group-add-user-btn" onClick={handleAddSearchedUser}>Add</button>
            </div>
          )}

          <div className="create-group-contact-list">
            {filteredContactsForList.length === 0 ? (
              <div className="create-group-empty">No contacts available. Search a username above to add people directly.</div>
            ) : (
              filteredContactsForList.map((contact) => {
                const lower = contact.username.toLowerCase();
                const isSelected = selectedMembers.has(lower);
                return (
                  <button
                    key={contact.username}
                    type="button"
                    className={`create-group-contact-item ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => toggleMember(lower)}
                    disabled={isCreating}
                  >
                    {renderAvatar(contact.username, contact.customName || contact.displayName, contact.avatarIcon, { width: '36px', height: '36px', fontSize: '14px' })}
                    <div className="create-group-contact-info">
                      <span className="create-group-contact-name">{contact.customName || contact.displayName || contact.username}</span>
                      <span className="create-group-contact-username">@{contact.username}</span>
                    </div>
                    <span className={`create-group-check ${isSelected ? 'checked' : ''}`}>
                      {isSelected && <Check size={13} strokeWidth={3} />}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div className="create-group-e2ee-note">
            <ShieldCheck size={13} />
            <span>A fresh end-to-end encryption key will be generated on this device and sealed separately for every member.</span>
          </div>
        </div>

        <div className="create-group-footer">
          <button className="create-group-cancel-btn" onClick={requestClose} disabled={isCreating}>Cancel</button>
          <button
            className={`create-group-create-btn ${!canProceed || isCreating ? 'disabled' : ''}`}
            onClick={handleCreate}
            disabled={!canProceed || isCreating}
          >
            {isCreating ? 'Encrypting & Creating…' : `Create Group${selectedMembers.size > 0 ? ` (${selectedMembers.size + 1})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateGroupModal;
