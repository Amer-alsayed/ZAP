import { dbRun, dbGet, dbAll } from './db.js';
import logger from './logger.js';

const MAX_GROUP_MEMBERS = 256;
const MAX_GROUP_CALLERS = 8;
const MAX_NAME_CIPHERTEXT = 4096;

// Live group call sessions shared across all sockets in this process
const activeGroupCalls = new Map();

// Safety sweep: drop orphaned call sessions (e.g. after server-side races)
setInterval(() => {
  for (const [gid, session] of activeGroupCalls.entries()) {
    if (session.participants.size === 0) {
      activeGroupCalls.delete(gid);
    }
  }
}, 30 * 1000).unref();
const MAX_AVATAR_CIPHERTEXT = 300000;
const MAX_ENVELOPE_CIPHERTEXT = 4096;
const MAX_MESSAGE_CIPHERTEXT = 500000;

const isValidUsername = (u) => typeof u === 'string' && /^[a-zA-Z0-9_]{3,20}$/.test(u);
const isValidBase64Pair = (obj, maxCt) =>
  obj &&
  typeof obj.ciphertext === 'string' && obj.ciphertext.length > 0 && obj.ciphertext.length <= maxCt &&
  typeof obj.iv === 'string' && obj.iv.length > 0 && obj.iv.length <= 100;

const normalizeEnvelopeMap = (raw) => {
  const map = {};
  if (!raw || typeof raw !== 'object') return null;
  for (const [key, val] of Object.entries(raw)) {
    if (!isValidUsername(key) || !isValidBase64Pair(val, MAX_ENVELOPE_CIPHERTEXT)) return null;
    map[key.toLowerCase()] = { ciphertext: val.ciphertext, iv: val.iv };
  }
  return map;
};

const formatTs = (ts) => {
  if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(ts)) {
    return ts.replace(' ', 'T') + 'Z';
  }
  return ts;
};

const getGroupMeta = async (groupId) => dbGet('SELECT * FROM groups WHERE id = ?', [groupId]);
const getMembership = async (groupId, username) => dbGet(
  'SELECT * FROM group_members WHERE group_id = ? AND LOWER(username) = LOWER(?)',
  [groupId, username]
);
const getRoster = async (groupId) => dbAll(
  "SELECT username, role, joined_kv FROM group_members WHERE group_id = ? ORDER BY joined_at ASC, username ASC",
  [groupId]
);

const buildGroupPayload = async (group, viewerUsername) => {
  const membership = await getMembership(group.id, viewerUsername);
  if (!membership) return null;
  const roster = await getRoster(group.id);

  let lastMessage = null;
  const lastRows = await dbAll(
    `SELECT gm.id, gm.group_id, gm.sender, gm.ciphertext, gm.iv, gm.signature, gm.kv, gm.timestamp
     FROM group_messages gm
     LEFT JOIN group_hidden_messages gh ON gm.id = gh.message_id AND LOWER(gh.username) = LOWER(?)
     WHERE gm.group_id = ? AND gm.kv >= ? AND gh.message_id IS NULL
     ORDER BY gm.id DESC LIMIT 1`,
    [viewerUsername, group.id, membership.joined_kv]
  );
  if (lastRows.length > 0) {
    const m = lastRows[0];
    lastMessage = { id: m.id, groupId: m.group_id, sender: m.sender, ciphertext: m.ciphertext, iv: m.iv, signature: m.signature, kv: m.kv, timestamp: formatTs(m.timestamp) };
  }

  const readRow = await dbGet('SELECT last_read_id FROM group_reads WHERE group_id = ? AND LOWER(username) = LOWER(?)', [group.id, viewerUsername]);

  return {
    id: group.id,
    nameCiphertext: group.name_ciphertext,
    nameIv: group.name_iv,
    nameKv: group.name_kv,
    avatarCiphertext: group.avatar_ciphertext || null,
    avatarIv: group.avatar_iv || null,
    avatarKv: group.avatar_kv || null,
    createdBy: group.created_by,
    kv: group.key_version,
    joinedKv: membership.joined_kv,
    myRole: membership.role,
    createdAt: formatTs(group.created_at),
    members: roster.map(r => ({ username: r.username, role: r.role })),
    lastMessage,
    lastReadId: readRow ? readRow.last_read_id : 0
  };
};

const serializeGroupMessage = (m) => ({
  id: m.id,
  groupId: m.group_id,
  sender: m.sender,
  ciphertext: m.ciphertext,
  iv: m.iv,
  signature: m.signature,
  kv: m.kv,
  timestamp: formatTs(m.timestamp)
});

const deleteGroupEverywhere = async (groupId) => {
  await dbRun('DELETE FROM group_key_envelopes WHERE group_id = ?', [groupId]);
  await dbRun('DELETE FROM group_messages WHERE group_id = ?', [groupId]);
  await dbRun('DELETE FROM group_reads WHERE group_id = ?', [groupId]);
  await dbRun('DELETE FROM group_members WHERE group_id = ?', [groupId]);
  await dbRun('DELETE FROM groups WHERE id = ?', [groupId]);
};

export const registerGroupHandlers = (socket, io, helpers) => {
  const { isUserOnline } = helpers;
  const username = socket.user.username;

  // Per-socket sliding window anti-spam limiter for group messages (max 5 per 2 seconds)
  const groupMsgTimestamps = [];
  const MAX_GROUP_MSG_BURST = 5;
  const GROUP_MSG_WINDOW_MS = 2000;

  const exceedsGroupBurstLimit = () => {
    const now = Date.now();
    while (groupMsgTimestamps.length > 0 && now - groupMsgTimestamps[0] > GROUP_MSG_WINDOW_MS) {
      groupMsgTimestamps.shift();
    }
    if (groupMsgTimestamps.length >= MAX_GROUP_MSG_BURST) return true;
    groupMsgTimestamps.push(now);
    return false;
  };

  const notifyRosterChange = async (groupId, type, extra = {}) => {
    try {
      const group = await getGroupMeta(groupId);
      if (!group) return;
      const roster = await getRoster(groupId);
      const rosterUsernames = roster.map(r => r.username);
      const payload = {
        groupId,
        type,
        kv: group.key_version,
        nameCiphertext: group.name_ciphertext,
        nameIv: group.name_iv,
        nameKv: group.name_kv,
        avatarCiphertext: group.avatar_ciphertext || null,
        avatarIv: group.avatar_iv || null,
        avatarKv: group.avatar_kv || null,
        members: roster.map(r => ({ username: r.username, role: r.role })),
        ...extra
      };
      io.to(`group_${groupId}`).emit('group-updated', payload);
      for (const member of rosterUsernames) {
        const full = await buildGroupPayload(await getGroupMeta(groupId), member);
        if (full) {
          io.to(member.toLowerCase()).emit('group-sync', full);
        }
      }
    } catch (err) {
      logger.error('Error notifying roster change:', err);
    }
  };

  // Create a brand new E2EE group (creator becomes owner)
  socket.on('create-group', async (data, callback) => {
    try {
      const {
        nameCiphertext, nameIv, avatarCiphertext, avatarIv,
        members = [], envelopes = {}
      } = data || {};

      if (!nameCiphertext || typeof nameCiphertext !== 'string' || nameCiphertext.length > MAX_NAME_CIPHERTEXT ||
          !nameIv || typeof nameIv !== 'string' || nameIv.length > 100) {
        return callback?.({ error: 'Invalid group name payload' });
      }
      if ((avatarCiphertext && (!avatarIv || typeof avatarIv !== 'string')) || (avatarCiphertext && avatarCiphertext.length > MAX_AVATAR_CIPHERTEXT)) {
        return callback?.({ error: 'Invalid group avatar payload' });
      }
      if (!Array.isArray(members) || members.length === 0 || members.length >= MAX_GROUP_MEMBERS) {
        return callback?.({ error: `Group must contain between 1 and ${MAX_GROUP_MEMBERS - 1} other members` });
      }

      const seen = new Set();
      for (const m of members) {
        if (!isValidUsername(m?.username)) return callback?.({ error: 'Invalid member username format' });
        const lower = m.username.toLowerCase();
        if (lower === username.toLowerCase()) return callback?.({ error: 'You are added to the group automatically' });
        if (seen.has(lower)) return callback?.({ error: 'Duplicate member in list' });
        seen.add(lower);
      }

      const envelopeMap = normalizeEnvelopeMap(envelopes);
      if (!envelopeMap) return callback?.({ error: 'Invalid key envelopes payload' });

      // Verify every member exists before creating anything
      for (const lower of seen) {
        const userExists = await dbGet('SELECT 1 FROM users WHERE LOWER(username) = LOWER(?)', [lower]);
        if (!userExists) return callback?.({ error: `User @${lower} does not exist` });
      }

      // Envelopes must cover the entire initial roster including the creator
      const expectedRoster = new Set([...seen, username.toLowerCase()]);
      for (const expected of expectedRoster) {
        if (!envelopeMap[expected]) {
          return callback?.({ error: 'Key distribution incomplete: missing envelope for a member' });
        }
      }

      const result = await dbRun(
        `INSERT INTO groups (name_ciphertext, name_iv, name_kv, avatar_ciphertext, avatar_iv, avatar_kv, created_by, key_version)
         VALUES (?, ?, 1, ?, ?, ?, ?, 1)`,
        [nameCiphertext, nameIv, avatarCiphertext || null, avatarCiphertext ? avatarIv : null, avatarCiphertext ? 1 : null, username]
      );
      const groupId = result.id;

      const allMembers = [...expectedRoster];
      for (const memberLower of allMembers) {
        const role = memberLower === username.toLowerCase() ? 'owner' : 'member';
        await dbRun(
          'INSERT INTO group_members (group_id, username, role, joined_kv) VALUES (?, ?, ?, 1)',
          [groupId, memberLower, role]
        );
        const env = envelopeMap[memberLower];
        await dbRun(
          `INSERT INTO group_key_envelopes (group_id, kv, username, from_user, ciphertext, iv)
           VALUES (?, 1, ?, ?, ?, ?)`,
          [groupId, memberLower, username, env.ciphertext, env.iv]
        );
      }

      const group = await getGroupMeta(groupId);
      const ownerPayload = await buildGroupPayload(group, username);

      // Join online sockets to the group room and inform everyone.
      // This MUST complete before the ack: the creator's next action (system
      // message, call, etc.) broadcasts into this room immediately after.
      for (const memberLower of allMembers) {
        if (isUserOnline(memberLower)) {
          await io.in(memberLower.toLowerCase()).socketsJoin(`group_${groupId}`);
          if (memberLower !== username.toLowerCase()) {
            const memberPayload = await buildGroupPayload(group, memberLower);
            if (memberPayload) {
              io.to(memberLower.toLowerCase()).emit('group-added', memberPayload);
            }
          }
        }
      }

      callback?.({ success: true, groupId, group: ownerPayload });
      logger.info(`Group ${groupId} created by ${username} with ${allMembers.length} members`);
    } catch (error) {
      logger.error('Error creating group:', error);
      callback?.({ error: 'Failed to create group' });
    }
  });

  // List all groups for the authenticated user
  socket.on('get-groups', async (_, callback) => {
    try {
      const memberships = await dbAll('SELECT group_id FROM group_members WHERE LOWER(username) = LOWER(?)', [username]);
      const groups = [];
      for (const membership of memberships) {
        const group = await getGroupMeta(membership.group_id);
        if (group) {
          const payload = await buildGroupPayload(group, username);
          if (payload) groups.push(payload);
        }
      }
      callback?.({ success: true, groups });
    } catch (error) {
      logger.error('Error fetching groups:', error);
      callback?.({ error: 'Failed to fetch groups' });
    }
  });

  // Fetch paginated group history (only messages from the caller's join point onward)
  socket.on('get-group-messages', async (data, callback) => {
    try {
      const { groupId, limit, beforeId } = data || {};
      const gid = parseInt(groupId, 10);
      if (!Number.isInteger(gid) || gid <= 0) return callback?.({ error: 'Invalid groupId' });

      const membership = await getMembership(gid, username);
      if (!membership) return callback?.({ error: 'not_member' });

      let query = `
        SELECT gm.id, gm.group_id, gm.sender, gm.ciphertext, gm.iv, gm.signature, gm.kv, gm.timestamp
        FROM group_messages gm
        LEFT JOIN group_hidden_messages gh ON gm.id = gh.message_id AND LOWER(gh.username) = LOWER(?)
        WHERE gm.group_id = ? AND gm.kv >= ? AND gh.message_id IS NULL
      `;
      const params = [username, gid, membership.joined_kv];

      const before = parseInt(beforeId, 10);
      if (Number.isInteger(before) && before > 0) {
        query += ' AND id < ?';
        params.push(before);
      }

      query += ' ORDER BY id DESC LIMIT ?';
      const parsedLimit = parseInt(limit, 10);
      const safeLimit = (!isNaN(parsedLimit) && parsedLimit > 0) ? Math.min(parsedLimit, 500) : 300;
      params.push(safeLimit);

      const rows = await dbAll(query, params);
      const messages = rows.reverse().map(serializeGroupMessage);
      callback?.({ success: true, messages, hasMore: rows.length >= safeLimit });
    } catch (error) {
      logger.error('Error fetching group messages:', error);
      callback?.({ error: 'Failed to fetch group messages' });
    }
  });

  // Send an encrypted message to a group (single ciphertext for the whole group)
  socket.on('send-group-message', async (data, callback) => {
    try {
      const { groupId, ciphertext, iv, signature } = data || {};
      const gid = parseInt(groupId, 10);

      if (!Number.isInteger(gid) || gid <= 0 ||
          !ciphertext || typeof ciphertext !== 'string' || ciphertext.length > MAX_MESSAGE_CIPHERTEXT ||
          !iv || typeof iv !== 'string' || iv.length > 100 ||
          !signature || typeof signature !== 'string' || signature.length > 1000) {
        return callback?.({ error: 'Invalid group message payload' });
      }

      const membership = await getMembership(gid, username);
      if (!membership) return callback?.({ error: 'not_member' });

      if (exceedsGroupBurstLimit()) {
        return callback?.({ error: 'You are sending messages too fast. Please slow down.' });
      }

      const group = await getGroupMeta(gid);
      if (!group) return callback?.({ error: 'not_member' });

      const result = await dbRun(
        `INSERT INTO group_messages (group_id, sender, ciphertext, iv, signature, kv)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [gid, username, ciphertext, iv, signature, group.key_version]
      );

      const msgPayload = serializeGroupMessage({
        id: result.id,
        group_id: gid,
        sender: username,
        ciphertext,
        iv,
        signature,
        kv: group.key_version,
        timestamp: new Date().toISOString()
      });

      io.to(`group_${gid}`).emit('receive-group-message', msgPayload);
      callback?.({ success: true, messageId: result.id, kv: group.key_version, timestamp: msgPayload.timestamp });
    } catch (error) {
      logger.error('Error sending group message:', error);
      callback?.({ error: 'Failed to send group message' });
    }
  });

  // Add members (admin/owner). Rotates the group key so newcomers cannot read pre-join history.
  socket.on('add-group-members', async (data, callback) => {
    try {
      const { groupId, members = [], envelopes = {}, nameCiphertext, nameIv, avatarCiphertext, avatarIv } = data || {};
      const gid = parseInt(groupId, 10);
      if (!Number.isInteger(gid) || gid <= 0) return callback?.({ error: 'Invalid groupId' });

      const myMembership = await getMembership(gid, username);
      if (!myMembership) return callback?.({ error: 'not_member' });
      if (myMembership.role !== 'owner' && myMembership.role !== 'admin') {
        return callback?.({ error: 'Only admins can add members' });
      }

      if (!Array.isArray(members) || members.length === 0) return callback?.({ error: 'No members provided' });

      const roster = await getRoster(gid);
      const rosterLower = new Set(roster.map(r => r.username.toLowerCase()));

      const toAdd = [];
      const seenNew = new Set();
      for (const m of members) {
        if (!isValidUsername(m?.username)) return callback?.({ error: 'Invalid member username format' });
        const lower = m.username.toLowerCase();
        if (rosterLower.has(lower) || seenNew.has(lower)) continue;
        if (roster.size + seenNew.size >= MAX_GROUP_MEMBERS) {
          return callback?.({ error: `Group member limit (${MAX_GROUP_MEMBERS}) reached` });
        }
        seenNew.add(lower);
        toAdd.push(lower);
      }
      if (toAdd.length === 0) return callback?.({ error: 'Selected users are already members' });

      const envelopeMap = normalizeEnvelopeMap(envelopes);
      if (!envelopeMap) return callback?.({ error: 'Invalid key envelopes payload' });

      for (const lower of toAdd) {
        const userExists = await dbGet('SELECT 1 FROM users WHERE LOWER(username) = LOWER(?)', [lower]);
        if (!userExists) return callback?.({ error: `User @${lower} does not exist` });
      }

      // Compute the post-addition roster and require full envelope coverage before mutating anything
      const futureRoster = new Set([...rosterLower, ...toAdd]);
      for (const expected of futureRoster) {
        if (!envelopeMap[expected]) {
          return callback?.({ error: 'Key distribution incomplete: re-distribute the new group key to all members' });
        }
      }

      // Atomic-ish rotation: bump version first, then persist everything
      await dbRun('UPDATE groups SET key_version = key_version + 1 WHERE id = ?', [gid]);
      const group = await getGroupMeta(gid);
      const newKv = group.key_version;

      for (const lower of toAdd) {
        await dbRun(
          'INSERT INTO group_members (group_id, username, role, joined_kv) VALUES (?, ?, ?, ?)',
          [gid, lower, 'member', newKv]
        );
      }

      for (const [memberLower, env] of Object.entries(envelopeMap)) {
        if (!futureRoster.has(memberLower)) continue;
        await dbRun(
          `DELETE FROM group_key_envelopes WHERE group_id = ? AND kv = ? AND LOWER(username) = LOWER(?)`,
          [gid, newKv, memberLower]
        );
        await dbRun(
          `INSERT INTO group_key_envelopes (group_id, kv, username, from_user, ciphertext, iv)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [gid, newKv, memberLower, username, env.ciphertext, env.iv]
        );
      }

      // Optional metadata re-encryption under the new key version
      if (nameCiphertext && nameIv && typeof nameCiphertext === 'string' && nameCiphertext.length <= MAX_NAME_CIPHERTEXT && nameIv.length <= 100) {
        await dbRun('UPDATE groups SET name_ciphertext = ?, name_iv = ?, name_kv = ? WHERE id = ?', [nameCiphertext, nameIv, newKv, gid]);
      }
      if (avatarCiphertext && avatarIv && typeof avatarCiphertext === 'string' && avatarCiphertext.length <= MAX_AVATAR_CIPHERTEXT && avatarIv.length <= 100) {
        await dbRun('UPDATE groups SET avatar_ciphertext = ?, avatar_iv = ?, avatar_kv = ? WHERE id = ?', [avatarCiphertext, avatarIv, newKv, gid]);
      }

      // Room joins must complete before the ack — the actor may broadcast
      // (system message, call) into this room immediately after
      for (const lower of toAdd) {
        if (isUserOnline(lower)) {
          await io.in(lower.toLowerCase()).socketsJoin(`group_${gid}`);
        }
      }

      callback?.({ success: true, kv: newKv, added: toAdd });

      // Newly added members need the full group payload to bootstrap locally
      const freshGroup = await getGroupMeta(gid);
      for (const lower of toAdd) {
        if (isUserOnline(lower)) {
          const newcomerPayload = await buildGroupPayload(freshGroup, lower);
          if (newcomerPayload) {
            io.to(lower.toLowerCase()).emit('group-added', newcomerPayload);
          }
        }
      }

      await notifyRosterChange(gid, 'members_added', { addedBy: username, added: toAdd });
      logger.info(`${username} added ${toAdd.join(', ')} to group ${gid}; key rotated to v${newKv}`);
    } catch (error) {
      logger.error('Error adding group members:', error);
      callback?.({ error: 'Failed to add members' });
    }
  });

  // Remove a member (admins remove members, owner removes anyone except themselves)
  socket.on('remove-group-member', async (data, callback) => {
    try {
      const { groupId, targetUsername, envelopes = {}, nameCiphertext, nameIv, avatarCiphertext, avatarIv } = data || {};
      const gid = parseInt(groupId, 10);
      if (!Number.isInteger(gid) || gid <= 0 || !isValidUsername(targetUsername)) {
        return callback?.({ error: 'Invalid removal request' });
      }

      const myMembership = await getMembership(gid, username);
      if (!myMembership) return callback?.({ error: 'not_member' });
      if (myMembership.role !== 'owner' && myMembership.role !== 'admin') {
        return callback?.({ error: 'Only admins can remove members' });
      }

      const targetMembership = await getMembership(gid, targetUsername);
      if (!targetMembership) return callback?.({ error: 'User is not a member of this group' });
      if (targetMembership.role === 'owner') return callback?.({ error: 'The group owner cannot be removed' });
      if (targetMembership.role === 'admin' && myMembership.role !== 'owner') {
        return callback?.({ error: 'Only the owner can remove an admin' });
      }
      if (targetUsername.toLowerCase() === username.toLowerCase()) {
        return callback?.({ error: 'Use Leave Group instead' });
      }

      const roster = await getRoster(gid);
      const remaining = roster.filter(r => r.username.toLowerCase() !== targetUsername.toLowerCase());
      if (remaining.length === 0) return callback?.({ error: 'Cannot remove the last member' });

      const envelopeMap = normalizeEnvelopeMap(envelopes);
      if (!envelopeMap) return callback?.({ error: 'Invalid key envelopes payload' });
      for (const r of remaining) {
        if (!envelopeMap[r.username.toLowerCase()]) {
          return callback?.({ error: 'Key distribution incomplete: re-distribute the new group key to all members' });
        }
      }

      const removedLower = targetUsername.toLowerCase();
      await dbRun('UPDATE groups SET key_version = key_version + 1 WHERE id = ?', [gid]);
      const group = await getGroupMeta(gid);
      const newKv = group.key_version;

      await dbRun('DELETE FROM group_members WHERE group_id = ? AND LOWER(username) = LOWER(?)', [gid, removedLower]);

      for (const [memberLower, env] of Object.entries(envelopeMap)) {
        const stillMember = remaining.some(r => r.username.toLowerCase() === memberLower);
        if (!stillMember) continue;
        await dbRun('DELETE FROM group_key_envelopes WHERE group_id = ? AND kv = ? AND LOWER(username) = LOWER(?)', [gid, newKv, memberLower]);
        await dbRun(
          `INSERT INTO group_key_envelopes (group_id, kv, username, from_user, ciphertext, iv)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [gid, newKv, memberLower, username, env.ciphertext, env.iv]
        );
      }

      if (nameCiphertext && nameIv && typeof nameCiphertext === 'string' && nameCiphertext.length <= MAX_NAME_CIPHERTEXT && nameIv.length <= 100) {
        await dbRun('UPDATE groups SET name_ciphertext = ?, name_iv = ?, name_kv = ? WHERE id = ?', [nameCiphertext, nameIv, newKv, gid]);
      }
      if (avatarCiphertext && avatarIv && typeof avatarCiphertext === 'string' && avatarCiphertext.length <= MAX_AVATAR_CIPHERTEXT && avatarIv.length <= 100) {
        await dbRun('UPDATE groups SET avatar_ciphertext = ?, avatar_iv = ?, avatar_kv = ? WHERE id = ?', [avatarCiphertext, avatarIv, newKv, gid]);
      }

      callback?.({ success: true, kv: newKv, removed: removedLower });
      await notifyRosterChange(gid, 'member_removed', { removedBy: username, removed: removedLower });
      logger.info(`${username} removed ${removedLower} from group ${gid}; key rotated to v${newKv}`);
    } catch (error) {
      logger.error('Error removing group member:', error);
      callback?.({ error: 'Failed to remove member' });
    }
  });

  // Leave a group. Owner leaving transfers ownership deterministically to the earliest joined member.
  socket.on('leave-group', async (data, callback) => {
    try {
      const { groupId, envelopes = {}, nameCiphertext, nameIv, avatarCiphertext, avatarIv } = data || {};
      const gid = parseInt(groupId, 10);
      if (!Number.isInteger(gid) || gid <= 0) return callback?.({ error: 'Invalid groupId' });

      const myMembership = await getMembership(gid, username);
      if (!myMembership) return callback?.({ error: 'not_member' });

      const roster = await getRoster(gid);
      const remaining = roster.filter(r => r.username.toLowerCase() !== username.toLowerCase());

      // Last member leaving deletes the group permanently
      if (remaining.length === 0) {
        await deleteGroupEverywhere(gid);
        callback?.({ success: true, deleted: true });
        io.to(`group_${gid}`).emit('group-deleted', { groupId: gid, deletedBy: username });
        logger.info(`Group ${gid} deleted because the last member (${username}) left`);
        return;
      }

      const envelopeMap = normalizeEnvelopeMap(envelopes);
      if (!envelopeMap) return callback?.({ error: 'Invalid key envelopes payload' });
      for (const r of remaining) {
        if (!envelopeMap[r.username.toLowerCase()]) {
          return callback?.({ error: 'Key distribution incomplete: re-distribute the new group key to all members' });
        }
      }

      const wasOwner = myMembership.role === 'owner';
      const newOwner = wasOwner ? remaining[0].username : null;

      await dbRun('UPDATE groups SET key_version = key_version + 1 WHERE id = ?', [gid]);
      const group = await getGroupMeta(gid);
      const newKv = group.key_version;

      await dbRun('DELETE FROM group_members WHERE group_id = ? AND LOWER(username) = LOWER(?)', [gid, username.toLowerCase()]);
      if (newOwner) {
        await dbRun("UPDATE group_members SET role = 'owner' WHERE group_id = ? AND LOWER(username) = LOWER(?)", [gid, newOwner]);
      }

      for (const [memberLower, env] of Object.entries(envelopeMap)) {
        const stillMember = remaining.some(r => r.username.toLowerCase() === memberLower);
        if (!stillMember) continue;
        await dbRun('DELETE FROM group_key_envelopes WHERE group_id = ? AND kv = ? AND LOWER(username) = LOWER(?)', [gid, newKv, memberLower]);
        await dbRun(
          `INSERT INTO group_key_envelopes (group_id, kv, username, from_user, ciphertext, iv)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [gid, newKv, memberLower, username, env.ciphertext, env.iv]
        );
      }

      if (nameCiphertext && nameIv && typeof nameCiphertext === 'string' && nameCiphertext.length <= MAX_NAME_CIPHERTEXT && nameIv.length <= 100) {
        await dbRun('UPDATE groups SET name_ciphertext = ?, name_iv = ?, name_kv = ? WHERE id = ?', [nameCiphertext, nameIv, newKv, gid]);
      }
      if (avatarCiphertext && avatarIv && typeof avatarCiphertext === 'string' && avatarCiphertext.length <= MAX_AVATAR_CIPHERTEXT && avatarIv.length <= 100) {
        await dbRun('UPDATE groups SET avatar_ciphertext = ?, avatar_iv = ?, avatar_kv = ? WHERE id = ?', [avatarCiphertext, avatarIv, newKv, gid]);
      }

      callback?.({ success: true, kv: newKv, deleted: false, newOwner });
      await notifyRosterChange(gid, 'member_left', { left: username.toLowerCase(), newOwner });
      logger.info(`${username} left group ${gid}${newOwner ? `; ownership transferred to ${newOwner}` : ''}`);
    } catch (error) {
      logger.error('Error leaving group:', error);
      callback?.({ error: 'Failed to leave group' });
    }
  });

  // Delete the entire group (owner only)
  socket.on('delete-group', async (data, callback) => {
    try {
      const { groupId } = data || {};
      const gid = parseInt(groupId, 10);
      if (!Number.isInteger(gid) || gid <= 0) return callback?.({ error: 'Invalid groupId' });

      const myMembership = await getMembership(gid, username);
      if (!myMembership) return callback?.({ error: 'not_member' });
      if (myMembership.role !== 'owner') return callback?.({ error: 'Only the group owner can delete the group' });

      await deleteGroupEverywhere(gid);
      callback?.({ success: true });
      io.to(`group_${gid}`).emit('group-deleted', { groupId: gid, deletedBy: username });
      logger.info(`Group ${gid} deleted by owner ${username}`);
    } catch (error) {
      logger.error('Error deleting group:', error);
      callback?.({ error: 'Failed to delete group' });
    }
  });

  // Rename group / change avatar (admin/owner). Payload arrives encrypted under the current group key.
  socket.on('update-group-info', async (data, callback) => {
    try {
      const { groupId, nameCiphertext, nameIv, avatarCiphertext, avatarIv } = data || {};
      const gid = parseInt(groupId, 10);
      if (!Number.isInteger(gid) || gid <= 0) return callback?.({ error: 'Invalid groupId' });

      const myMembership = await getMembership(gid, username);
      if (!myMembership) return callback?.({ error: 'not_member' });
      if (myMembership.role !== 'owner' && myMembership.role !== 'admin') {
        return callback?.({ error: 'Only admins can update group info' });
      }

      const group = await getGroupMeta(gid);
      if (!group) return callback?.({ error: 'not_member' });

      const hasName = nameCiphertext && nameIv;
      const hasAvatar = avatarCiphertext && avatarIv;
      if (!hasName && !hasAvatar) return callback?.({ error: 'Nothing to update' });

      if (hasName && (typeof nameCiphertext !== 'string' || nameCiphertext.length > MAX_NAME_CIPHERTEXT || typeof nameIv !== 'string' || nameIv.length > 100)) {
        return callback?.({ error: 'Invalid group name payload' });
      }
      if (hasAvatar && (typeof avatarCiphertext !== 'string' || avatarCiphertext.length > MAX_AVATAR_CIPHERTEXT || typeof avatarIv !== 'string' || avatarIv.length > 100)) {
        return callback?.({ error: 'Invalid group avatar payload' });
      }

      if (hasName) {
        await dbRun('UPDATE groups SET name_ciphertext = ?, name_iv = ?, name_kv = ? WHERE id = ?', [nameCiphertext, nameIv, group.key_version, gid]);
      }
      if (hasAvatar) {
        await dbRun('UPDATE groups SET avatar_ciphertext = ?, avatar_iv = ?, avatar_kv = ? WHERE id = ?', [avatarCiphertext, avatarIv, group.key_version, gid]);
      }

      callback?.({ success: true });
      await notifyRosterChange(gid, 'info_updated', { updatedBy: username });
    } catch (error) {
      logger.error('Error updating group info:', error);
      callback?.({ error: 'Failed to update group info' });
    }
  });

  // Promote/demote admins (owner only)
  socket.on('set-member-role', async (data, callback) => {
    try {
      const { groupId, targetUsername, role } = data || {};
      const gid = parseInt(groupId, 10);
      if (!Number.isInteger(gid) || gid <= 0 || !isValidUsername(targetUsername) || !['admin', 'member'].includes(role)) {
        return callback?.({ error: 'Invalid role change request' });
      }

      const myMembership = await getMembership(gid, username);
      if (!myMembership || myMembership.role !== 'owner') {
        return callback?.({ error: 'Only the group owner can manage roles' });
      }

      const targetMembership = await getMembership(gid, targetUsername);
      if (!targetMembership) return callback?.({ error: 'User is not a member of this group' });
      if (targetMembership.role === 'owner') return callback?.({ error: 'The owner role cannot be changed here' });

      await dbRun('UPDATE group_members SET role = ? WHERE group_id = ? AND LOWER(username) = LOWER(?)', [role, gid, targetUsername.toLowerCase()]);

      callback?.({ success: true });
      await notifyRosterChange(gid, 'role_changed', { changedBy: username, target: targetUsername.toLowerCase(), role });
    } catch (error) {
      logger.error('Error changing member role:', error);
      callback?.({ error: 'Failed to change member role' });
    }
  });

  // Fetch one of MY envelopes for a specific key version (on-demand decryption catch-up)
  socket.on('get-group-key', async (data, callback) => {
    try {
      const { groupId, kv } = data || {};
      const gid = parseInt(groupId, 10);
      const version = parseInt(kv, 10);
      if (!Number.isInteger(gid) || gid <= 0 || !Number.isInteger(version) || version <= 0) {
        return callback?.({ error: 'Invalid key request' });
      }

      const membership = await getMembership(gid, username);
      if (!membership) return callback?.({ error: 'not_member' });
      if (version < membership.joined_kv) return callback?.({ error: 'key_out_of_range' });

      const group = await getGroupMeta(gid);
      if (!group || version > group.key_version) return callback?.({ error: 'key_out_of_range' });

      const envelope = await dbGet(
        'SELECT ciphertext, iv, from_user FROM group_key_envelopes WHERE group_id = ? AND kv = ? AND LOWER(username) = LOWER(?)',
        [gid, version, username]
      );
      if (!envelope) return callback?.({ error: 'envelope_missing' });

      callback?.({
        success: true,
        envelope: { ciphertext: envelope.ciphertext, iv: envelope.iv, fromUser: envelope.from_user },
        kv: version
      });
    } catch (error) {
      logger.error('Error fetching group key envelope:', error);
      callback?.({ error: 'Failed to fetch group key' });
    }
  });

  // Mark group as read up to a given message id
  socket.on('mark-group-read', async (data) => {
    try {
      const { groupId, lastReadId } = data || {};
      const gid = parseInt(groupId, 10);
      const lastId = parseInt(lastReadId, 10);
      if (!Number.isInteger(gid) || gid <= 0 || !Number.isInteger(lastId) || lastId < 0) return;

      const membership = await getMembership(gid, username);
      if (!membership) return;

      // Upsert guards against duplicate-key races when several marks arrive together
      await dbRun(
        `INSERT INTO group_reads (group_id, username, last_read_id)
         VALUES (?, ?, ?)
         ON CONFLICT (group_id, username)
         DO UPDATE SET
           last_read_id = CASE WHEN excluded.last_read_id > group_reads.last_read_id THEN excluded.last_read_id ELSE group_reads.last_read_id END,
           updated_at = CURRENT_TIMESTAMP`,
        [gid, username.toLowerCase(), Math.max(0, lastId)]
      );

      io.to(`group_${gid}`).emit('group-read', { groupId: gid, reader: username, lastReadId: lastId });
    } catch (error) {
      logger.error('Error marking group read:', error);
    }
  });

  // Delete group messages:
  //  - own messages  -> removed for everyone (hard delete + room broadcast)
  //  - received ones -> hidden only for the caller ("delete for me")
  socket.on('delete-group-messages', async (data, callback) => {
    try {
      const ids = Array.isArray(data?.messageIds)
        ? data.messageIds.map(Number).filter(Number.isInteger).slice(0, 100)
        : [];
      const groupId = parseInt(data?.groupId, 10);
      if (!ids.length || !Number.isInteger(groupId) || groupId <= 0) {
        return callback?.({ error: 'No messages selected' });
      }

      const membership = await getMembership(groupId, username);
      if (!membership) return callback?.({ error: 'not_member' });

      const placeholders = ids.map(() => '?').join(',');
      const rows = await dbAll(
        `SELECT id, group_id, sender FROM group_messages WHERE id IN (${placeholders}) AND group_id = ?`,
        [...ids, groupId]
      );

      const mine = rows.filter(r => r.sender.toLowerCase() === username.toLowerCase());
      const others = rows.filter(r => r.sender.toLowerCase() !== username.toLowerCase());

      // 1) My messages: hard delete for everyone + notify the room
      if (mine.length) {
        const mineIds = mine.map(r => r.id);
        const minePh = mineIds.map(() => '?').join(',');
        await dbRun(`DELETE FROM group_messages WHERE id IN (${minePh})`, mineIds);
        await dbRun(`DELETE FROM group_hidden_messages WHERE message_id IN (${minePh})`, mineIds);
        io.to(`group_${groupId}`).emit('group-messages-deleted', { groupId, messageIds: mineIds });
      }

      // 2) Received messages: hide only for me
      for (const row of others) {
        await dbRun(
          'INSERT OR IGNORE INTO group_hidden_messages (message_id, username) VALUES (?, ?)',
          [row.id, username.toLowerCase()]
        );
      }

      callback?.({ success: true, deletedForEveryone: mine.map(r => r.id), hiddenForMe: others.map(r => r.id) });
    } catch (error) {
      logger.error('Error deleting group messages:', error);
      callback?.({ error: 'Failed to delete messages' });
    }
  });

  // Typing indicator relay inside a group
  socket.on('group-typing', async (data) => {    try {
      const { groupId, isTyping } = data || {};
      const gid = parseInt(groupId, 10);
      if (!Number.isInteger(gid) || gid <= 0) return;

      const membership = await getMembership(gid, username);
      if (!membership) return;

      socket.to(`group_${gid}`).emit('group-user-typing', {
        groupId: gid,
        username,
        isTyping: Boolean(isTyping)
      });
    } catch (err) {
      logger.error('Error relaying group typing:', err);
    }
  });

  // ==========================================
  // Group Calls (mesh WebRTC signaling relay)
  // ==========================================
  const gcLower = () => username.toLowerCase();

  const gcSession = (gid) => activeGroupCalls.get(gid);

  const gcEndIfEmpty = async (gid, session) => {
    if (session.participants.size === 0) {
      activeGroupCalls.delete(gid);
      io.to(`group_${gid}`).emit('group-call-ended', { groupId: gid });
      return true;
    }
    return false;
  };

  // Start a group call (creator becomes the first participant)
  socket.on('start-group-call', async (data, callback) => {
    try {
      const { groupId, mediaType = 'voice' } = data || {};
      const gid = parseInt(groupId, 10);
      if (!Number.isInteger(gid) || gid <= 0 || !['voice', 'video'].includes(mediaType)) {
        return callback?.({ error: 'Invalid group call request' });
      }

      const membership = await getMembership(gid, username);
      if (!membership) return callback?.({ error: 'not_member' });

      if (gcSession(gid)) {
        return callback?.({ error: 'call_ongoing', mediaType: gcSession(gid).mediaType });
      }

      const session = {
        startedBy: username,
        mediaType,
        participants: new Set([gcLower()]),
        timestamp: Date.now()
      };
      activeGroupCalls.set(gid, session);

      io.to(`group_${gid}`).emit('group-call-started', { groupId: gid, from: username, mediaType });
      callback?.({ success: true });
      logger.info(`Group call started in group ${gid} by ${username} (${mediaType})`);
    } catch (err) {
      logger.error('Error starting group call:', err);
      callback?.({ error: 'Failed to start call' });
    }
  });

  // Join an ongoing group call; the joiner receives the pre-existing roster
  socket.on('join-group-call', (data, callback) => {
    try {
      const { groupId } = data || {};
      const gid = parseInt(groupId, 10);
      if (!Number.isInteger(gid) || gid <= 0) return callback?.({ error: 'Invalid groupId' });

      const session = gcSession(gid);
      if (!session) return callback?.({ error: 'no_call' });

      const meLower = gcLower();
      if (!session.participants.has(meLower) && session.participants.size >= MAX_GROUP_CALLERS) {
        return callback?.({ error: 'call_full' });
      }

      const members = [...session.participants].filter(u => u !== meLower);
      session.participants.add(meLower);
      session.timestamp = Date.now();

      io.to(`group_${gid}`).emit('group-call-member', { groupId: gid, username });
      callback?.({ success: true, mediaType: session.mediaType, members });
    } catch (err) {
      logger.error('Error joining group call:', err);
      callback?.({ error: 'Failed to join call' });
    }
  });

  // Relay WebRTC offers / answers / ICE between two call participants
  socket.on('group-call-signal', (data) => {
    try {
      const { to, groupId, kind, data: signalData } = data || {};
      const gid = parseInt(groupId, 10);
      if (!Number.isInteger(gid) || !to || !['offer', 'answer', 'ice'].includes(kind)) return;

      const session = gcSession(gid);
      if (!session) return;

      const fromL = gcLower();
      const toL = String(to).toLowerCase();
      if (fromL === toL || !session.participants.has(fromL) || !session.participants.has(toL)) return;

      io.to(toL).emit('group-call-signal', { groupId: gid, from: username, kind, data: signalData });
    } catch (err) {
      logger.error('Error relaying group call signal:', err);
    }
  });

  // Broadcast per-peer media state (mute / camera / screen share)
  socket.on('group-call-state', (data) => {
    try {
      const { groupId, muted, cameraOff, screenSharing } = data || {};
      const gid = parseInt(groupId, 10);
      if (!Number.isInteger(gid)) return;

      const session = gcSession(gid);
      if (!session || !session.participants.has(gcLower())) return;

      io.to(`group_${gid}`).emit('group-call-peer-state', {
        groupId: gid,
        from: username,
        muted: Boolean(muted),
        cameraOff: Boolean(cameraOff),
        screenSharing: Boolean(screenSharing)
      });
    } catch (err) {
      logger.error('Error broadcasting group call state:', err);
    }
  });

  // Leave the ongoing call
  socket.on('leave-group-call', async (data) => {
    try {
      const { groupId } = data || {};
      const gid = parseInt(groupId, 10);
      if (!Number.isInteger(gid)) return;

      const session = gcSession(gid);
      if (!session) return;
      session.participants.delete(gcLower());
      io.to(`group_${gid}`).emit('group-call-left', { groupId: gid, username });
      await gcEndIfEmpty(gid, session);
    } catch (err) {
      logger.error('Error leaving group call:', err);
    }
  });

  // Abrupt disconnects must also drop the user from any live group call
  socket.on('disconnect', () => {
    for (const [gid, session] of activeGroupCalls.entries()) {
      if (session.participants.delete(gcLower())) {
        io.to(`group_${gid}`).emit('group-call-left', { groupId: gid, username });
        gcEndIfEmpty(gid, session);
      }
    }
  });
};
