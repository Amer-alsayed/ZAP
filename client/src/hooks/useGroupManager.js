import { useState, useRef, useEffect, useCallback } from 'react';
import { soundEngine } from '../services/soundEffects';
import { warmupMediaCache } from '../services/mediaCache';
import { searchUser } from '../services/api';
import {
  deriveSharedSecret,
  signData,
  verifyDataSignature
} from '../services/crypto';
import {
  generateGroupKeyMaterial,
  importGroupKey,
  sealGroupKeyEnvelope,
  openGroupKeyEnvelope,
  encryptGroupPayload,
  decryptGroupPayload
} from '../services/groupCrypto';
import {
  getSocket,
  emitGetGroups,
  emitGetGroupKey,
  emitGetGroupMessages,
  emitSendGroupMessage,
  emitCreateGroup,
  emitAddGroupMembers,
  emitRemoveGroupMember,
  emitLeaveGroup,
  emitDeleteGroup,
  emitUpdateGroupInfo,
  emitSetMemberRole,
  emitMarkGroupRead
} from '../services/socket';

export function useGroupManager({
  currentUser,
  contactsRef,
  sharedSecrets,
  showToast,
  onBackToMenu,
  onClearActiveContact
}) {
  const [groups, setGroups] = useState(() => {
    try {
      const username = localStorage.getItem('chatra_username');
      if (username) {
        const stored = localStorage.getItem(`groups_${username}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && parsed.v === 1 && Array.isArray(parsed.groups)) {
            return parsed.groups
              .filter(g => g && typeof g.id === 'number' && typeof g.name === 'string')
              .map(g => ({
                ...g,
                members: Array.isArray(g.members) ? g.members : [],
                messages: Array.isArray(g.messages) ? g.messages : [],
                typingUsers: []
              }));
          }
        }
      }
    } catch (e) {}
    return [];
  });
  const groupsRef = useRef([]);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  const [activeGroup, setActiveGroup] = useState(null);
  const activeGroupRef = useRef(null);
  useEffect(() => {
    activeGroupRef.current = activeGroup;
  }, [activeGroup]);

  const lastActiveGroupVmRef = useRef(null);
  const lastChatKindRef = useRef(null);
  const previousActiveGroupRef = useRef(null);

  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const showCreateGroupRef = useRef(false);
  useEffect(() => {
    showCreateGroupRef.current = showCreateGroup;
    if (showCreateGroup && window.history.state !== 'create-group') {
      window.history.pushState('create-group', '');
    }
  }, [showCreateGroup]);

  const [groupInfoGroupId, setGroupInfoGroupId] = useState(null);
  const groupInfoGroupIdRef = useRef(null);
  useEffect(() => {
    groupInfoGroupIdRef.current = groupInfoGroupId;
    if (groupInfoGroupId !== null && window.history.state !== 'group-info') {
      window.history.pushState('group-info', '');
    }
  }, [groupInfoGroupId]);

  const groupKeysRef = useRef({});
  const pendingGroupKeysRef = useRef({});
  const userProfilesRef = useRef({});
  const groupTypingTimersRef = useRef({});

  // Persist groups debounced
  const groupsPersistTimerRef = useRef(null);
  const pendingGroupsPayloadRef = useRef(null);
  const isGroupsLoadedRef = useRef(false);

  const flushGroupsCache = useCallback(() => {
    if (!pendingGroupsPayloadRef.current) return;
    const { key, value } = pendingGroupsPayloadRef.current;
    pendingGroupsPayloadRef.current = null;
    if (groupsPersistTimerRef.current) {
      window.clearTimeout(groupsPersistTimerRef.current);
      groupsPersistTimerRef.current = null;
    }
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      console.warn('LocalStorage quota exceeded while persisting groups:', err.message);
    }
  }, []);

  useEffect(() => {
    if (!currentUser || !isGroupsLoadedRef.current) return;
    const slimGroups = groups.map(g => ({
      id: g.id,
      name: g.name,
      avatarIcon: g.avatarIcon,
      myRole: g.myRole,
      kv: g.kv,
      joinedKv: g.joinedKv,
      createdBy: g.createdBy,
      members: Array.isArray(g.members) ? g.members : [],
      lastReadId: g.lastReadId || 0,
      unreadCount: g.unreadCount || 0,
      lastMessage: g.lastMessage || null,
      messages: (g.messages || []).slice(-50)
    }));
    pendingGroupsPayloadRef.current = {
      key: `groups_${currentUser.username}`,
      value: JSON.stringify({ v: 1, groups: slimGroups })
    };
    if (groupsPersistTimerRef.current) window.clearTimeout(groupsPersistTimerRef.current);
    groupsPersistTimerRef.current = window.setTimeout(flushGroupsCache, 500);
  }, [groups, currentUser, flushGroupsCache]);

  useEffect(() => {
    const onBeforeUnload = () => flushGroupsCache();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      flushGroupsCache();
    };
  }, [flushGroupsCache]);

  const patchGroup = useCallback((groupId, updater) => {
    setGroups(prev => prev.map(g => (g.id === groupId ? updater(g) : g)));
    setActiveGroup(prev => {
      if (prev && prev.id === groupId) {
        return updater(prev);
      }
      return prev;
    });
  }, []);

  const appendGroupMessage = useCallback((groupId, msg) => {
    patchGroup(groupId, g => {
      if (g.messages.some(m => String(m.id) === String(msg.id))) return { ...g, lastMessage: msg };
      const isActiveOpen = activeGroupRef.current?.id === groupId;
      const isMine = String(msg.sender).toLowerCase() === currentUser?.username?.toLowerCase();
      const nextUnread = (!isActiveOpen && !isMine && msg.mediaType !== 'system' && msg.id > (g.lastReadId || 0))
        ? (g.unreadCount || 0) + 1
        : g.unreadCount;
      return { ...g, messages: [...g.messages, msg], unreadCount: nextUnread, lastMessage: msg };
    });
  }, [currentUser?.username, patchGroup]);

  const getProfileCached = useCallback(async (username) => {
    const lower = String(username || '').toLowerCase();
    if (!lower) throw new Error('Invalid username');
    if (userProfilesRef.current[lower]) return userProfilesRef.current[lower];

    const fromContacts = contactsRef?.current?.find(c => c.username.toLowerCase() === lower);
    if (fromContacts && fromContacts.publicIdentityKey && fromContacts.publicSigningKey) {
      const profile = {
        username: fromContacts.username,
        publicIdentityKey: fromContacts.publicIdentityKey,
        publicSigningKey: fromContacts.publicSigningKey,
        displayName: fromContacts.displayName || null,
        avatarIcon: fromContacts.avatarIcon || null
      };
      userProfilesRef.current[lower] = profile;
      return profile;
    }

    if (!currentUser?.token) throw new Error('Session not ready');
    const data = await searchUser(lower, currentUser.token);
    const profile = {
      username: data.username || username,
      publicIdentityKey: data.publicIdentityKey,
      publicSigningKey: data.publicSigningKey,
      displayName: data.displayName || null,
      avatarIcon: data.avatarIcon || null
    };
    userProfilesRef.current[lower] = profile;
    return profile;
  }, [contactsRef, currentUser?.token]);

  const getPairwiseSecretFor = useCallback(async (username) => {
    const lower = String(username).toLowerCase();
    if (sharedSecrets?.current && sharedSecrets.current[lower]) return sharedSecrets.current[lower];
    const profile = await getProfileCached(username);
    const secret = await deriveSharedSecret(currentUser.keys.privateIdentityKey, profile.publicIdentityKey);
    if (sharedSecrets?.current) {
      sharedSecrets.current[profile.username.toLowerCase()] = secret;
    }
    return secret;
  }, [currentUser?.keys?.privateIdentityKey, getProfileCached, sharedSecrets]);

  const fetchGroupKey = useCallback(async (groupId, kv) => {
    const cacheKey = `${groupId}:${kv}`;
    if (groupKeysRef.current[cacheKey]) return groupKeysRef.current[cacheKey];
    if (pendingGroupKeysRef.current[cacheKey]) return pendingGroupKeysRef.current[cacheKey];

    const promise = (async () => {
      const envelope = await emitGetGroupKey(groupId, kv);
      if (!envelope) throw new Error('Group key envelope unavailable');
      const pairwiseSecret = await getPairwiseSecretFor(envelope.fromUser);
      const rawMaterial = await openGroupKeyEnvelope(envelope, pairwiseSecret);
      const cryptoKey = await importGroupKey(rawMaterial);
      groupKeysRef.current[cacheKey] = cryptoKey;
      return cryptoKey;
    })();

    pendingGroupKeysRef.current[cacheKey] = promise;
    try {
      return await promise;
    } finally {
      delete pendingGroupKeysRef.current[cacheKey];
    }
  }, [getPairwiseSecretFor]);

  const rememberGroupKey = useCallback(async (groupId, kv, rawMaterial) => {
    const cryptoKey = await importGroupKey(rawMaterial);
    groupKeysRef.current[`${groupId}:${kv}`] = cryptoKey;
    return cryptoKey;
  }, []);

  const encryptGroupMeta = useCallback(async (name, avatarIcon, groupKey) => {
    const nameEnc = await encryptGroupPayload({ n: name }, groupKey);
    let avatarEnc = null;
    if (avatarIcon) {
      avatarEnc = await encryptGroupPayload({ a: avatarIcon }, groupKey);
    }
    return { nameEnc, avatarEnc };
  }, []);

  const decryptGroupName = useCallback(async (metaPayload) => {
    const key = await fetchGroupKey(metaPayload.id, metaPayload.nameKv);
    const payload = await decryptGroupPayload(metaPayload.nameCiphertext, key, metaPayload.nameIv);
    return payload.n || '';
  }, [fetchGroupKey]);

  const decryptGroupAvatar = useCallback(async (metaPayload) => {
    if (!metaPayload.avatarCiphertext || !metaPayload.avatarIv) return null;
    const key = await fetchGroupKey(metaPayload.id, metaPayload.avatarKv || metaPayload.nameKv);
    const payload = await decryptGroupPayload(metaPayload.avatarCiphertext, key, metaPayload.avatarIv);
    return payload.a || null;
  }, [fetchGroupKey]);

  const hydrateGroupMembers = useCallback(async (members) => {
    const hydrated = [];
    for (const m of members) {
      try {
        const lower = m.username.toLowerCase();
        let profile = userProfilesRef.current[lower];
        if (!profile) {
          profile = await getProfileCached(m.username).catch(() => null);
        }
        hydrated.push({ ...m, profile: profile ? { displayName: profile.displayName, avatarIcon: profile.avatarIcon } : null });
      } catch (e) {
        hydrated.push({ ...m, profile: null });
      }
    }
    return hydrated;
  }, [getProfileCached]);

  const buildLocalGroup = useCallback(async (payload) => {
    let name = '';
    let avatarIcon = null;
    try {
      name = await decryptGroupName(payload);
    } catch (e) {
      console.error('Failed to decrypt group name:', e);
      name = 'Encrypted Group';
    }
    try {
      avatarIcon = await decryptGroupAvatar(payload);
    } catch (e) {
      console.error('Failed to decrypt group avatar:', e);
    }
    const members = await hydrateGroupMembers(payload.members || []);
    return {
      id: payload.id,
      name,
      avatarIcon,
      myRole: payload.myRole,
      kv: payload.kv,
      joinedKv: payload.joinedKv,
      createdBy: payload.createdBy,
      members,
      messages: [],
      unreadCount: 0,
      lastReadId: payload.lastReadId || 0,
      typingUsers: [],
      lastMessage: null
    };
  }, [decryptGroupAvatar, decryptGroupName, hydrateGroupMembers]);

  const processGroupPayload = useCallback(async (encMsg) => {
    const senderProfile = await getProfileCached(encMsg.sender);
    const signatureValid = await verifyDataSignature(encMsg.ciphertext, encMsg.signature, senderProfile.publicSigningKey);
    if (!signatureValid) {
      return {
        id: encMsg.id,
        groupId: encMsg.groupId,
        sender: encMsg.sender,
        timestamp: encMsg.timestamp,
        text: '⚠️ ERROR: Message failed cryptographic integrity verification.',
        mediaType: 'text',
        status: 0
      };
    }

    const key = await fetchGroupKey(encMsg.groupId, encMsg.kv);
    const payload = await decryptGroupPayload(encMsg.ciphertext, key, encMsg.iv);

    if (payload.type === 'system') {
      return {
        id: encMsg.id,
        groupId: encMsg.groupId,
        sender: encMsg.sender,
        timestamp: encMsg.timestamp,
        text: payload.text || '',
        mediaType: 'system',
        status: 0
      };
    }

    return {
      id: encMsg.id,
      groupId: encMsg.groupId,
      sender: encMsg.sender,
      timestamp: encMsg.timestamp,
      text: payload.text || '',
      mediaType: payload.type !== 'text' ? payload.type : null,
      fileMetadata: payload.fileMetadata || null,
      status: 0,
      replyTo: payload.replyTo || null,
      forwarded: payload.forwarded || null
    };
  }, [fetchGroupKey, getProfileCached]);

  const loadGroupHistory = useCallback(async (groupState) => {
    try {
      const res = await emitGetGroupMessages(groupState.id);
      const decrypted = [];
      for (const enc of res.messages) {
        const processed = await processGroupPayload(enc).catch(() => null);
        if (processed) decrypted.push(processed);
      }
      patchGroup(groupState.id, g => ({
        ...g,
        messages: decrypted,
        unreadCount: (() => {
          const meLower = currentUser?.username?.toLowerCase();
          return decrypted.filter(m =>
            String(m.sender).toLowerCase() !== meLower &&
            m.mediaType !== 'system' &&
            m.id > (g.lastReadId || 0)
          ).length;
        })()
      }));
      warmupMediaCache(decrypted);
      return decrypted;
    } catch (err) {
      console.error('Failed to load group history:', groupState.id, err);
      return [];
    }
  }, [currentUser?.username, patchGroup, processGroupPayload]);

  const loadGroups = useCallback(async () => {
    try {
      const serverGroups = await emitGetGroups();
      const locals = await Promise.all(serverGroups.map(payload => buildLocalGroup(payload)));
      setGroups(prev => {
        const byId = new Map(prev.map(g => [g.id, g]));
        const merged = locals.map(local => {
          const existing = byId.get(local.id);
          if (existing) {
            return {
              ...local,
              messages: existing.messages,
              unreadCount: existing.unreadCount,
              lastReadId: Math.max(existing.lastReadId || 0, local.lastReadId || 0),
              typingUsers: existing.typingUsers
            };
          }
          return local;
        });
        return merged;
      });

      for (const local of locals) {
        await loadGroupHistory(local);
      }
      return locals;
    } catch (err) {
      console.error('Failed to load groups:', err);
      return [];
    }
  }, [buildLocalGroup, loadGroupHistory]);

  // Restore groups synchronously from local cache on mount/login and reconcile with server
  useEffect(() => {
    if (currentUser) {
      const storedGroups = localStorage.getItem(`groups_${currentUser.username}`);
      if (storedGroups) {
        try {
          const parsed = JSON.parse(storedGroups);
          if (parsed && parsed.v === 1 && Array.isArray(parsed.groups)) {
            const sanitizedGroups = parsed.groups
              .filter(g => g && typeof g.id === 'number' && typeof g.name === 'string')
              .map(g => ({
                ...g,
                members: Array.isArray(g.members) ? g.members : [],
                messages: Array.isArray(g.messages) ? g.messages : [],
                typingUsers: []
              }));
            setGroups(sanitizedGroups);
          }
        } catch (e) {
          console.warn('Failed to parse cached groups:', e);
          localStorage.removeItem(`groups_${currentUser.username}`);
        }
      }
      isGroupsLoadedRef.current = true;
      loadGroups();
    } else {
      isGroupsLoadedRef.current = false;
      setGroups([]);
      setActiveGroup(null);
    }
  }, [currentUser, loadGroups]);

  const sendSystemMessageWith = useCallback(async (groupId, kvVersion, cryptoKey, text) => {
    try {
      const { ciphertext, iv } = await encryptGroupPayload({ type: 'system', text }, cryptoKey);
      const signature = await signData(ciphertext, currentUser.keys.privateSigningKey);
      await emitSendGroupMessage(groupId, ciphertext, iv, signature);
    } catch (err) {
      console.warn('Failed to post system message:', err);
    }
  }, [currentUser?.keys?.privateSigningKey]);

  const sendGroupSystemMessage = useCallback(async (groupId, text) => {
    try {
      const group = groupsRef.current.find(g => g.id === groupId);
      if (!group) return;
      const groupKey = await fetchGroupKey(groupId, group.kv);
      await sendSystemMessageWith(groupId, group.kv, groupKey, text);
    } catch (err) {
      console.warn('Failed to post system message:', err);
    }
  }, [fetchGroupKey, sendSystemMessageWith]);

  const rotateGroupKeysFor = useCallback(async (memberUsernames, { name, avatarIcon } = {}) => {
    const rawMaterial = generateGroupKeyMaterial();
    const newGroupKey = await importGroupKey(rawMaterial);

    const envelopes = {};
    for (const username of memberUsernames) {
      const pairwiseSecret = await getPairwiseSecretFor(username);
      envelopes[String(username).toLowerCase()] = await sealGroupKeyEnvelope(rawMaterial, pairwiseSecret);
    }

    let nameEnc = null;
    let avatarEnc = null;
    if (name !== undefined) {
      const enc = await encryptGroupMeta(name, avatarIcon, newGroupKey);
      nameEnc = enc.nameEnc;
      avatarEnc = enc.avatarEnc;
    }

    return { rawMaterial, newGroupKey, envelopes, nameEnc, avatarEnc };
  }, [encryptGroupMeta, getPairwiseSecretFor]);

  const handleSendGroupMessage = useCallback(async (msgContent) => {
    const group = activeGroupRef.current;
    if (!group || !currentUser) return;

    try {
      const groupKey = await fetchGroupKey(group.id, group.kv);
      const payload = { ...msgContent };
      delete payload.isNew;
      const { ciphertext, iv } = await encryptGroupPayload(payload, groupKey);
      const signature = await signData(ciphertext, currentUser.keys.privateSigningKey);
      const ack = await emitSendGroupMessage(group.id, ciphertext, iv, signature);

      const localMsg = {
        id: ack.messageId,
        groupId: group.id,
        sender: currentUser.username,
        timestamp: ack.timestamp,
        text: msgContent.text || '',
        mediaType: msgContent.type !== 'text' ? msgContent.type : null,
        fileMetadata: msgContent.fileMetadata || null,
        status: 0,
        replyTo: msgContent.replyTo || null,
        forwarded: msgContent.forwarded || null,
        isNew: true
      };

      appendGroupMessage(group.id, localMsg);
    } catch (err) {
      console.error('Group E2EE send failed:', err);
      showToast?.(`Failed to send message: ${err.message || 'Unknown error'}`, 'error');
    }
  }, [appendGroupMessage, currentUser, fetchGroupKey, showToast]);

  const handleSelectGroup = useCallback(async (groupOrVm) => {
    if (!groupOrVm) return;
    const gid = groupOrVm.id ?? groupOrVm.groupId;

    if (window.history.state !== 'chat') {
      window.history.pushState('chat', '');
    }
    lastChatKindRef.current = 'group';

    if (onClearActiveContact) {
      onClearActiveContact();
    }
    setGroupInfoGroupId(null);

    const source = groupsRef.current.find(g => g.id === gid) || groupOrVm;
    const vm = {
      ...source,
      isGroup: true,
      groupId: source.id,
      username: `group-${source.id}`,
      customName: null,
      displayName: source.name,
      status: 'online',
      isSaved: true,
      isVerified: false,
      unreadCount: 0,
      groupTypingNames: (source.typingUsers || [])
        .filter(u => u.toLowerCase() !== currentUser?.username?.toLowerCase())
        .map(u => {
          const m = (source.members || []).find(mm => mm.username.toLowerCase() === u.toLowerCase());
          return m?.profile?.displayName || u;
        })
    };
    lastActiveGroupVmRef.current = vm;
    setActiveGroup(vm);

    const lastId = source.messages.length > 0 ? source.messages[source.messages.length - 1].id : 0;
    patchGroup(gid, g => ({ ...g, unreadCount: 0, lastReadId: Math.max(g.lastReadId || 0, lastId) }));
    emitMarkGroupRead(gid, Math.max(source.lastReadId || 0, lastId));
  }, [currentUser?.username, onClearActiveContact, patchGroup]);

  const handleCreateGroup = useCallback(async ({ name, avatarIcon, members }) => {
    try {
      if (!Array.isArray(members) || members.length === 0) {
        throw new Error('Select at least one member');
      }

      const profiles = [];
      for (const member of members) {
        const known = contactsRef?.current?.find(c => c.username.toLowerCase() === String(member.username).toLowerCase());
        if (known && known.publicIdentityKey && known.publicSigningKey) {
          const prof = {
            username: known.username,
            publicIdentityKey: known.publicIdentityKey,
            publicSigningKey: known.publicSigningKey,
            displayName: known.displayName || null,
            avatarIcon: known.avatarIcon || null
          };
          userProfilesRef.current[known.username.toLowerCase()] = prof;
          profiles.push(prof);
        } else {
          profiles.push(await getProfileCached(member.username));
        }
      }

      const rawMaterial = generateGroupKeyMaterial();
      const envelopes = {};
      const myLower = currentUser.username.toLowerCase();
      const selfSecret = await deriveSharedSecret(currentUser.keys.privateIdentityKey, currentUser.keys.publicIdentityKey);
      if (sharedSecrets?.current) {
        sharedSecrets.current[myLower] = selfSecret;
      }
      envelopes[myLower] = await sealGroupKeyEnvelope(rawMaterial, selfSecret);

      for (const profile of profiles) {
        const secret = await deriveSharedSecret(currentUser.keys.privateIdentityKey, profile.publicIdentityKey);
        if (sharedSecrets?.current) {
          sharedSecrets.current[profile.username.toLowerCase()] = secret;
        }
        envelopes[profile.username.toLowerCase()] = await sealGroupKeyEnvelope(rawMaterial, secret);
      }

      const groupKeyV1 = await importGroupKey(rawMaterial);
      const { nameEnc, avatarEnc } = await encryptGroupMeta(name, avatarIcon, groupKeyV1);

      const ack = await emitCreateGroup({
        nameCiphertext: nameEnc.ciphertext,
        nameIv: nameEnc.iv,
        avatarCiphertext: avatarEnc ? avatarEnc.ciphertext : null,
        avatarIv: avatarEnc ? avatarEnc.iv : null,
        members: profiles.map(p => ({ username: p.username })),
        envelopes
      });

      if (!ack || !ack.success) throw new Error(ack?.error || 'Server rejected group creation');

      const gid = ack.groupId;
      groupKeysRef.current[`${gid}:1`] = groupKeyV1;

      const local = await buildLocalGroup(ack.group);
      setGroups(prev => [...prev, local]);
      setShowCreateGroup(false);
      soundEngine.playMessageSent();
      showToast?.(`"${local.name}" created with ${local.members.length} members.`, 'success', 'Group Created');

      await sendSystemMessageWith(gid, 1, groupKeyV1, `${currentUser.displayName || currentUser.username} created the group`);
      handleSelectGroup(groupsRef.current.find(g => g.id === gid) || local);
    } catch (err) {
      console.error('Group creation failed:', err);
      throw err;
    }
  }, [
    buildLocalGroup,
    contactsRef,
    currentUser,
    encryptGroupMeta,
    getProfileCached,
    handleSelectGroup,
    sendSystemMessageWith,
    sharedSecrets,
    showToast
  ]);

  const handleLeaveGroupById = useCallback(async (groupId) => {
    const group = groupsRef.current.find(g => g.id === groupId);
    if (!group) return;

    try {
      const meLower = currentUser.username.toLowerCase();
      const remaining = (group.members || [])
        .filter(m => m.username.toLowerCase() !== meLower)
        .map(m => m.username);

      let payloadEnvelopes = {};
      let meta = {};
      if (remaining.length > 0) {
        const rotation = await rotateGroupKeysFor(remaining, { name: group.name, avatarIcon: group.avatarIcon });
        payloadEnvelopes = rotation.envelopes;
        meta = {
          nameCiphertext: rotation.nameEnc.ciphertext,
          nameIv: rotation.nameEnc.iv,
          avatarCiphertext: rotation.avatarEnc ? rotation.avatarEnc.ciphertext : null,
          avatarIv: rotation.avatarEnc ? rotation.avatarEnc.iv : null
        };
      }

      await sendGroupSystemMessage(groupId, `${currentUser.displayName || currentUser.username} left`);
      const ack = await emitLeaveGroup({
        groupId,
        envelopes: payloadEnvelopes,
        ...meta
      });
      if (!ack || !ack.success) throw new Error(ack?.error || 'Failed to leave group');

      Object.keys(groupKeysRef.current).forEach(k => {
        if (k.startsWith(`${groupId}:`)) delete groupKeysRef.current[k];
      });
      setGroups(prev => prev.filter(g => g.id !== groupId));
      if (activeGroupRef.current?.id === groupId && onBackToMenu) {
        onBackToMenu();
      }
      showToast?.(`You left "${group.name}".`, 'success', 'Left Group');
    } catch (err) {
      console.error('Failed to leave group:', err);
      showToast?.(err.message || 'Failed to leave group', 'error');
    }
  }, [currentUser, onBackToMenu, rotateGroupKeysFor, sendGroupSystemMessage, showToast]);

  const handleDeleteGroupById = useCallback(async (groupId) => {
    const group = groupsRef.current.find(g => g.id === groupId);
    if (!group) return;
    try {
      const ack = await emitDeleteGroup(groupId);
      if (!ack || !ack.success) throw new Error(ack?.error || 'Failed to delete group');
      Object.keys(groupKeysRef.current).forEach(k => {
        if (k.startsWith(`${groupId}:`)) delete groupKeysRef.current[k];
      });
      setGroups(prev => prev.filter(g => g.id !== groupId));
      setGroupInfoGroupId(null);
      if (activeGroupRef.current?.id === groupId && onBackToMenu) {
        onBackToMenu();
      }
      showToast?.(`"${group.name}" was deleted permanently.`, 'success', 'Group Deleted');
    } catch (err) {
      console.error('Failed to delete group:', err);
      showToast?.(err.message || 'Failed to delete group', 'error');
    }
  }, [onBackToMenu, showToast]);

  const handleAddMembersToGroup = useCallback(async (groupId, users) => {
    const group = groupsRef.current.find(g => g.id === groupId);
    if (!group) throw new Error('Group not found');

    const existing = new Set((group.members || []).map(m => m.username.toLowerCase()));
    const additions = users.filter(u => !existing.has(String(u.username).toLowerCase()));
    if (additions.length === 0) throw new Error('Selected users are already members');

    const futureRoster = [
      ...(group.members || []).map(m => m.username),
      ...additions.map(u => u.username)
    ];

    for (const user of additions) {
      if (!(contactsRef?.current?.find(c => c.username.toLowerCase() === user.username.toLowerCase()))) {
        await getProfileCached(user.username).catch(() => null);
      }
    }

    const rotation = await rotateGroupKeysFor(futureRoster, { name: group.name, avatarIcon: group.avatarIcon });

    const ack = await emitAddGroupMembers({
      groupId,
      members: additions.map(u => ({ username: u.username })),
      envelopes: rotation.envelopes,
      nameCiphertext: rotation.nameEnc.ciphertext,
      nameIv: rotation.nameEnc.iv,
      avatarCiphertext: rotation.avatarEnc ? rotation.avatarEnc.ciphertext : null,
      avatarIv: rotation.avatarEnc ? rotation.avatarEnc.iv : null
    });
    if (!ack || !ack.success) throw new Error(ack?.error || 'Failed to add members');

    const newKey = await rememberGroupKey(groupId, ack.kv, rotation.rawMaterial);
    patchGroup(groupId, g => ({
      ...g,
      kv: ack.kv,
      members: [
        ...(g.members || []),
        ...additions.map(u => ({ username: u.username, role: 'member', profile: { displayName: u.displayName, avatarIcon: u.avatarIcon } }))
      ]
    }));

    const names = additions.map(u => u.displayName || u.username).join(', ');
    await sendSystemMessageWith(groupId, ack.kv, newKey, `${currentUser.displayName || currentUser.username} added ${names}`);
  }, [
    contactsRef,
    currentUser,
    getProfileCached,
    patchGroup,
    rememberGroupKey,
    rotateGroupKeysFor,
    sendSystemMessageWith
  ]);

  const handleRemoveMemberFromGroup = useCallback(async (groupId, targetUsername) => {
    const group = groupsRef.current.find(g => g.id === groupId);
    if (!group) throw new Error('Group not found');

    const remaining = (group.members || [])
      .filter(m => m.username.toLowerCase() !== targetUsername.toLowerCase())
      .map(m => m.username);

    const rotation = await rotateGroupKeysFor(remaining, { name: group.name, avatarIcon: group.avatarIcon });
    const ack = await emitRemoveGroupMember({
      groupId,
      targetUsername,
      envelopes: rotation.envelopes,
      nameCiphertext: rotation.nameEnc.ciphertext,
      nameIv: rotation.nameEnc.iv,
      avatarCiphertext: rotation.avatarEnc ? rotation.avatarEnc.ciphertext : null,
      avatarIv: rotation.avatarEnc ? rotation.avatarEnc.iv : null
    });
    if (!ack || !ack.success) throw new Error(ack?.error || 'Failed to remove member');

    const newKey = await rememberGroupKey(groupId, ack.kv, rotation.rawMaterial);
    patchGroup(groupId, g => ({
      ...g,
      kv: ack.kv,
      members: (g.members || []).filter(m => m.username.toLowerCase() !== targetUsername.toLowerCase())
    }));

    await sendSystemMessageWith(groupId, ack.kv, newKey, `${targetUsername} was removed by ${currentUser.displayName || currentUser.username}`);
  }, [currentUser, patchGroup, rememberGroupKey, rotateGroupKeysFor, sendSystemMessageWith]);

  const handleUpdateGroupInfo = useCallback(async (groupId, { name, avatarIcon }) => {
    const group = groupsRef.current.find(g => g.id === groupId);
    if (!group) throw new Error('Group not found');

    const groupKey = await fetchGroupKey(groupId, group.kv);
    const { nameEnc, avatarEnc } = await encryptGroupMeta(name, avatarIcon, groupKey);

    const ack = await emitUpdateGroupInfo({
      groupId,
      nameCiphertext: nameEnc.ciphertext,
      nameIv: nameEnc.iv,
      avatarCiphertext: avatarEnc ? avatarEnc.ciphertext : null,
      avatarIv: avatarEnc ? avatarEnc.iv : null
    });
    if (!ack || !ack.success) throw new Error(ack?.error || 'Failed to update group');

    patchGroup(groupId, g => ({ ...g, name, avatarIcon }));
    await sendGroupSystemMessage(groupId, `${currentUser.displayName || currentUser.username} renamed the group to "${name}"`);
  }, [currentUser, encryptGroupMeta, fetchGroupKey, patchGroup, sendGroupSystemMessage]);

  const handleSetMemberRole = useCallback(async (groupId, targetUsername, role) => {
    const ack = await emitSetMemberRole(groupId, targetUsername, role);
    if (!ack || !ack.success) throw new Error(ack?.error || 'Failed to change role');
    patchGroup(groupId, g => ({
      ...g,
      members: (g.members || []).map(m => (
        m.username.toLowerCase() === targetUsername.toLowerCase() ? { ...m, role } : m
      ))
    }));
  }, [patchGroup]);

  // Socket listeners for group updates & incoming messages
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !currentUser) return;

    const handleIncomingGroupMessage = async (encMsg) => {
      try {
        const msg = await processGroupPayload(encMsg);
        if (!msg) return;

        appendGroupMessage(encMsg.groupId, msg);

        const isOpen = activeGroupRef.current?.id === encMsg.groupId;
        if (isOpen) {
          emitMarkGroupRead(encMsg.groupId, encMsg.id);
          patchGroup(encMsg.groupId, g => ({ ...g, lastReadId: Math.max(g.lastReadId || 0, encMsg.id) }));
        }

        if (String(encMsg.sender).toLowerCase() !== currentUser.username.toLowerCase() && msg.mediaType !== 'system') {
          soundEngine.playMessageReceived();
        }
      } catch (err) {
        console.error('Failed to process incoming group message:', err);
      }
    };

    const handleGroupAdded = async (eventData) => {
      try {
        const payload = eventData?.group || eventData;
        if (!payload || !payload.id) return;
        const local = await buildLocalGroup(payload);
        setGroups(prev => {
          if (prev.some(g => g.id === local.id)) return prev;
          return [...prev, local];
        });
        await loadGroupHistory(local);
        showToast?.(`You were added to "${local.name}".`, 'info', 'New Group');
      } catch (err) {
        console.error('Failed to process group-added event:', err);
      }
    };

    const handleGroupSync = async (eventData) => {
      try {
        const payload = eventData?.group || eventData;
        if (!payload || !payload.id) return;
        const updated = await buildLocalGroup(payload);
        setGroups(prev => prev.map(g => (g.id === updated.id ? { ...g, ...updated, messages: g.messages, unreadCount: g.unreadCount } : g)));
        setActiveGroup(prev => (prev && prev.id === updated.id ? { ...prev, ...updated, messages: prev.messages, unreadCount: prev.unreadCount } : prev));
      } catch (err) {
        console.error('Failed to process group-sync event:', err);
      }
    };

    const handleGroupUpdated = async ({ groupId, nameCiphertext, nameIv, avatarCiphertext, avatarIv, nameKv, avatarKv }) => {
      try {
        const name = await decryptGroupName({ id: groupId, nameCiphertext, nameIv, nameKv });
        const avatarIcon = avatarCiphertext ? await decryptGroupAvatar({ id: groupId, avatarCiphertext, avatarIv, avatarKv }) : null;
        patchGroup(groupId, g => ({ ...g, name, avatarIcon }));
      } catch (err) {
        console.error('Failed to process group-updated event:', err);
      }
    };

    const handleGroupDeleted = ({ groupId }) => {
      setGroups(prev => prev.filter(g => g.id !== groupId));
      setGroupInfoGroupId(null);
      if (activeGroupRef.current?.id === groupId && onBackToMenu) {
        onBackToMenu();
      }
    };

    const handleGroupTyping = ({ groupId, username: typer, isTyping }) => {
      if (String(typer).toLowerCase() === currentUser.username.toLowerCase()) return;
      patchGroup(groupId, g => {
        const current = new Set(g.typingUsers || []);
        if (isTyping) current.add(typer);
        else current.delete(typer);
        return { ...g, typingUsers: Array.from(current) };
      });

      const timerKey = `${groupId}:${typer.toLowerCase()}`;
      if (groupTypingTimersRef.current[timerKey]) {
        window.clearTimeout(groupTypingTimersRef.current[timerKey]);
        delete groupTypingTimersRef.current[timerKey];
      }
      if (isTyping) {
        groupTypingTimersRef.current[timerKey] = window.setTimeout(() => {
          patchGroup(groupId, g => ({
            ...g,
            typingUsers: (g.typingUsers || []).filter(u => u.toLowerCase() !== typer.toLowerCase())
          }));
          delete groupTypingTimersRef.current[timerKey];
        }, 3500);
      }
    };

    const handleGroupMessagesDeleted = ({ groupId, messageIds = [] }) => {
      if (!groupId) return;
      const ids = new Set(messageIds.map(id => String(id)));
      const phase = (mutator) => {
        setGroups(prev => prev.map(g => (g.id === groupId ? { ...g, messages: mutator(g.messages) } : g)));
        setActiveGroup(prev => (prev && prev.id === groupId ? { ...prev, messages: mutator(prev.messages) } : prev));
      };

      phase((msgs) => msgs.map(m => ids.has(String(m.id)) ? { ...m, isDeleting: true, isCollapsing: false } : m));
      window.setTimeout(() => phase((msgs) => msgs.map(m => ids.has(String(m.id)) ? { ...m, isCollapsing: true } : m)), 500);
      window.setTimeout(() => phase((msgs) => msgs.filter(m => !ids.has(String(m.id)))), 1150);
    };

    socket.on('receive-group-message', handleIncomingGroupMessage);
    socket.on('group-added', handleGroupAdded);
    socket.on('group-sync', handleGroupSync);
    socket.on('group-updated', handleGroupUpdated);
    socket.on('group-deleted', handleGroupDeleted);
    socket.on('group-user-typing', handleGroupTyping);
    socket.on('group-messages-deleted', handleGroupMessagesDeleted);

    return () => {
      socket.off('receive-group-message', handleIncomingGroupMessage);
      socket.off('group-added', handleGroupAdded);
      socket.off('group-sync', handleGroupSync);
      socket.off('group-updated', handleGroupUpdated);
      socket.off('group-deleted', handleGroupDeleted);
      socket.off('group-user-typing', handleGroupTyping);
      socket.off('group-messages-deleted', handleGroupMessagesDeleted);
    };
  }, [
    appendGroupMessage,
    buildLocalGroup,
    currentUser,
    decryptGroupAvatar,
    decryptGroupName,
    loadGroupHistory,
    onBackToMenu,
    patchGroup,
    processGroupPayload,
    showToast
  ]);

  return {
    groups,
    setGroups,
    groupsRef,
    activeGroup,
    setActiveGroup,
    activeGroupRef,
    lastActiveGroupVmRef,
    lastChatKindRef,
    previousActiveGroupRef,
    showCreateGroup,
    setShowCreateGroup,
    showCreateGroupRef,
    groupInfoGroupId,
    setGroupInfoGroupId,
    groupInfoGroupIdRef,
    groupKeysRef,
    pendingGroupKeysRef,
    userProfilesRef,
    loadGroups,
    loadGroupHistory,
    handleSendGroupMessage,
    handleSelectGroup,
    handleCreateGroup,
    handleLeaveGroupById,
    handleDeleteGroupById,
    handleAddMembersToGroup,
    handleRemoveMemberFromGroup,
    handleUpdateGroupInfo,
    handleSetMemberRole,
    sendGroupSystemMessage,
    sendSystemMessageWith,
    patchGroup,
    appendGroupMessage,
    flushGroupsCache
  };
}

export default useGroupManager;
