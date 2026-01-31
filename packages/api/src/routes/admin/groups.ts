import { randomUUID } from 'node:crypto';
import type {
  AddMemberRequest,
  CreateGroupRequest,
  Group,
  GroupDetailResponse,
  GroupMember,
  GroupMembersResponse,
  GroupsListResponse,
  GroupWithMemberCount,
  UpdateGroupRequest
} from '@rapid/shared';
import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';
import { getPostgresPool } from '../../lib/postgres.js';

const groupsRouter: RouterType = Router();

/**
 * @openapi
 * /admin/groups:
 *   get:
 *     summary: List all groups with member counts
 *     description: Returns all groups with their member counts
 *     tags:
 *       - Admin
 *     responses:
 *       200:
 *         description: List of groups with member counts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 groups:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       description:
 *                         type: string
 *                       createdAt:
 *                         type: string
 *                       updatedAt:
 *                         type: string
 *                       memberCount:
 *                         type: number
 *       500:
 *         description: Database error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
groupsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const pool = await getPostgresPool();
    const result = await pool.query<{
      id: string;
      organization_id: string;
      name: string;
      description: string | null;
      created_at: Date;
      updated_at: Date;
      member_count: string;
    }>(`
      SELECT
        g.id,
        g.organization_id,
        g.name,
        g.description,
        g.created_at,
        g.updated_at,
        COUNT(ug.user_id)::text AS member_count
      FROM groups g
      LEFT JOIN user_groups ug ON ug.group_id = g.id
      GROUP BY g.id
      ORDER BY g.name
    `);

    const groups: GroupWithMemberCount[] = result.rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      description: row.description,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      memberCount: parseInt(row.member_count, 10)
    }));

    const response: GroupsListResponse = { groups };
    res.json(response);
  } catch (err) {
    console.error('Groups error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to fetch groups'
    });
  }
});

/**
 * @openapi
 * /admin/groups:
 *   post:
 *     summary: Create a new group
 *     description: Creates a new group with the given name and optional description
 *     tags:
 *       - Admin
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - organizationId
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               organizationId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Group created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 group:
 *                   type: object
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: Group name already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Database error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
groupsRouter.post(
  '/',
  async (req: Request<unknown, unknown, CreateGroupRequest>, res: Response) => {
    try {
      const { name, description, organizationId } = req.body;

      if (!name || typeof name !== 'string' || name.trim() === '') {
        res.status(400).json({ error: 'Name is required' });
        return;
      }

      if (typeof organizationId !== 'string' || organizationId.trim() === '') {
        res.status(400).json({ error: 'Organization ID is required' });
        return;
      }

      const trimmedOrganizationId = organizationId.trim();

      const pool = await getPostgresPool();
      const orgResult = await pool.query<{ id: string }>(
        'SELECT id FROM organizations WHERE id = $1',
        [trimmedOrganizationId]
      );
      if (!orgResult.rows[0]) {
        res.status(404).json({ error: 'Organization not found' });
        return;
      }
      const id = randomUUID();
      const now = new Date();

      const result = await pool.query<{
        id: string;
        organization_id: string;
        name: string;
        description: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `INSERT INTO groups (id, organization_id, name, description, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, organization_id, name, description, created_at, updated_at`,
        [
          id,
          trimmedOrganizationId,
          name.trim(),
          description?.trim() || null,
          now,
          now
        ]
      );

      const row = result.rows[0];
      if (!row) {
        res.status(500).json({ error: 'Failed to create group' });
        return;
      }

      const group: Group = {
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        description: row.description,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString()
      };

      res.status(201).json({ group });
    } catch (err) {
      console.error('Groups error:', err);
      if (
        err instanceof Error &&
        err.message.includes('duplicate key value violates unique constraint')
      ) {
        res.status(409).json({ error: 'Group name already exists' });
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to create group'
      });
    }
  }
);

/**
 * @openapi
 * /admin/groups/{id}:
 *   get:
 *     summary: Get group details with members
 *     description: Returns a group with its members
 *     tags:
 *       - Admin
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The group ID
 *     responses:
 *       200:
 *         description: Group details with members
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 group:
 *                   type: object
 *                 members:
 *                   type: array
 *       404:
 *         description: Group not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Database error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
groupsRouter.get(
  '/:id',
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params;
      const pool = await getPostgresPool();

      const groupResult = await pool.query<{
        id: string;
        organization_id: string;
        name: string;
        description: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        'SELECT id, organization_id, name, description, created_at, updated_at FROM groups WHERE id = $1',
        [id]
      );

      const groupRow = groupResult.rows[0];
      if (!groupRow) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      const membersResult = await pool.query<{
        user_id: string;
        email: string;
        joined_at: Date;
      }>(
        `SELECT ug.user_id, u.email, ug.joined_at
       FROM user_groups ug
       JOIN users u ON u.id = ug.user_id
       WHERE ug.group_id = $1
       ORDER BY ug.joined_at`,
        [id]
      );

      const group: Group = {
        id: groupRow.id,
        organizationId: groupRow.organization_id,
        name: groupRow.name,
        description: groupRow.description,
        createdAt: groupRow.created_at.toISOString(),
        updatedAt: groupRow.updated_at.toISOString()
      };

      const members: GroupMember[] = membersResult.rows.map((row) => ({
        userId: row.user_id,
        email: row.email,
        joinedAt: row.joined_at.toISOString()
      }));

      const response: GroupDetailResponse = { group, members };
      res.json(response);
    } catch (err) {
      console.error('Groups error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to fetch group'
      });
    }
  }
);

/**
 * @openapi
 * /admin/groups/{id}:
 *   put:
 *     summary: Update a group
 *     description: Updates a group's name and/or description
 *     tags:
 *       - Admin
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The group ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Group updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 group:
 *                   type: object
 *       404:
 *         description: Group not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: Group name already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Database error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
groupsRouter.put(
  '/:id',
  async (
    req: Request<{ id: string }, unknown, UpdateGroupRequest>,
    res: Response
  ) => {
    try {
      const { id } = req.params;
      const { name, description, organizationId } = req.body;
      const pool = await getPostgresPool();

      const updates: string[] = [];
      const values: (string | Date | null)[] = [];
      let paramIndex = 1;

      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim() === '') {
          res.status(400).json({ error: 'Name cannot be empty' });
          return;
        }
        updates.push(`name = $${paramIndex++}`);
        values.push(name.trim());
      }

      if (description !== undefined) {
        updates.push(`description = $${paramIndex++}`);
        values.push(description?.trim() || null);
      }

      if (organizationId !== undefined) {
        if (
          typeof organizationId !== 'string' ||
          organizationId.trim() === ''
        ) {
          res.status(400).json({ error: 'Organization ID cannot be empty' });
          return;
        }
        const orgExists = await pool.query<{ id: string }>(
          'SELECT id FROM organizations WHERE id = $1',
          [organizationId]
        );
        if (!orgExists.rows[0]) {
          res.status(404).json({ error: 'Organization not found' });
          return;
        }
        updates.push(`organization_id = $${paramIndex++}`);
        values.push(organizationId);
      }

      if (updates.length === 0) {
        res.status(400).json({ error: 'No fields to update' });
        return;
      }

      updates.push(`updated_at = $${paramIndex++}`);
      values.push(new Date());
      values.push(id);

      const result = await pool.query<{
        id: string;
        organization_id: string;
        name: string;
        description: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `UPDATE groups
         SET ${updates.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING id, organization_id, name, description, created_at, updated_at`,
        values
      );

      const row = result.rows[0];
      if (!row) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      const group: Group = {
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        description: row.description,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString()
      };

      res.json({ group });
    } catch (err) {
      console.error('Groups error:', err);
      if (
        err instanceof Error &&
        err.message.includes('duplicate key value violates unique constraint')
      ) {
        res.status(409).json({ error: 'Group name already exists' });
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to update group'
      });
    }
  }
);

/**
 * @openapi
 * /admin/groups/{id}:
 *   delete:
 *     summary: Delete a group
 *     description: Deletes a group and all its memberships
 *     tags:
 *       - Admin
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The group ID
 *     responses:
 *       200:
 *         description: Group deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deleted:
 *                   type: boolean
 *       500:
 *         description: Database error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
groupsRouter.delete(
  '/:id',
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params;
      const pool = await getPostgresPool();

      const result = await pool.query('DELETE FROM groups WHERE id = $1', [id]);
      res.json({ deleted: result.rowCount !== null && result.rowCount > 0 });
    } catch (err) {
      console.error('Groups error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to delete group'
      });
    }
  }
);

/**
 * @openapi
 * /admin/groups/{id}/members:
 *   get:
 *     summary: Get group members
 *     description: Returns all members of a group
 *     tags:
 *       - Admin
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The group ID
 *     responses:
 *       200:
 *         description: List of group members
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 members:
 *                   type: array
 *       404:
 *         description: Group not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Database error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
groupsRouter.get(
  '/:id/members',
  async (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params;
      const pool = await getPostgresPool();

      const groupResult = await pool.query<{ organization_id: string }>(
        'SELECT organization_id FROM groups WHERE id = $1',
        [id]
      );
      const groupRow = groupResult.rows[0];
      if (!groupRow) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      const result = await pool.query<{
        user_id: string;
        email: string;
        joined_at: Date;
      }>(
        `SELECT ug.user_id, u.email, ug.joined_at
         FROM user_groups ug
         JOIN users u ON u.id = ug.user_id
         WHERE ug.group_id = $1
         ORDER BY ug.joined_at`,
        [id]
      );

      const members: GroupMember[] = result.rows.map((row) => ({
        userId: row.user_id,
        email: row.email,
        joinedAt: row.joined_at.toISOString()
      }));

      const response: GroupMembersResponse = { members };
      res.json(response);
    } catch (err) {
      console.error('Groups error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to fetch members'
      });
    }
  }
);

/**
 * @openapi
 * /admin/groups/{id}/members:
 *   post:
 *     summary: Add a member to a group
 *     description: Adds a user to a group
 *     tags:
 *       - Admin
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The group ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Member added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 added:
 *                   type: boolean
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Group or user not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: User already a member
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Database error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
groupsRouter.post(
  '/:id/members',
  async (
    req: Request<{ id: string }, unknown, AddMemberRequest>,
    res: Response
  ) => {
    try {
      const { id } = req.params;
      const { userId } = req.body;

      if (!userId || typeof userId !== 'string') {
        res.status(400).json({ error: 'userId is required' });
        return;
      }

      const pool = await getPostgresPool();

      const groupResult = await pool.query<{ organization_id: string }>(
        'SELECT organization_id FROM groups WHERE id = $1',
        [id]
      );
      const groupRow = groupResult.rows[0];
      if (!groupRow) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      const userExists = await pool.query('SELECT 1 FROM users WHERE id = $1', [
        userId
      ]);
      if (userExists.rowCount === 0) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      await pool.query(
        `INSERT INTO user_organizations (user_id, organization_id, joined_at)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [userId, groupRow.organization_id, new Date()]
      );

      await pool.query(
        `INSERT INTO user_groups (user_id, group_id, joined_at)
         VALUES ($1, $2, $3)`,
        [userId, id, new Date()]
      );

      res.status(201).json({ added: true });
    } catch (err) {
      console.error('Groups error:', err);
      if (
        err instanceof Error &&
        err.message.includes('duplicate key value violates unique constraint')
      ) {
        res
          .status(409)
          .json({ error: 'User is already a member of this group' });
        return;
      }
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to add member'
      });
    }
  }
);

/**
 * @openapi
 * /admin/groups/{id}/members/{userId}:
 *   delete:
 *     summary: Remove a member from a group
 *     description: Removes a user from a group
 *     tags:
 *       - Admin
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The group ID
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: The user ID
 *     responses:
 *       200:
 *         description: Member removed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 removed:
 *                   type: boolean
 *       500:
 *         description: Database error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
groupsRouter.delete(
  '/:id/members/:userId',
  async (req: Request<{ id: string; userId: string }>, res: Response) => {
    try {
      const { id, userId } = req.params;
      const pool = await getPostgresPool();

      const result = await pool.query(
        'DELETE FROM user_groups WHERE group_id = $1 AND user_id = $2',
        [id, userId]
      );

      res.json({ removed: result.rowCount !== null && result.rowCount > 0 });
    } catch (err) {
      console.error('Groups error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to remove member'
      });
    }
  }
);

export { groupsRouter };
