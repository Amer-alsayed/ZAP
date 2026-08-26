import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Search, Crown, ShieldCheck, UserMinus, UserPlus, Pencil, LogOut, Trash2, ChevronLeft, Users, Camera } from 'lucide-react';
import { renderAvatar } from './Sidebar';
import { searchUser } from '../services/api';

// Same center-crop + compression pipeline as the profile avatar in Settings
const processGroupImage = (file) => {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const cleanup = () => {
      img.onload = null;
      img.onerror = null;
      URL.revokeObjectURL(url);
    };
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const size = 128;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
        cleanup();
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      } catch (err) {
        cleanup();
        reject(err);
      }
    };
    img.onerror = () => {
      cleanup();
      reject(new Error('Failed to load image file'));
    };
    img.src = url;
  });
};

const parseGroupAvatarImage = (avatarIcon) => {
  try {
    const parsed = JSON.parse(avatarIcon || '{}');
    return parsed.image || '';
  } catch {
    return '';
  }
};

const GroupInfoModal = ({
  currentUser,
  group,
  onClose,
  onUpdateGroupInfo,
  onAddMembers,
  onRemoveMember,
  onSetRole,
  onLeaveGroup,
  onDeleteGroup,
  showToast,
  backHandlerRef
}) => {
  const [view, setView] = useState('main');
  const [confirmAction, setConfirmAction] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [isClosing, setIsClosing] = useState(false);

  const [editName, setEditName] = useState(group.name || '');
  const [editAvatarImage, setEditAvatarImage] = useState(() => parseGroupAvatarImage(group.avatarIcon));
  const editFileInputRef = useRef(null);

  const [viewLeaving, setViewLeaving] = useState(false);
  const [navDir, setNavDir] = useState('forward');
  const [confirmClosing, setConfirmClosing] = useState(false);
  const viewTimerRef = useRef(null);
  const confirmTimerRef = useRef(null);

  useEffect(() => () => {
    clearTimeout(viewTimerRef.current);
    clearTimeout(confirmTimerRef.current);
  }, []);

  const changeView = (next, dir = 'forward') => {
    if (next === view || viewLeaving) return;
    setNavDir(dir);
    setViewLeaving(true);
    clearTimeout(viewTimerRef.current);
    viewTimerRef.current = setTimeout(() => {
      setView(next);
      setViewLeaving(false);
    }, 150);
  };

  const closeConfirm = () => {
    if (confirmClosing) return;
    setConfirmClosing(true);
    clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => {
      setConfirmAction(null);
      setConfirmClosing(false);
    }, 160);
  };

  const requestClose = (isFromPopState = false) => {
    if (isClosing || busy) return;
    if (isFromPopState !== true && window.history.state === 'group-info') {
      window.__isProgrammaticPop = true;
      window.history.back();
      setTimeout(() => { window.__isProgrammaticPop = false; }, 100);
    }
    setIsClosing(true);
    setTimeout(onClose, 220);
  };

  const [addSearchQuery, setAddSearchQuery] = useState('');
  const [searchedUser, setSearchedUser] = useState(null);
  const [pendingAdd, setPendingAdd] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchReqIdRef = useRef(0);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    if (!backHandlerRef) return;
    backHandlerRef.current = () => {
      if (isClosing || busy) return false;
      if (confirmAction) {
        closeConfirm();
        setTimeout(() => {
          if (window.history.state !== 'group-info') window.history.pushState('group-info', '');
        }, 0);
        return true;
      }
      if (view !== 'main') {
        changeView('main', 'back');
        // keep history entry alive: we consumed a pop, re-push it so the next back still closes the modal
        setTimeout(() => {
          if (window.history.state !== 'group-info') window.history.pushState('group-info', '');
        }, 0);
        return true;
      }
      requestClose(true);
      return true;
    };
    return () => { backHandlerRef.current = null; };
  }, [backHandlerRef, isClosing, busy, confirmAction, view, requestClose]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (!busy && !isClosing) {
          if (confirmAction) {
            closeConfirm();
          } else if (view !== 'main') {
            changeView('main', 'back');
          } else {
            requestClose();
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, confirmAction, busy, isClosing, requestClose, changeView, closeConfirm]);

  const isOwner = group.myRole === 'owner';
  const isAdmin = isOwner || group.myRole === 'admin';

  const members = useMemo(() => group.members || [], [group.members]);

  const addableContactsBase = useMemo(() => members.map(m => m.username.toLowerCase()), [members]);

  const handleSearchForAdd = async () => {
    const query = addSearchQuery.trim();
    setError('');
    if (!query) return;
    if (query.toLowerCase() === currentUser?.username?.toLowerCase()) {
      setError('You are already a member of this group');
      return;
    }
    if (addableContactsBase.includes(query.toLowerCase())) {
      setError('This user is already a member');
      return;
    }
    if (pendingAdd.some(u => u.username.toLowerCase() === query.toLowerCase())) return;

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
      if (reqId === searchReqIdRef.current) setError(err.message || 'Failed to find user');
    } finally {
      if (reqId === searchReqIdRef.current) setIsSearching(false);
    }
  };

  const addSearchedUser = () => {
    if (!searchedUser) return;
    setPendingAdd(prev => [...prev, searchedUser]);
    setSearchedUser(null);
    setAddSearchQuery('');
    setError('');
  };

  const confirmAddPending = async () => {
    if (pendingAdd.length === 0) return;
    setBusy(true);
    setError('');
    try {
      await onAddMembers(group.id, pendingAdd);
      setPendingAdd([]);
      changeView('main', 'back');
    } catch (err) {
      setError(err.message || 'Failed to add members');
    } finally {
      setBusy(false);
    }
  };

  const handleEditAvatarFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file (JPG, PNG, WebP or GIF)');
      return;
    }
    try {
      const compressed = await processGroupImage(file);
      setEditAvatarImage(compressed);
      setError('');
    } catch {
      setError('Failed to process image');
    } finally {
      if (editFileInputRef.current) editFileInputRef.current.value = '';
    }
  };

  const confirmUpdateInfo = async () => {
    const name = editName.trim();
    if (!name) {
      setError('Group name cannot be empty');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onUpdateGroupInfo(group.id, {
        name,
        avatarIcon: editAvatarImage ? JSON.stringify({ image: editAvatarImage }) : null
      });
      changeView('main', 'back');
    } catch (err) {
      setError(err.message || 'Failed to update group');
    } finally {
      setBusy(false);
    }
  };

  const runConfirmed = async () => {
    if (!confirmAction || busy) return;
    setBusy(true);
    setError('');
    try {
      if (confirmAction.type === 'remove') {
        await onRemoveMember(group.id, confirmAction.username);
      } else if (confirmAction.type === 'leave') {
        await onLeaveGroup(group);
        return;
      } else if (confirmAction.type === 'delete') {
        await onDeleteGroup(group);
        return;
      }
      closeConfirm();
    } catch (err) {
      setError(err.message || 'Action failed');
      setConfirmAction(null);
    } finally {
      setBusy(false);
    }
  };

  const handleSetRole = async (targetUsername, role) => {
    setBusy(true);
    setError('');
    try {
      await onSetRole(group.id, targetUsername, role);
    } catch (err) {
      showToast?.(err.message || 'Failed to change role', 'error');
    } finally {
      setBusy(false);
    }
  };

  const renderMemberRow = (member) => {
    const profile = member.profile || {};
    const lower = member.username.toLowerCase();
    const isMe = lower === currentUser.username.toLowerCase();
    const canRemove = isAdmin && !isMe && member.role !== 'owner';
    const canChangeRole = isOwner && !isMe;

    return (
      <div key={member.username} className="group-member-row">
        {renderAvatar(member.username, profile.displayName, profile.avatarIcon, { width: '38px', height: '38px', fontSize: '14px' })}
        <div className="group-member-info">
          <span className="group-member-name">
            {profile.customName || profile.displayName || member.username}
            {isMe && <span className="group-member-you">You</span>}
          </span>
          <span className="group-member-username">@{member.username}</span>
        </div>
        <div className="group-member-badges">
          {member.role === 'owner' && (
            <span className="group-role-badge owner"><Crown size={11} /> Owner</span>
          )}
          {member.role === 'admin' && (
            <span className="group-role-badge admin"><ShieldCheck size={11} /> Admin</span>
          )}
        </div>
        {(canRemove || canChangeRole) && (
          <div className="group-member-actions">
            {canChangeRole && (
              <button
                type="button"
                className="group-member-action-btn role-btn"
                title={member.role === 'admin' ? 'Demote to member' : 'Promote to admin'}
                disabled={busy}
                onClick={() => handleSetRole(member.username, member.role === 'admin' ? 'member' : 'admin')}
              >
                <ShieldCheck size={15} />
              </button>
            )}
            {canRemove && (
              <button
                type="button"
                className="group-member-action-btn remove-btn"
                title="Remove from group"
                disabled={busy}
                onClick={() => setConfirmAction({ type: 'remove', username: member.username })}
              >
                <UserMinus size={15} />
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`group-info-overlay ${isClosing ? 'closing' : ''}`} onClick={busy ? undefined : requestClose} role="dialog" aria-modal="true" aria-label="Group information">
      <div className="group-info-modal glass" onClick={(e) => e.stopPropagation()}>
        <div className="group-info-header">
          {view !== 'main' ? (
            <button className="group-info-back" onClick={() => { changeView('main', 'back'); setError(''); }} aria-label="Back">
              <ChevronLeft size={19} />
            </button>
          ) : (
            <div className="create-group-title-icon"><Users size={18} /></div>
          )}
          <h3 key={view} className="group-info-header-title">
            {view === 'main' && 'Group Info'}
            {view === 'add-members' && 'Add Members'}
            {view === 'edit-info' && 'Edit Group'}
          </h3>
          {!busy && (
            <button
              className="create-group-close"
              onClick={() => { if (confirmAction) { closeConfirm(); } else { requestClose(); } }}
              aria-label="Close"
            >
              <X size={17} />
            </button>
          )}
        </div>

        <div className="group-info-body">
          {error && <div className="create-group-error">{error}</div>}

          <div key={view} className={`group-info-view ${navDir} ${viewLeaving ? 'leaving' : ''}`}>
            {view === 'main' && (
              <>
                <div className="group-info-hero">
                  {renderAvatar(group.name || 'G', null, group.avatarIcon, { width: '64px', height: '64px', fontSize: '30px' })}
                  <div className="group-info-hero-text">
                    <h4>{group.name}</h4>
                    <span>{members.length} member{members.length === 1 ? '' : 's'} • End-to-end encrypted</span>
                  </div>
                </div>

                {isAdmin && (
                  <div className="group-info-actions-row">
                    <button
                      type="button"
                      className="group-info-action-pill"
                      onClick={() => {
                        setEditName(group.name || '');
                        setEditAvatarImage(parseGroupAvatarImage(group.avatarIcon));
                        setError('');
                        changeView('edit-info', 'forward');
                      }}
                      disabled={busy}
                    >
                      <Pencil size={14} /> Edit
                    </button>
                    <button
                      type="button"
                      className="group-info-action-pill"
                      onClick={() => {
                        setPendingAdd([]);
                        setError('');
                        changeView('add-members', 'forward');
                      }}
                      disabled={busy}
                    >
                      <UserPlus size={14} /> Add
                    </button>
                  </div>
                )}

                <div className="group-info-section-label">Members</div>
                <div className="group-member-list">
                  {members.map(renderMemberRow)}
                </div>

                <div className="group-info-danger-zone">
                  <button type="button" className="group-info-danger-btn leave" onClick={() => setConfirmAction({ type: 'leave' })} disabled={busy}>
                    <LogOut size={15} /> Leave Group
                  </button>
                  {isOwner && (
                    <button type="button" className="group-info-danger-btn delete" onClick={() => setConfirmAction({ type: 'delete' })} disabled={busy}>
                      <Trash2 size={15} /> Delete Group
                    </button>
                  )}
                </div>
              </>
            )}

            {view === 'add-members' && (
              <>
                <div className="create-group-search-wrap">
                  <Search size={14} className="create-group-search-icon" />
                  <input
                    type="text"
                    className="create-group-search-input"
                    placeholder="Find by exact username..."
                    value={addSearchQuery}
                    onChange={(e) => { setAddSearchQuery(e.target.value); setError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSearchForAdd(); } }}
                    disabled={busy}
                  />
                  {isSearching && <span className="create-group-search-spinner" />}
                </div>

                {searchedUser && (
                  <div className="create-group-search-result">
                    {renderAvatar(searchedUser.username, searchedUser.displayName, searchedUser.avatarIcon, { width: '34px', height: '34px', fontSize: '13px' })}
                    <div className="create-group-search-result-info">
                      <span className="create-group-result-name">{searchedUser.displayName || searchedUser.username}</span>
                      <span className="create-group-result-username">@{searchedUser.username}</span>
                    </div>
                    <button type="button" className="create-group-add-user-btn" onClick={addSearchedUser}>Select</button>
                  </div>
                )}

                {pendingAdd.length > 0 && (
                  <>
                    <div className="create-group-members-label-row">
                      <span className="create-group-picker-label">Pending invites</span>
                      <span className="create-group-member-count">{pendingAdd.length}</span>
                    </div>
                    <div className="group-pending-list">
                      {pendingAdd.map((user) => (
                        <div key={user.username} className="group-member-row">
                          {renderAvatar(user.username, user.displayName, user.avatarIcon, { width: '36px', height: '36px', fontSize: '13px' })}
                          <div className="group-member-info">
                            <span className="group-member-name">{user.displayName || user.username}</span>
                            <span className="group-member-username">@{user.username}</span>
                          </div>
                          <button
                            type="button"
                            className="group-member-action-btn remove-btn"
                            title="Remove from selection"
                            onClick={() => setPendingAdd(prev => prev.filter(u => u.username !== user.username))}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <button
                  type="button"
                  className={`group-add-confirm-btn ${pendingAdd.length === 0 || busy ? 'disabled' : ''}`}
                  onClick={confirmAddPending}
                  disabled={pendingAdd.length === 0 || busy}
                >
                  {busy ? 'Sealing new encryption keys…' : `Add ${pendingAdd.length || ''} to group`}
                </button>
                <p className="group-add-note">Adding members rotates the group encryption key. New members will only see messages sent after they join.</p>
              </>
            )}

            {view === 'edit-info' && (
              <>
                <div className="create-group-identity-row">
                  <div className="group-avatar-upload">
                    {renderAvatar(editName.trim() || 'G', null, editAvatarImage ? JSON.stringify({ image: editAvatarImage }) : null, { width: '64px', height: '64px', fontSize: '24px' })}
                    <button
                      type="button"
                      className="group-avatar-cam-btn"
                      onClick={() => editFileInputRef.current?.click()}
                      disabled={busy}
                      title={editAvatarImage ? 'Change photo' : 'Add photo'}
                      aria-label="Change group photo"
                    >
                      <Camera size={13} />
                    </button>
                  </div>
                  <input
                    type="text"
                    className="create-group-name-input"
                    placeholder="Group name"
                    value={editName}
                    maxLength={32}
                    onChange={(e) => setEditName(e.target.value)}
                    disabled={busy}
                  />
                </div>

                <input
                  ref={editFileInputRef}
                  type="file"
                  accept="image/png, image/jpeg, image/jpg, image/webp, image/gif, .png, .jpg, .jpeg, .webp, .gif"
                  style={{ display: 'none' }}
                  onChange={handleEditAvatarFileChange}
                />

                {editAvatarImage && (
                  <button type="button" className="group-avatar-remove-btn" onClick={() => setEditAvatarImage('')} disabled={busy}>
                    <Trash2 size={13} /> Remove photo
                  </button>
                )}

                <button
                  type="button"
                  className={`group-add-confirm-btn ${busy ? 'disabled' : ''}`}
                  onClick={confirmUpdateInfo}
                  disabled={busy}
                >
                  {busy ? 'Encrypting & saving…' : 'Save changes'}
                </button>
              </>
            )}
          </div>
        </div>

        {confirmAction && (
          <div
            className={`group-confirm-layer ${confirmClosing ? 'closing' : ''}`}
            onClick={busy ? undefined : closeConfirm}
          >
            <div
              className={`group-confirm-card glass ${confirmClosing ? 'closing' : ''}`}
              onClick={(e) => e.stopPropagation()}
            >
              {confirmAction.type === 'remove' && (
                <>
                  <h4>Remove @{confirmAction.username}?</h4>
                  <p>They will no longer receive messages in this group. The encryption key will be rotated immediately so they cannot read future messages.</p>
                  <div className="group-confirm-actions">
                    <button className="confirmation-cancel-btn" onClick={closeConfirm} disabled={busy}>Cancel</button>
                    <button className="confirmation-danger-btn delete-confirm" onClick={runConfirmed} disabled={busy}>Remove</button>
                  </div>
                </>
              )}
              {confirmAction.type === 'leave' && (
                <>
                  <h4>Leave this group?</h4>
                  <p>You will stop receiving messages{isOwner ? '. Ownership will transfer to the earliest joined member.' : '.'}</p>
                  <div className="group-confirm-actions">
                    <button className="confirmation-cancel-btn" onClick={closeConfirm} disabled={busy}>Cancel</button>
                    <button className="confirmation-danger-btn leave-confirm" onClick={runConfirmed} disabled={busy}>Leave</button>
                  </div>
                </>
              )}
              {confirmAction.type === 'delete' && (
                <>
                  <h4>Delete this group?</h4>
                  <p>The group and its encrypted history will be permanently removed for all members. This cannot be undone.</p>
                  <div className="group-confirm-actions">
                    <button className="confirmation-cancel-btn" onClick={closeConfirm} disabled={busy}>Cancel</button>
                    <button className="confirmation-danger-btn delete-confirm" onClick={runConfirmed} disabled={busy}>Delete Forever</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GroupInfoModal;
