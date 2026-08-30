import { useState, useRef, useEffect, useCallback } from 'react';
import { soundEngine } from '../services/soundEffects';
import { warmupMediaCache } from '../services/mediaCache';
import { searchUser } from '../services/api';
import {
  deriveSharedSecret,
  deriveRatchetedMessageKey,
  deriveAuthKey,
  generateMessageAuthTag,
  verifyMessageAuthTag,
  encryptMessage,
  decryptMessage,
  signData,
  verifyDataSignature,
  computeSafetyNumber
} from '../services/crypto';
import {
  getSocket,
  emitSendMessage,
  emitGetChatHistory,
  emitGetContacts,
  emitMarkAsRead,
  emitDeleteMessages,
  emitDeleteChat,
  emitBlockUser,
  emitUnblockUser,
  emitGetBlockedUsers,
  emitGetUserStatus,
  subscribeToMessages,
  unsubscribeFromMessages,
  subscribeToUserStatus,
  unsubscribeFromUserStatus,
  subscribeToProfileUpdates,
  unsubscribeFromProfileUpdates
} from '../services/socket';

export function useChatManager({
  currentUser,
  setCurrentUser,
  showToast,
  onClearActiveGroup,
  groupsRef,
  fetchGroupKey,
  encryptGroupPayload,
  emitSendGroupMessage,
  patchGroup,
  emitDeleteGroupMessages,
  contactsRef: externalContactsRef,
  sharedSecrets: externalSharedSecrets
}) {
  const [contacts, setContacts] = useState(() => {
    try {
      const username = localStorage.getItem('zap_username') || localStorage.getItem('chatra_username');
      if (username) {
        const stored = localStorage.getItem(`contacts_${username}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            return parsed.map(c => {
              const msgs = c.messages || [];
              const unreadFromMsgs = msgs.filter(m => 
                m.sender?.toLowerCase() === c.username.toLowerCase() && m.status < 2
              ).length;
              const unreadCount = typeof c.unreadCount === 'number' && c.unreadCount > 0
                ? c.unreadCount
                : unreadFromMsgs;

              return {
                ...c,
                status: 'offline',
                unreadCount,
                lastMessage: c.lastMessage || (msgs.length > 0 ? msgs[msgs.length - 1] : null),
                messages: msgs
              };
            });
          }
        }
      }
    } catch (e) {}
    return [];
  });
  const localContactsRef = useRef([]);
  const contactsRef = externalContactsRef || localContactsRef;
  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts, contactsRef]);

  const [activeContact, setActiveContact] = useState(null);
  const activeContactRef = useRef(null);
  useEffect(() => {
    activeContactRef.current = activeContact;
  }, [activeContact]);
  const lastActiveContactRef = useRef(null);
  const previousActiveContactRef = useRef(null);

  const [blockedUsers, setBlockedUsers] = useState([]);
  const blockedUsersRef = useRef([]);
  useEffect(() => {
    blockedUsersRef.current = blockedUsers;
  }, [blockedUsers]);

  const localSharedSecrets = useRef({});
  const sharedSecrets = externalSharedSecrets || localSharedSecrets;
  const conversationRatchetCounters = useRef(new Map());

  const [replyingTo, setReplyingTo] = useState(null);
  const replyingToRef = useRef(null);
  useEffect(() => {
    replyingToRef.current = replyingTo;
  }, [replyingTo]);

  const [forwardingMessage, setForwardingMessage] = useState(null);
  const forwardingMessageRef = useRef(null);
  useEffect(() => {
    forwardingMessageRef.current = forwardingMessage;
    if (forwardingMessage && window.history.state !== 'forward') {
      window.history.pushState('forward', '');
    }
  }, [forwardingMessage]);

  const [safetyNumberDisplay, setSafetyNumberDisplay] = useState('');
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [isSafetyModalClosing, setIsSafetyModalClosing] = useState(false);

  const [lightboxImageSrc, setLightboxImageSrc] = useState(null);
  const [activeLightboxSrc, setActiveLightboxSrc] = useState(null);
  const lightboxRef = useRef(null);

  useEffect(() => {
    lightboxRef.current = lightboxImageSrc;
    if (lightboxImageSrc) {
      setActiveLightboxSrc(lightboxImageSrc);
      window.__isMediaModalOpen = true;
    } else {
      window.__isMediaModalOpen = false;
    }
  }, [lightboxImageSrc]);

  const getNextRatchetSeq = useCallback((contactUsername) => {
    const key = (contactUsername || '').toLowerCase();
    const current = conversationRatchetCounters.current.get(key) || 0;
    const next = current + 1;
    conversationRatchetCounters.current.set(key, next);
    return next;
  }, []);

  // Compute 20-digit Safety Number when active contact changes
  useEffect(() => {
    if (activeContact?.publicIdentityKey && currentUser?.keys?.publicIdentityKey) {
      computeSafetyNumber(currentUser.keys.publicIdentityKey, activeContact.publicIdentityKey)
        .then(res => setSafetyNumberDisplay(res))
        .catch(() => {});
    } else {
      setSafetyNumberDisplay('');
    }
  }, [activeContact, currentUser]);

  // Load blocked users from server upon login
  useEffect(() => {
    if (currentUser) {
      emitGetBlockedUsers()
        .then(list => {
          if (Array.isArray(list)) {
            setBlockedUsers(list.map(u => u.toLowerCase()));
          }
        })
        .catch(err => console.warn('Failed to load blocked users:', err));
    } else {
      setBlockedUsers([]);
    }
  }, [currentUser]);

  const isContactsLoadedRef = useRef(false);

  // Load contacts list on login & restore active chat state synchronously
  useEffect(() => {
    if (currentUser) {
      const stored = localStorage.getItem(`contacts_${currentUser.username}`);
      let initialContacts = [];
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          const blocked = blockedUsersRef.current;
          const seen = new Set();
          for (const contact of parsed) {
            const lowerName = contact.username.toLowerCase();
            if (!seen.has(lowerName) && !blocked.includes(lowerName)) {
              seen.add(lowerName);
              initialContacts.push(contact);
            }
          }
        } catch (err) {
          console.error('Failed to parse cached contacts:', err);
        }
      }
      const sanitized = initialContacts.map(c => {
        const msgs = c.messages || [];
        const unreadFromMsgs = msgs.filter(m => 
          m.sender?.toLowerCase() === c.username.toLowerCase() && m.status < 2
        ).length;
        const unreadCount = typeof c.unreadCount === 'number' && c.unreadCount > 0
          ? c.unreadCount
          : unreadFromMsgs;

        return {
          ...c,
          status: 'offline',
          unreadCount,
          lastMessage: c.lastMessage || (msgs.length > 0 ? msgs[msgs.length - 1] : null),
          messages: msgs
        };
      });
      setContacts(sanitized);
      isContactsLoadedRef.current = true;

      // Also reconcile server conversation partners and unread counts
      emitGetContacts()
        .then((serverContacts) => {
          if (Array.isArray(serverContacts) && serverContacts.length > 0) {
            setContacts(prev => {
              const byName = new Map(prev.map(c => [c.username.toLowerCase(), c]));
              const blocked = blockedUsersRef.current;
              const merged = prev.map(c => {
                const sc = serverContacts.find(s => s.username.toLowerCase() === c.username.toLowerCase());
                if (sc && typeof sc.unreadCount === 'number' && sc.unreadCount > 0) {
                  return { ...c, unreadCount: Math.max(c.unreadCount || 0, sc.unreadCount) };
                }
                return c;
              });

              for (const sc of serverContacts) {
                const lower = sc.username.toLowerCase();
                if (!byName.has(lower) && !blocked.includes(lower)) {
                  byName.set(lower, sc);
                  merged.push({
                    username: sc.username,
                    displayName: sc.displayName || null,
                    avatarIcon: sc.avatarIcon || null,
                    publicIdentityKey: sc.publicIdentityKey,
                    publicSigningKey: sc.publicSigningKey,
                    status: sc.status || 'offline',
                    messages: [],
                    unreadCount: sc.unreadCount || 0,
                    isSaved: false
                  });
                }
              }
              return merged;
            });
          }
        })
        .catch(err => console.warn('Failed to fetch server contacts:', err));
    } else {
      isContactsLoadedRef.current = false;
      setContacts([]);
      setActiveContact(null);
    }
  }, [currentUser]);

  // Persist contacts list changes safely only after initial load
  useEffect(() => {
    if (currentUser && isContactsLoadedRef.current) {
      try {
        const blocked = blockedUsersRef.current;
        const uniqueContacts = [];
        const seen = new Set();
        for (const contact of contacts) {
          const lowerName = contact.username.toLowerCase();
          if (!seen.has(lowerName) && !blocked.includes(lowerName)) {
            seen.add(lowerName);
            uniqueContacts.push({
              username: contact.username,
              publicIdentityKey: contact.publicIdentityKey,
              publicSigningKey: contact.publicSigningKey,
              displayName: contact.displayName || null,
              avatarIcon: contact.avatarIcon || null,
              customName: contact.customName || null,
              isSaved: contact.isSaved ?? false,
              isVerified: contact.isVerified ?? false,
              unreadCount: contact.unreadCount || 0,
              lastMessage: (contact.messages && contact.messages.length > 0)
                ? contact.messages[contact.messages.length - 1]
                : (contact.lastMessage || null),
              messages: (contact.messages || []).slice(-50)
            });
          }
        }
        localStorage.setItem(`contacts_${currentUser.username}`, JSON.stringify(uniqueContacts));
      } catch (err) {
        console.warn('LocalStorage quota exceeded while persisting chat history:', err.message);
      }
    }
  }, [contacts, currentUser]);

  const updateContactProfileAndStatus = useCallback((username, status, displayName = undefined, avatarIcon = undefined) => {
    setContacts(prev => prev.map(c => {
      if (c.username.toLowerCase() === username.toLowerCase()) {
        const changes = {};
        if (status !== undefined && c.status !== status) changes.status = status;
        if (displayName !== undefined && c.displayName !== displayName) changes.displayName = displayName;
        if (avatarIcon !== undefined && c.avatarIcon !== avatarIcon) changes.avatarIcon = avatarIcon;
        if (Object.keys(changes).length === 0) return c;
        return { ...c, ...changes };
      }
      return c;
    }));

    if (activeContactRef.current?.username.toLowerCase() === username.toLowerCase()) {
      setActiveContact(prev => {
        if (!prev) return prev;
        const changes = {};
        if (status !== undefined && prev.status !== status) changes.status = status;
        if (displayName !== undefined && prev.displayName !== displayName) changes.displayName = displayName;
        if (avatarIcon !== undefined && prev.avatarIcon !== avatarIcon) changes.avatarIcon = avatarIcon;
        if (Object.keys(changes).length === 0) return prev;
        return { ...prev, ...changes };
      });
    }

    if (currentUser?.username?.toLowerCase() === username.toLowerCase() && setCurrentUser) {
      setCurrentUser(prev => {
        if (!prev) return prev;
        const changes = {};
        if (displayName !== undefined && prev.displayName !== displayName) changes.displayName = displayName;
        if (avatarIcon !== undefined && prev.avatarIcon !== avatarIcon) changes.avatarIcon = avatarIcon;
        if (Object.keys(changes).length === 0) return prev;
        return { ...prev, ...changes };
      });
    }
  }, [currentUser?.username, setCurrentUser]);

  const getSharedSecret = useCallback(async (contact) => {
    const usernameKey = contact.username.toLowerCase();
    if (sharedSecrets.current[usernameKey]) {
      return sharedSecrets.current[usernameKey];
    }
    const secret = await deriveSharedSecret(
      currentUser.keys.privateIdentityKey,
      contact.publicIdentityKey
    );
    sharedSecrets.current[usernameKey] = secret;
    return secret;
  }, [currentUser?.keys?.privateIdentityKey]);

  // Pre-derive key in background when contact is selected
  useEffect(() => {
    if (activeContact && currentUser?.keys?.privateIdentityKey && activeContact.publicIdentityKey) {
      getSharedSecret(activeContact).catch(err => console.error('Key pre-derivation error:', err));
    }
  }, [activeContact, currentUser, getSharedSecret]);

  const appendMessageToContact = useCallback((contactName, msg, incrementUnread = false, contactKeys = null) => {
    setContacts(prev => {
      const exists = prev.some(c => c.username.toLowerCase() === contactName.toLowerCase());

      if (exists) {
        return prev.map(c => {
          if (c.username.toLowerCase() === contactName.toLowerCase()) {
            if (msg.id && c.messages.some(m => m.id === msg.id)) return c;
            const isCurrentActive = activeContactRef.current?.username.toLowerCase() === contactName.toLowerCase();
            return {
              ...c,
              unreadCount: incrementUnread && !isCurrentActive ? (c.unreadCount || 0) + 1 : c.unreadCount,
              messages: [...c.messages, msg]
            };
          }
          return c;
        });
      } else {
        if (!contactKeys) return prev;
        return [...prev, {
          username: contactKeys.username,
          publicIdentityKey: contactKeys.publicIdentityKey,
          publicSigningKey: contactKeys.publicSigningKey,
          status: 'offline',
          unreadCount: incrementUnread ? 1 : 0,
          messages: [msg],
          isSaved: false
        }];
      }
    });

    if (activeContactRef.current?.username.toLowerCase() === contactName.toLowerCase()) {
      setActiveContact(prev => {
        if (!prev) return null;
        if (prev.messages.some(m => m.id === msg.id)) return prev;
        return { ...prev, messages: [...prev.messages, msg] };
      });
      if (msg.sender.toLowerCase() !== currentUser?.username?.toLowerCase()) {
        emitMarkAsRead(contactName);
      }
    }

    if (msg.isNew) {
      setTimeout(() => {
        setContacts(prev => prev.map(c => {
          if (c.username.toLowerCase() === contactName.toLowerCase()) {
            return {
              ...c,
              messages: c.messages.map(m => m.id === msg.id ? { ...m, isNew: false } : m)
            };
          }
          return c;
        }));
        if (activeContactRef.current?.username.toLowerCase() === contactName.toLowerCase()) {
          setActiveContact(prev => {
            if (!prev) return null;
            if (!prev.messages.some(m => m.id === msg.id && m.isNew)) return prev;
            return {
              ...prev,
              messages: prev.messages.map(m => m.id === msg.id ? { ...m, isNew: false } : m)
            };
          });
        }
      }, 1000);
    }
  }, [currentUser?.username]);

  const processAndAppendMessage = useCallback(async (msg, isHistorical = false) => {
    if (!currentUser) return;
    const isSentByMe = msg.sender.toLowerCase() === currentUser.username.toLowerCase();
    const chatPartner = isSentByMe ? msg.recipient : msg.sender;

    let contact = contactsRef.current.find(c => c.username.toLowerCase() === chatPartner.toLowerCase());
    let contactKeys = null;

    if (!contact) {
      try {
        const publicKeys = await searchUser(chatPartner, currentUser.token);
        const found = publicKeys?.user || publicKeys;
        contactKeys = found;
        contact = {
          username: found.username,
          publicIdentityKey: found.publicIdentityKey,
          publicSigningKey: found.publicSigningKey
        };

        const socket = getSocket();
        if (socket && socket.connected) {
          emitGetUserStatus(found.username)
            .then(res => {
              if (res) {
                updateContactProfileAndStatus(found.username, res.status, res.displayName, res.avatarIcon);
              }
            })
            .catch(e => console.error('Failed to fetch status for dynamic contact:', e));
        }
      } catch (err) {
        console.error('Could not fetch public keys for unknown sender:', chatPartner, err);
        return;
      }
    }

    try {
      const secret = await getSharedSecret(contact);
      let isAuthenticated = false;

      if (msg.authTag) {
        const authKey = await deriveAuthKey(secret);
        if (authKey) {
          isAuthenticated = await verifyMessageAuthTag(authKey, msg.ciphertext, msg.iv, msg.aad, msg.authTag);
        }
      }

      if (!isAuthenticated && msg.signature) {
        const senderPubKey = msg.sender.toLowerCase() === currentUser.username.toLowerCase()
          ? currentUser.keys.publicSigningKey
          : contact.publicSigningKey;

        if (senderPubKey) {
          isAuthenticated = await verifyDataSignature(
            msg.ciphertext,
            msg.signature,
            senderPubKey
          );
        }
      }

      if (!isAuthenticated) {
        console.error('WARNING: E2EE Cryptographic Integrity Verification FAILED! Message dropped.');
        appendMessageToContact(chatPartner, {
          id: msg.id,
          sender: msg.sender,
          recipient: msg.recipient,
          timestamp: msg.timestamp,
          text: '⚠️ ERROR: Message failed cryptographic integrity verification.',
          mediaType: 'text',
          status: msg.delivered
        }, false, contactKeys);
        return;
      }

      const decryptedString = await decryptMessage(msg.ciphertext, secret, msg.iv, msg.aad);
      const decryptedPayload = JSON.parse(decryptedString);

      const decryptedMsg = {
        id: msg.id,
        sender: msg.sender,
        recipient: msg.recipient,
        timestamp: msg.timestamp,
        text: decryptedPayload.text || '',
        mediaType: decryptedPayload.type !== 'text' ? decryptedPayload.type : null,
        fileMetadata: decryptedPayload.fileMetadata || null,
        status: msg.delivered,
        replyTo: decryptedPayload.replyTo || null,
        forwarded: decryptedPayload.forwarded || null,
        isNew: !isHistorical
      };

      appendMessageToContact(chatPartner, decryptedMsg, !isSentByMe && !isHistorical, contactKeys);
    } catch (err) {
      console.error('Decryption failed for message ID:', msg.id, err);
      appendMessageToContact(chatPartner, {
        id: msg.id,
        sender: msg.sender,
        recipient: msg.recipient,
        timestamp: msg.timestamp,
        text: '❌ Decryption Failed: Secure keys mismatch.',
        mediaType: 'text',
        status: msg.delivered
      }, false, contactKeys);
    }
  }, [appendMessageToContact, currentUser, getSharedSecret, updateContactProfileAndStatus]);

  const decryptMessagesBatch = useCallback(async (encryptedMsgs, contact) => {
    const decryptedMsgs = [];
    const secret = await getSharedSecret(contact);

    for (const msg of encryptedMsgs) {
      let normTimestamp = msg.timestamp || new Date().toISOString();
      if (typeof normTimestamp === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(normTimestamp)) {
        normTimestamp = normTimestamp.replace(' ', 'T') + 'Z';
      }

      try {
        let isAuthenticated = false;

        if (msg.authTag) {
          const authKey = await deriveAuthKey(secret);
          if (authKey) {
            isAuthenticated = await verifyMessageAuthTag(authKey, msg.ciphertext, msg.iv, msg.aad, msg.authTag);
          }
        }

        if (!isAuthenticated && msg.signature) {
          const senderPubKey = msg.sender.toLowerCase() === currentUser?.username?.toLowerCase()
            ? currentUser.keys.publicSigningKey
            : contact.publicSigningKey;

          if (senderPubKey) {
            isAuthenticated = await verifyDataSignature(
              msg.ciphertext,
              msg.signature,
              senderPubKey
            );
          }
        }

        if (!isAuthenticated) {
          decryptedMsgs.push({
            id: msg.id,
            sender: msg.sender,
            recipient: msg.recipient,
            timestamp: normTimestamp,
            text: '⚠️ ERROR: Message failed cryptographic integrity verification.',
            mediaType: 'text',
            status: msg.delivered
          });
          continue;
        }

        const decryptedString = await decryptMessage(msg.ciphertext, secret, msg.iv, msg.aad);
        const decryptedPayload = JSON.parse(decryptedString);

        decryptedMsgs.push({
          id: msg.id,
          sender: msg.sender,
          recipient: msg.recipient,
          timestamp: normTimestamp,
          text: decryptedPayload.text || '',
          mediaType: decryptedPayload.type !== 'text' ? decryptedPayload.type : null,
          fileMetadata: decryptedPayload.fileMetadata || null,
          status: msg.delivered,
          replyTo: decryptedPayload.replyTo || null
        });
      } catch (err) {
        console.error('Decryption failed for message ID:', msg.id, err);
        decryptedMsgs.push({
          id: msg.id,
          sender: msg.sender,
          recipient: msg.recipient,
          timestamp: normTimestamp,
          text: '❌ Decryption Failed: Secure keys mismatch.',
          mediaType: 'text',
          status: msg.delivered
        });
      }
    }
    decryptedMsgs.sort((a, b) => (new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) || ((a.id || 0) - (b.id || 0)));
    return decryptedMsgs;
  }, [currentUser, getSharedSecret]);

  // Background fetch message history for contacts that have no cached messages on boot
  useEffect(() => {
    if (currentUser && isContactsLoadedRef.current) {
      contacts.forEach(async (contact) => {
        if (!contact.messages || contact.messages.length === 0) {
          try {
            const encryptedHistory = await emitGetChatHistory(contact.username);
            if (encryptedHistory && encryptedHistory.length > 0) {
              const decryptedMessages = await decryptMessagesBatch(encryptedHistory, contact);
              const lastMsg = decryptedMessages.length > 0 ? decryptedMessages[decryptedMessages.length - 1] : null;
              const unreadFromMsgs = decryptedMessages.filter(m => 
                m.sender.toLowerCase() === contact.username.toLowerCase() && m.status < 2
              ).length;
              setContacts(prev => prev.map(c => {
                if (c.username.toLowerCase() === contact.username.toLowerCase()) {
                  const existingMsgs = c.messages || [];
                  const byKey = new Map();
                  for (const m of existingMsgs) {
                    const key = String(m.id || m.timestamp || (m.mediaType + '_' + m.timestamp));
                    byKey.set(key, m);
                  }
                  for (const m of decryptedMessages) {
                    const key = String(m.id || m.timestamp || (m.mediaType + '_' + m.timestamp));
                    byKey.set(key, m);
                  }
                  const merged = Array.from(byKey.values());
                  merged.sort((a, b) => (new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) || ((a.id || 0) - (b.id || 0)));
                  const lastMsg = merged.length > 0 ? merged[merged.length - 1] : (c.lastMessage || null);

                  return {
                    ...c,
                    messages: merged,
                    lastMessage: lastMsg,
                    unreadCount: Math.max(c.unreadCount || 0, unreadFromMsgs)
                  };
                }
                return c;
              }));
              if (activeContactRef.current?.username.toLowerCase() === contact.username.toLowerCase()) {
                setActiveContact(prev => {
                  if (prev && prev.username.toLowerCase() === contact.username.toLowerCase()) {
                    const existingMsgs = prev.messages || [];
                    const byKey = new Map();
                    for (const m of existingMsgs) {
                      const key = String(m.id || m.timestamp || (m.mediaType + '_' + m.timestamp));
                      byKey.set(key, m);
                    }
                    for (const m of decryptedMessages) {
                      const key = String(m.id || m.timestamp || (m.mediaType + '_' + m.timestamp));
                      byKey.set(key, m);
                    }
                    const merged = Array.from(byKey.values());
                    merged.sort((a, b) => (new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) || ((a.id || 0) - (b.id || 0)));
                    const lastMsg = merged.length > 0 ? merged[merged.length - 1] : (prev.lastMessage || null);

                    return { ...prev, messages: merged, lastMessage: lastMsg };
                  }
                  return prev;
                });
              }
            }
          } catch (e) {}
        }
      });
    }
  }, [contacts, currentUser, decryptMessagesBatch]);

  const handleSelectContact = useCallback(async (contact) => {
    if (window.history.state !== 'chat') {
      window.history.pushState('chat', '');
    }
    if (onClearActiveGroup) {
      onClearActiveGroup();
    }

    const cachedContact = contactsRef.current.find(c => c.username.toLowerCase() === contact.username.toLowerCase());
    const targetContact = cachedContact || contact;
    lastActiveContactRef.current = targetContact;
    setActiveContact(targetContact);

    try {
      const encryptedHistory = await emitGetChatHistory(contact.username);
      const decryptedMessages = await decryptMessagesBatch(encryptedHistory, contact);

      const readMessages = decryptedMessages.map(m => 
        m.sender.toLowerCase() === contact.username.toLowerCase()
          ? { ...m, status: 2 }
          : m
      );

      warmupMediaCache(readMessages);

      setContacts(prev => prev.map(c => {
        if (c.username.toLowerCase() === contact.username.toLowerCase()) {
          return {
            ...c,
            unreadCount: 0,
            messages: readMessages
          };
        }
        return c;
      }));

      setActiveContact(prev => {
        if (prev && prev.username.toLowerCase() === contact.username.toLowerCase()) {
          return {
            ...prev,
            messages: readMessages
          };
        }
        return prev;
      });

      emitMarkAsRead(contact.username);
    } catch (err) {
      console.error('Failed to fetch chat history from DB:', err);
    }
  }, [decryptMessagesBatch, onClearActiveGroup]);

  const handleSendMessage = useCallback(async (msgContent) => {
    if (!activeContact || !currentUser) return;
    const recipient = activeContact.username;

    if (blockedUsersRef.current.includes(recipient.toLowerCase())) {
      showToast?.(`You have blocked @${recipient}. Unblock them to send messages.`, 'warning', 'Contact Blocked');
      return;
    }

    try {
      const sharedSecret = await getSharedSecret(activeContact);
      const clientMsgId = window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const timestamp = Date.now();
      const seq = getNextRatchetSeq(recipient);
      const aadContext = {
        s: currentUser.username,
        r: recipient,
        mid: clientMsgId,
        t: timestamp,
        seq
      };

      const ephemeralKey = await deriveRatchetedMessageKey(
        sharedSecret,
        seq,
        currentUser.username,
        recipient
      );

      const payloadString = JSON.stringify(msgContent);
      const { ciphertext, iv, aad } = await encryptMessage(payloadString, ephemeralKey, aadContext);
      const authKey = await deriveAuthKey(sharedSecret);
      const authTag = await generateMessageAuthTag(authKey, ciphertext, iv, aad);
      const signature = await signData(ciphertext, currentUser.keys.privateSigningKey);

      const ack = await emitSendMessage(recipient, ciphertext, iv, signature, aad, authTag);

      const localMsg = {
        id: ack.messageId,
        sender: currentUser.username,
        recipient,
        timestamp: ack.timestamp,
        text: msgContent.text || '',
        mediaType: msgContent.type !== 'text' ? msgContent.type : null,
        fileMetadata: msgContent.fileMetadata || null,
        status: ack.status,
        replyTo: msgContent.replyTo || null,
        isNew: true
      };

      appendMessageToContact(recipient, localMsg);
    } catch (err) {
      console.error('E2EE encryption/sending failed:', err);
      showToast?.(`Failed to send message: ${err.message || 'Unknown error'}`, 'error');
    }
  }, [activeContact, appendMessageToContact, currentUser, getNextRatchetSeq, getSharedSecret, showToast]);

  const handleForwardRequest = useCallback((message) => {
    if (!message) return;
    setForwardingMessage(message);
  }, []);

  const handleConfirmForward = useCallback(async (target) => {
    const message = forwardingMessage;
    if (!message || !currentUser || !target) return;

    if (target.type === 'group') {
      const groupId = Number(target.id);
      const group = groupsRef?.current?.find(g => g.id === groupId);
      if (!group) {
        showToast?.('Group not found.', 'error', 'Forward Failed');
        return;
      }
      try {
        const groupKey = await fetchGroupKey(groupId, group.kv);
        const hasMedia = Boolean(message.fileMetadata && message.mediaType && message.mediaType !== 'call');
        const msgContent = {
          type: hasMedia ? 'file' : 'text',
          text: message.text || '',
          forwarded: true
        };
        if (hasMedia) {
          msgContent.fileMetadata = message.fileMetadata;
        }

        const { ciphertext, iv } = await encryptGroupPayload(msgContent, groupKey);
        const signature = await signData(ciphertext, currentUser.keys.privateSigningKey);
        await emitSendGroupMessage(groupId, ciphertext, iv, signature);

        showToast?.(`Message forwarded to "${group.name}".`, 'success');
      } catch (err) {
        console.error('Group forwarding failed:', err);
        showToast?.(`Failed to forward message: ${err.message || 'Unknown error'}`, 'error');
      }
      return;
    }

    const targetUsername = typeof target === 'string' ? target : target.id;
    const contact = contactsRef.current.find(c => c.username.toLowerCase() === String(targetUsername).toLowerCase());
    if (!contact) {
      showToast?.('Contact not found.', 'error', 'Forward Failed');
      return;
    }

    if (blockedUsersRef.current.includes(contact.username.toLowerCase())) {
      showToast?.(`You have blocked @${contact.username}. Unblock them to forward messages.`, 'warning', 'Contact Blocked');
      return;
    }

    try {
      const hasMedia = Boolean(message.fileMetadata && message.mediaType && message.mediaType !== 'call');
      const msgContent = {
        type: hasMedia ? 'file' : 'text',
        text: message.text || '',
        forwarded: true
      };
      if (hasMedia) {
        msgContent.fileMetadata = message.fileMetadata;
      }

      const sharedSecret = await getSharedSecret(contact);
      const payloadString = JSON.stringify(msgContent);
      const { ciphertext, iv } = await encryptMessage(payloadString, sharedSecret);
      const signature = await signData(ciphertext, currentUser.keys.privateSigningKey);
      const ack = await emitSendMessage(contact.username, ciphertext, iv, signature);

      const localMsg = {
        id: ack.messageId,
        sender: currentUser.username,
        recipient: contact.username,
        timestamp: ack.timestamp,
        text: msgContent.text,
        mediaType: hasMedia ? 'file' : null,
        fileMetadata: hasMedia ? message.fileMetadata : null,
        status: ack.status,
        replyTo: null,
        forwarded: true,
        isNew: true
      };

      appendMessageToContact(contact.username, localMsg);
      showToast?.(`Message forwarded to @${contact.username}`, 'success');
    } catch (err) {
      console.error('E2EE forwarding failed:', err);
      showToast?.(`Failed to forward message: ${err.message || 'Unknown error'}`, 'error');
    }
  }, [
    appendMessageToContact,
    currentUser,
    emitSendGroupMessage,
    encryptGroupPayload,
    fetchGroupKey,
    forwardingMessage,
    getSharedSecret,
    groupsRef,
    showToast
  ]);

  const sendCallLogMessage = useCallback(async (partnerName, mediaType, status, duration) => {
    if (!currentUser) return;
    const contact = contactsRef.current.find(c => c.username.toLowerCase() === partnerName.toLowerCase());
    if (!contact) return;

    try {
      const sharedSecret = await getSharedSecret(contact);
      const msgContent = {
        text: JSON.stringify({
          callType: mediaType,
          status: status,
          duration: duration
        }),
        type: 'call'
      };

      const payloadString = JSON.stringify(msgContent);
      const { ciphertext, iv } = await encryptMessage(payloadString, sharedSecret);
      const signature = await signData(ciphertext, currentUser.keys.privateSigningKey);
      const ack = await emitSendMessage(contact.username, ciphertext, iv, signature);

      const localMsg = {
        id: ack.messageId,
        sender: currentUser.username,
        recipient: contact.username,
        timestamp: ack.timestamp,
        text: msgContent.text,
        mediaType: 'call',
        fileMetadata: null,
        status: ack.status,
        replyTo: null,
        isNew: true
      };

      appendMessageToContact(contact.username, localMsg);
    } catch (err) {
      console.error('Failed to send E2EE call log message:', err);
    }
  }, [appendMessageToContact, currentUser, getSharedSecret]);

  const deleteMessagesLocal = useCallback((messageIds, activeGroup) => {
    if (!messageIds || messageIds.length === 0) return;
    const ids = new Set(messageIds.map(id => String(id)));

    if (activeGroup?.id != null) {
      const activeGid = activeGroup.id;
      const phase = (mutator) => {
        if (patchGroup) patchGroup(activeGid, (g) => ({ ...g, messages: mutator(g.messages) }));
      };

      phase((msgs) => msgs.map(m => ids.has(String(m.id)) ? { ...m, isDeleting: true, isCollapsing: false } : m));
      if (emitDeleteGroupMessages) {
        emitDeleteGroupMessages(activeGid, messageIds).catch(err => console.warn('Failed to delete group messages remotely:', err));
      }

      window.setTimeout(() => phase((msgs) => msgs.map(m => ids.has(String(m.id)) ? { ...m, isCollapsing: true } : m)), 500);
      window.setTimeout(() => phase((msgs) => msgs.filter(m => !ids.has(String(m.id)))), 1150);
      return;
    }

    setContacts(prev => prev.map(c => ({
      ...c,
      messages: c.messages.map(m => ids.has(String(m.id)) ? { ...m, isDeleting: true } : m)
    })));
    setActiveContact(prev => prev ? {
      ...prev,
      messages: prev.messages.map(m => ids.has(String(m.id)) ? { ...m, isDeleting: true, isCollapsing: false } : m)
    } : prev);

    emitDeleteMessages(messageIds).catch(err => console.warn('Failed to delete messages remotely:', err));

    window.setTimeout(() => {
      setContacts(prev => prev.map(c => ({
        ...c,
        messages: c.messages.map(m => ids.has(String(m.id)) ? { ...m, isCollapsing: true } : m)
      })));
      setActiveContact(prev => prev ? {
        ...prev,
        messages: prev.messages.map(m => ids.has(String(m.id)) ? { ...m, isCollapsing: true } : m)
      } : prev);
    }, 500);

    window.setTimeout(() => {
      setContacts(prev => prev.map(c => ({ ...c, messages: c.messages.filter(m => !ids.has(String(m.id))) })));
      setActiveContact(prev => prev ? { ...prev, messages: prev.messages.filter(m => !ids.has(String(m.id))) } : prev);
    }, 1150);
  }, [emitDeleteGroupMessages, patchGroup]);

  const markAllMessagesAsReadLocal = useCallback((contactUsername) => {
    if (!contactUsername) return;
    const lowerUser = contactUsername.toLowerCase();
    setContacts(prev => prev.map(c => {
      if (c.username.toLowerCase() === lowerUser) {
        return {
          ...c,
          unreadCount: 0,
          messages: c.messages.map(m => m.sender.toLowerCase() === lowerUser ? { ...m, status: 2 } : m)
        };
      }
      return c;
    }));
    setActiveContact(prev => {
      if (!prev || prev.username.toLowerCase() !== lowerUser) return prev;
      return {
        ...prev,
        unreadCount: 0,
        messages: prev.messages.map(m => m.sender.toLowerCase() === lowerUser ? { ...m, status: 2 } : m)
      };
    });
    emitMarkAsRead(contactUsername);
  }, []);

  const handleAddContact = useCallback(async (contact) => {
    const existing = contactsRef.current.find(c => c.username.toLowerCase() === contact.username.toLowerCase());
    if (existing) {
      setContacts(prev => prev.map(c => c.username.toLowerCase() === contact.username.toLowerCase() ? { ...c, isSaved: true } : c));
      setActiveContact({ ...existing, isSaved: true });
    } else {
      const savedContact = { ...contact, isSaved: true, messages: [] };
      setContacts(prev => [...prev, savedContact]);
      setActiveContact(savedContact);
    }

    const socket = getSocket();
    if (socket && socket.connected) {
      try {
        const res = await emitGetUserStatus(contact.username);
        updateContactProfileAndStatus(contact.username, res.status, res.displayName, res.avatarIcon);
      } catch (e) {
        console.error(e);
      }
    }
  }, [updateContactProfileAndStatus]);

  const handleSaveContact = useCallback((username) => {
    setContacts(prev => prev.map(c => 
      c.username.toLowerCase() === username.toLowerCase() ? { ...c, isSaved: true } : c
    ));
    if (activeContactRef.current?.username.toLowerCase() === username.toLowerCase()) {
      setActiveContact(prev => prev ? { ...prev, isSaved: true } : null);
    }
  }, []);

  const handleDeleteChat = useCallback(async (username, onBack) => {
    if (!username) return;
    const lower = username.toLowerCase();
    delete sharedSecrets.current[lower];
    setContacts(prev => prev.filter(c => c.username.toLowerCase() !== lower));
    if (activeContactRef.current?.username.toLowerCase() === lower && onBack) {
      onBack();
    }
    try {
      await emitDeleteChat(username);
    } catch (err) {
      console.warn('Failed to delete chat remotely:', err);
    }
  }, []);

  const handleBlockContact = useCallback(async (username, onBack) => {
    if (!username) return;
    const lower = username.toLowerCase();
    delete sharedSecrets.current[lower];
    setBlockedUsers(prev => prev.includes(lower) ? prev : [...prev, lower]);
    setContacts(prev => {
      const filtered = prev.filter(c => c.username.toLowerCase() !== lower);
      const curUser = localStorage.getItem('zap_username') || localStorage.getItem('chatra_username');
      if (curUser) {
        localStorage.setItem(`contacts_${curUser}`, JSON.stringify(filtered));
      }
      return filtered;
    });
    if (activeContactRef.current?.username.toLowerCase() === lower && onBack) {
      onBack();
    }
    try {
      await emitBlockUser(username);
      await emitDeleteChat(username);
    } catch (err) {
      console.warn('Failed to block contact remotely:', err);
    }
  }, []);

  const handleUnblockContact = useCallback(async (username) => {
    if (!username) return;
    const lower = username.toLowerCase();
    setBlockedUsers(prev => prev.filter(u => u !== lower));
    try {
      await emitUnblockUser(username);
    } catch (err) {
      console.warn('Failed to unblock contact remotely:', err);
      showToast?.(`Failed to unblock @${username}: ${err.message || 'Error'}`, 'error');
    }
  }, [showToast]);

  const handleRenameContact = useCallback((username, newCustomName) => {
    if (!username) return;
    const lower = username.toLowerCase();
    const cleanName = newCustomName && newCustomName.trim() ? newCustomName.trim() : null;

    setContacts(prev => {
      const updated = prev.map(c => {
        if (c.username.toLowerCase() === lower) {
          return { ...c, customName: cleanName };
        }
        return c;
      });
      const curUser = localStorage.getItem('zap_username') || localStorage.getItem('chatra_username');
      if (curUser) {
        localStorage.setItem(`contacts_${curUser}`, JSON.stringify(updated));
      }
      return updated;
    });

    if (activeContactRef.current?.username.toLowerCase() === lower) {
      setActiveContact(prev => prev ? { ...prev, customName: cleanName } : null);
    }
  }, []);

  const handleVerifyContact = useCallback((username, isVerified) => {
    setContacts(prev => prev.map(c => 
      c.username.toLowerCase() === username.toLowerCase() ? { ...c, isVerified } : c
    ));
    if (activeContactRef.current?.username.toLowerCase() === username.toLowerCase()) {
      setActiveContact(prev => prev ? { ...prev, isVerified } : null);
    }
  }, []);

  const handleCloseSafetyModal = useCallback((isFromPop = false) => {
    setIsSafetyModalClosing(true);
    if (!isFromPop && window.history.state === 'safety') {
      window.__isProgrammaticPop = true;
      window.history.back();
      setTimeout(() => {
        window.__isProgrammaticPop = false;
      }, 100);
    }
    setTimeout(() => {
      setShowSafetyModal(false);
      setIsSafetyModalClosing(false);
    }, 220);
  }, []);

  // Keyboard shortcut: Escape closes safety modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && showSafetyModal && !isSafetyModalClosing) {
        handleCloseSafetyModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCloseSafetyModal, isSafetyModalClosing, showSafetyModal]);

  // Socket listener registrations for 1-on-1 chats
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !currentUser) return;

    const handleIncomingMessage = async (msg) => {
      const isSentByMe = msg.sender.toLowerCase() === currentUser.username.toLowerCase();
      const isBlocked = blockedUsersRef.current.includes(msg.sender.toLowerCase());
      if (isBlocked && !isSentByMe) return;

      await processAndAppendMessage(msg);

      if (!isSentByMe && activeContactRef.current?.username.toLowerCase() !== msg.sender.toLowerCase()) {
        soundEngine.playMessageReceived();
      }
    };

    const handleStatusChange = ({ username, status, displayName, avatarIcon }) => {
      updateContactProfileAndStatus(username, status, displayName, avatarIcon);
    };

    const handleProfileUpdate = ({ username, displayName, avatarIcon }) => {
      updateContactProfileAndStatus(username, undefined, displayName, avatarIcon);
    };

    const handleUserTyping = ({ username, isTyping }) => {
      setContacts(prev => prev.map(c => {
        if (c.username.toLowerCase() === username.toLowerCase()) {
          return { ...c, isTyping };
        }
        return c;
      }));
      if (activeContactRef.current?.username.toLowerCase() === username.toLowerCase()) {
        setActiveContact(prev => prev ? { ...prev, isTyping } : null);
      }
    };

    const handleMessagesDelivered = ({ recipient }) => {
      setContacts(prev => prev.map(c => {
        if (c.username.toLowerCase() === recipient.toLowerCase()) {
          return {
            ...c,
            messages: c.messages.map(m => m.status === 0 ? { ...m, status: 1 } : m)
          };
        }
        return c;
      }));
      if (activeContactRef.current?.username.toLowerCase() === recipient.toLowerCase()) {
        setActiveContact(prev => {
          if (!prev) return null;
          return {
            ...prev,
            messages: prev.messages.map(m => m.status === 0 ? { ...m, status: 1 } : m)
          };
        });
      }
    };

    const handleMessagesRead = ({ reader }) => {
      setContacts(prev => prev.map(c => {
        if (c.username.toLowerCase() === reader.toLowerCase()) {
          return {
            ...c,
            messages: c.messages.map(m => m.status < 2 ? { ...m, status: 2 } : m)
          };
        }
        return c;
      }));
      if (activeContactRef.current?.username.toLowerCase() === reader.toLowerCase()) {
        setActiveContact(prev => {
          if (!prev) return null;
          return {
            ...prev,
            messages: prev.messages.map(m => m.status < 2 ? { ...m, status: 2 } : m)
          };
        });
      }
    };

    const handleMessagesDeleted = ({ messageIds = [] }) => {
      const ids = new Set(messageIds.map(id => String(id)));
      const phase = (mutator) => {
        setContacts(prev => prev.map(c => ({ ...c, messages: mutator(c.messages) })));
        setActiveContact(prev => prev ? { ...prev, messages: mutator(prev.messages) } : prev);
      };

      phase((msgs) => msgs.map(m => ids.has(String(m.id)) ? { ...m, isDeleting: true, isCollapsing: false } : m));
      window.setTimeout(() => phase((msgs) => msgs.map(m => ids.has(String(m.id)) ? { ...m, isCollapsing: true } : m)), 500);
      window.setTimeout(() => phase((msgs) => msgs.filter(m => !ids.has(String(m.id)))), 1150);
    };

    subscribeToMessages(handleIncomingMessage);
    subscribeToUserStatus(handleStatusChange);
    subscribeToProfileUpdates(handleProfileUpdate);

    socket.on('user-typing', handleUserTyping);
    socket.on('messages-delivered', handleMessagesDelivered);
    socket.on('messages-read', handleMessagesRead);
    socket.on('messages-deleted', handleMessagesDeleted);

    return () => {
      unsubscribeFromMessages(handleIncomingMessage);
      unsubscribeFromUserStatus(handleStatusChange);
      unsubscribeFromProfileUpdates(handleProfileUpdate);
      socket.off('user-typing', handleUserTyping);
      socket.off('messages-delivered', handleMessagesDelivered);
      socket.off('messages-read', handleMessagesRead);
      socket.off('messages-deleted', handleMessagesDeleted);
    };
  }, [currentUser, processAndAppendMessage, updateContactProfileAndStatus]);

  return {
    contacts,
    setContacts,
    contactsRef,
    activeContact,
    setActiveContact,
    activeContactRef,
    lastActiveContactRef,
    previousActiveContactRef,
    blockedUsers,
    setBlockedUsers,
    blockedUsersRef,
    sharedSecrets,
    replyingTo,
    setReplyingTo,
    replyingToRef,
    forwardingMessage,
    setForwardingMessage,
    forwardingMessageRef,
    safetyNumberDisplay,
    showSafetyModal,
    setShowSafetyModal,
    isSafetyModalClosing,
    handleCloseSafetyModal,
    handleVerifyContact,
    lightboxImageSrc,
    setLightboxImageSrc,
    activeLightboxSrc,
    handleSelectContact,
    handleSendMessage,
    handleForwardRequest,
    handleConfirmForward,
    sendCallLogMessage,
    deleteMessagesLocal,
    markAllMessagesAsReadLocal,
    handleAddContact,
    handleSaveContact,
    handleDeleteChat,
    handleBlockContact,
    handleUnblockContact,
    handleRenameContact,
    getSharedSecret,
    appendMessageToContact,
    updateContactProfileAndStatus
  };
}

export default useChatManager;
