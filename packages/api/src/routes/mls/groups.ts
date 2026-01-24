import { randomUUID } from 'node:crypto';
import {
  type AddMembersRequest,
  type AddMembersResponse,
  type ChatGroup,
  type ChatGroupMember,
  type ChatGroupResponse,
  type ChatGroupsResponse,
  isRecord,
  type MlsChatCreateGroupRequest,
  type MlsChatCreateGroupResponse,
  type RemoveMemberResponse
} from '@rapid/shared';
import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';
import { broadcast } from '../../lib/broadcast.js';
import { getPostgresPool } from '../../lib/postgres.js';

const router: RouterType = Router();

function parseCreateGroupRequest(
  body: unknown
): MlsChatCreateGroupRequest | null {
  if (!isRecord(body)) {
    return null;
  }
  const name = body['name'];
  const mlsGroupId = body['mlsGroupId'];
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    typeof mlsGroupId !== 'string' ||
    !mlsGroupId.trim()
  ) {
    return null;
  }
  return { name: name.trim(), mlsGroupId: mlsGroupId.trim() };
}

function parseAddMembersRequest(body: unknown): AddMembersRequest | null {
  if (!isRecord(body)) {
    return null;
  }
  const memberUserIds = body['memberUserIds'];
  const welcomeMessages = body['welcomeMessages'];
  const commitData = body['commitData'];

  if (!Array.isArray(memberUserIds) || memberUserIds.length === 0) {
    return null;
  }
  for (const id of memberUserIds) {
    if (typeof id !== 'string') {
      return null;
    }
  }

  if (!Array.isArray(welcomeMessages)) {
    return null;
  }
  const parsedWelcomes: AddMembersRequest['welcomeMessages'] = [];
  for (const w of welcomeMessages) {
    if (!isRecord(w)) {
      return null;
    }
    const userId = w['userId'];
    const welcomeData = w['welcomeData'];
    if (typeof userId !== 'string' || typeof welcomeData !== 'string') {
      return null;
    }
    parsedWelcomes.push({ userId, welcomeData });
  }

  if (typeof commitData !== 'string' || !commitData.trim()) {
    return null;
  }

  return {
    memberUserIds: memberUserIds as string[],
    welcomeMessages: parsedWelcomes,
    commitData: commitData.trim()
  };
}

/**
 * @openapi
 * /mls/groups:
 *   post:
 *     summary: Create a new chat group
 *     description: Creates a new MLS encrypted chat group.
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               mlsGroupId:
 *                 type: string
 *                 description: Base64-encoded MLS group ID from client
 *     responses:
 *       201:
 *         description: Group created
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.post('/', async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = parseCreateGroupRequest(req.body);
  if (!payload) {
    res.status(400).json({ error: 'name and mlsGroupId are required' });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const now = new Date();
    const groupId = randomUUID();
    const memberId = randomUUID();

    // Use transaction for atomicity
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create the group
      await client.query(
        `INSERT INTO chat_groups (id, name, created_by, mls_group_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [groupId, payload.name, claims.sub, payload.mlsGroupId, now, now]
      );

      // Add the creator as admin member
      await client.query(
        `INSERT INTO chat_group_members (id, group_id, user_id, role, joined_at)
         VALUES ($1, $2, $3, 'admin', $4)`,
        [memberId, groupId, claims.sub, now]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const group: ChatGroup = {
      id: groupId,
      name: payload.name,
      createdBy: claims.sub,
      mlsGroupId: payload.mlsGroupId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      memberCount: 1
    };

    const response: MlsChatCreateGroupResponse = { group };
    res.status(201).json(response);
  } catch (error) {
    console.error('Failed to create group:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

/**
 * @openapi
 * /mls/groups:
 *   get:
 *     summary: List user's groups
 *     description: Returns all groups the authenticated user is a member of.
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of groups
 *       401:
 *         description: Unauthorized
 */
router.get('/', async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const result = await pool.query<{
      id: string;
      name: string;
      created_by: string;
      mls_group_id: string;
      created_at: Date;
      updated_at: Date;
      member_count: string;
    }>(
      `SELECT g.id, g.name, g.created_by, g.mls_group_id, g.created_at, g.updated_at,
              (SELECT COUNT(*) FROM chat_group_members WHERE group_id = g.id) as member_count
       FROM chat_groups g
       JOIN chat_group_members m ON g.id = m.group_id
       WHERE m.user_id = $1
       ORDER BY g.updated_at DESC`,
      [claims.sub]
    );

    const groups: ChatGroup[] = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdBy: row.created_by,
      mlsGroupId: row.mls_group_id,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      memberCount: parseInt(row.member_count, 10)
    }));

    const response: ChatGroupsResponse = { groups };
    res.json(response);
  } catch (error) {
    console.error('Failed to list groups:', error);
    res.status(500).json({ error: 'Failed to list groups' });
  }
});

/**
 * @openapi
 * /mls/groups/{groupId}:
 *   get:
 *     summary: Get group details
 *     description: Returns group details and members.
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Group details
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Not a member
 *       404:
 *         description: Group not found
 */
router.get('/:groupId', async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { groupId } = req.params;

  try {
    const pool = await getPostgresPool();

    // Check membership
    const memberCheck = await pool.query(
      `SELECT 1 FROM chat_group_members WHERE group_id = $1 AND user_id = $2`,
      [groupId, claims.sub]
    );
    if (memberCheck.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    // Get group
    const groupResult = await pool.query<{
      id: string;
      name: string;
      created_by: string;
      mls_group_id: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, name, created_by, mls_group_id, created_at, updated_at
       FROM chat_groups WHERE id = $1`,
      [groupId]
    );
    const groupRow = groupResult.rows[0];
    if (!groupRow) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    // Get members
    const membersResult = await pool.query<{
      user_id: string;
      email: string;
      role: string;
      joined_at: Date;
    }>(
      `SELECT m.user_id, u.email, m.role, m.joined_at
       FROM chat_group_members m
       JOIN users u ON m.user_id = u.id
       WHERE m.group_id = $1
       ORDER BY m.joined_at ASC`,
      [groupId]
    );

    const members: ChatGroupMember[] = membersResult.rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      role: row.role as 'admin' | 'member',
      joinedAt: row.joined_at.toISOString()
    }));

    const group: ChatGroup = {
      id: groupRow.id,
      name: groupRow.name,
      createdBy: groupRow.created_by,
      mlsGroupId: groupRow.mls_group_id,
      createdAt: groupRow.created_at.toISOString(),
      updatedAt: groupRow.updated_at.toISOString(),
      memberCount: members.length
    };

    const response: ChatGroupResponse = { group, members };
    res.json(response);
  } catch (error) {
    console.error('Failed to get group:', error);
    res.status(500).json({ error: 'Failed to get group' });
  }
});

/**
 * @openapi
 * /mls/groups/{groupId}/members:
 *   post:
 *     summary: Add members to group
 *     description: Adds new members to the group with Welcome messages.
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               memberUserIds:
 *                 type: array
 *                 items:
 *                   type: string
 *               welcomeMessages:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     userId:
 *                       type: string
 *                     welcomeData:
 *                       type: string
 *               commitData:
 *                 type: string
 *     responses:
 *       200:
 *         description: Members added
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Not authorized to add members
 */
router.post('/:groupId/members', async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { groupId } = req.params;
  if (!groupId) {
    res.status(400).json({ error: 'groupId is required' });
    return;
  }

  const payload = parseAddMembersRequest(req.body);
  if (!payload) {
    res.status(400).json({
      error: 'memberUserIds, welcomeMessages, and commitData are required'
    });
    return;
  }

  try {
    const pool = await getPostgresPool();

    // Check if requester is admin of the group
    const adminCheck = await pool.query<{ role: string }>(
      `SELECT role FROM chat_group_members WHERE group_id = $1 AND user_id = $2`,
      [groupId, claims.sub]
    );
    if (adminCheck.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }
    if (adminCheck.rows[0]?.role !== 'admin') {
      res.status(403).json({ error: 'Only admins can add members' });
      return;
    }

    // Get group name for Welcome notifications
    const groupResult = await pool.query<{ name: string }>(
      `SELECT name FROM chat_groups WHERE id = $1`,
      [groupId]
    );
    const groupName = groupResult.rows[0]?.name ?? 'Unknown Group';

    const now = new Date();
    const addedMembers: ChatGroupMember[] = [];

    // Batch query: Get existing members and user emails in single queries
    const existingMembersResult = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM chat_group_members WHERE group_id = $1 AND user_id = ANY($2)`,
      [groupId, payload.memberUserIds]
    );
    const existingMemberIds = new Set(
      existingMembersResult.rows.map((r) => r.user_id)
    );

    const usersResult = await pool.query<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE id = ANY($1)`,
      [payload.memberUserIds]
    );
    const userEmailMap = new Map(usersResult.rows.map((r) => [r.id, r.email]));

    // Filter to only new members with valid emails
    const newMembers = payload.memberUserIds.filter(
      (userId) => !existingMemberIds.has(userId) && userEmailMap.has(userId)
    );

    if (newMembers.length > 0) {
      // Use transaction for all database modifications
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Bulk insert members
        const memberValues: (string | Date)[] = [];
        const memberPlaceholders: string[] = [];
        let i = 1;
        for (const userId of newMembers) {
          const memberId = randomUUID();
          memberValues.push(memberId, groupId, userId, now);
          memberPlaceholders.push(
            `($${i++}, $${i++}, $${i++}, 'member', $${i++})`
          );

          addedMembers.push({
            userId,
            email: userEmailMap.get(userId) ?? '',
            role: 'member',
            joinedAt: now.toISOString()
          });
        }

        await client.query(
          `INSERT INTO chat_group_members (id, group_id, user_id, role, joined_at)
           VALUES ${memberPlaceholders.join(', ')}`,
          memberValues
        );

        // Bulk insert Welcome messages
        const welcomeValues: (string | Date)[] = [];
        const welcomePlaceholders: string[] = [];
        let j = 1;
        for (const userId of newMembers) {
          const welcomeMsg = payload.welcomeMessages.find(
            (w) => w.userId === userId
          );
          if (welcomeMsg) {
            const welcomeId = randomUUID();
            welcomeValues.push(
              welcomeId,
              groupId,
              userId,
              welcomeMsg.welcomeData,
              now
            );
            welcomePlaceholders.push(
              `($${j++}, $${j++}, $${j++}, $${j++}, $${j++}, FALSE)`
            );
          }
        }

        if (welcomePlaceholders.length > 0) {
          await client.query(
            `INSERT INTO mls_welcomes (id, group_id, recipient_user_id, welcome_data, created_at, fetched)
             VALUES ${welcomePlaceholders.join(', ')}`,
            welcomeValues
          );
        }

        // Update group updated_at
        await client.query(
          `UPDATE chat_groups SET updated_at = $1 WHERE id = $2`,
          [now, groupId]
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      // Send SSE notifications outside transaction
      for (const userId of newMembers) {
        const welcomeMsg = payload.welcomeMessages.find(
          (w) => w.userId === userId
        );
        if (welcomeMsg) {
          await broadcast(`mls:user:${userId}`, {
            type: 'mls_welcome',
            payload: { groupId, groupName },
            timestamp: now.toISOString()
          });
        }
      }

      // Broadcast member added to group channel
      for (const member of addedMembers) {
        await broadcast(`mls:group:${groupId}`, {
          type: 'mls_member_added',
          payload: { groupId, member },
          timestamp: now.toISOString()
        });
      }
    }

    const response: AddMembersResponse = { addedMembers };
    res.json(response);
  } catch (error) {
    console.error('Failed to add members:', error);
    res.status(500).json({ error: 'Failed to add members' });
  }
});

/**
 * @openapi
 * /mls/groups/{groupId}/members/{userId}:
 *   delete:
 *     summary: Remove member from group
 *     description: Removes a member from the group.
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Member removed
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Member not found
 */
router.delete(
  '/:groupId/members/:userId',
  async (req: Request, res: Response) => {
    const claims = req.authClaims;
    if (!claims) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { groupId, userId } = req.params;

    try {
      const pool = await getPostgresPool();

      // Check if requester is admin (or removing themselves)
      const adminCheck = await pool.query<{ role: string }>(
        `SELECT role FROM chat_group_members WHERE group_id = $1 AND user_id = $2`,
        [groupId, claims.sub]
      );
      if (adminCheck.rows.length === 0) {
        res.status(403).json({ error: 'Not a member of this group' });
        return;
      }
      if (adminCheck.rows[0]?.role !== 'admin' && claims.sub !== userId) {
        res.status(403).json({ error: 'Only admins can remove other members' });
        return;
      }

      // Remove the member
      const result = await pool.query(
        `DELETE FROM chat_group_members WHERE group_id = $1 AND user_id = $2`,
        [groupId, userId]
      );

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Member not found' });
        return;
      }

      // Update group updated_at
      const now = new Date();
      await pool.query(`UPDATE chat_groups SET updated_at = $1 WHERE id = $2`, [
        now,
        groupId
      ]);

      // Broadcast member removed
      await broadcast(`mls:group:${groupId}`, {
        type: 'mls_member_removed',
        payload: { groupId, userId },
        timestamp: now.toISOString()
      });

      const response: RemoveMemberResponse = { removed: true };
      res.json(response);
    } catch (error) {
      console.error('Failed to remove member:', error);
      res.status(500).json({ error: 'Failed to remove member' });
    }
  }
);

export { router as groupsRouter };
