import { randomUUID } from 'node:crypto';
import type {
  CreateOrganizationRequest,
  Organization,
  OrganizationGroupsResponse,
  OrganizationResponse,
  OrganizationsListResponse,
  OrganizationUsersResponse,
  UpdateOrganizationRequest
} from '@rapid/shared';
import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';
import { getPostgresPool } from '../../lib/postgres.js';
import { ensureOrganizationExists } from './lib/organizations.js';
import { registerDeleteIdRoute } from './organizations/delete-id.js';
import { registerGetIdRoute } from './organizations/get-id.js';
import { registerGetIdGroupsRoute } from './organizations/get-id-groups.js';
import { registerGetIdUsersRoute } from './organizations/get-id-users.js';
import { registerGetRootRoute } from './organizations/get-root.js';
import { registerPostRootRoute } from './organizations/post-root.js';
import { registerPutIdRoute } from './organizations/put-id.js';

type OrganizationRow = {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
};

function mapOrganizationRow(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function isDuplicateConstraintError(err: unknown): err is Error {
  return (
    err instanceof Error &&
    err.message.includes('duplicate key value violates unique constraint')
  );
}

/**
 * @openapi
 * /admin/organizations:
 *   get:
 *     summary: List organizations
 *     description: Returns all organizations for admin management.
 *     tags:
 *       - Admin
 *     responses:
 *       200:
 *         description: List of organizations
 *       500:
 *         description: Database error
 */
export const getRootHandler = async (_req: Request, res: Response) => {
  try {
    const pool = await getPostgresPool();
    const result = await pool.query<OrganizationRow>(
      `SELECT id, name, description, created_at, updated_at
       FROM organizations
       ORDER BY name`
    );

    const organizations: Organization[] = result.rows.map(mapOrganizationRow);

    const response: OrganizationsListResponse = { organizations };
    res.json(response);
  } catch (err) {
    console.error('Organizations error:', err);
    res.status(500).json({
      error:
        err instanceof Error ? err.message : 'Failed to fetch organizations'
    });
  }
};

/**
 * @openapi
 * /admin/organizations:
 *   post:
 *     summary: Create a new organization
 *     description: Creates an organization with the given name and optional description.
 *     tags:
 *       - Admin
 *     responses:
 *       201:
 *         description: Organization created successfully
 *       400:
 *         description: Invalid request body
 *       409:
 *         description: Organization name already exists
 *       500:
 *         description: Database error
 */
export const postRootHandler = async (
  req: Request<unknown, unknown, CreateOrganizationRequest>,
  res: Response
) => {
  try {
    const { name, description } = req.body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const pool = await getPostgresPool();
    const id = randomUUID();
    const now = new Date();

    const result = await pool.query<OrganizationRow>(
      `INSERT INTO organizations (id, name, description, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, description, created_at, updated_at`,
      [id, name.trim(), description?.trim() || null, now, now]
    );

    const row = result.rows[0];
    if (!row) {
      res.status(500).json({ error: 'Failed to create organization' });
      return;
    }

    const organization = mapOrganizationRow(row);

    res.status(201).json({ organization });
  } catch (err) {
    console.error('Organizations error:', err);
    if (isDuplicateConstraintError(err)) {
      res.status(409).json({ error: 'Organization name already exists' });
      return;
    }
    res.status(500).json({
      error:
        err instanceof Error ? err.message : 'Failed to create organization'
    });
  }
};

/**
 * @openapi
 * /admin/organizations/{id}:
 *   get:
 *     summary: Get an organization by ID
 *     description: Returns a single organization for admin management.
 *     tags:
 *       - Admin
 *     responses:
 *       200:
 *         description: Organization found
 *       404:
 *         description: Organization not found
 *       500:
 *         description: Database error
 */
export const getIdHandler = async (
  req: Request<{ id: string }>,
  res: Response
) => {
  try {
    const pool = await getPostgresPool();
    const result = await pool.query<OrganizationRow>(
      `SELECT id, name, description, created_at, updated_at
       FROM organizations
       WHERE id = $1`,
      [req.params['id']]
    );

    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    const response: OrganizationResponse = {
      organization: mapOrganizationRow(row)
    };
    res.json(response);
  } catch (err) {
    console.error('Organizations error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to fetch organization'
    });
  }
};

/**
 * @openapi
 * /admin/organizations/{id}/users:
 *   get:
 *     summary: Get users belonging to an organization
 *     description: Returns all users that are members of the specified organization.
 *     tags:
 *       - Admin
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Organization ID
 *     responses:
 *       200:
 *         description: List of organization users
 *       404:
 *         description: Organization not found
 *       500:
 *         description: Database error
 */
export const getIdUsersHandler = async (
  req: Request<{ id: string }>,
  res: Response
) => {
  try {
    const { id } = req.params;
    const pool = await getPostgresPool();
    if (!(await ensureOrganizationExists(pool, id, res))) return;

    const result = await pool.query<{
      id: string;
      email: string;
      joined_at: Date;
    }>(
      `SELECT u.id, u.email, uo.joined_at
         FROM users u
         INNER JOIN user_organizations uo ON uo.user_id = u.id
         WHERE uo.organization_id = $1
         ORDER BY u.email`,
      [id]
    );

    const response: OrganizationUsersResponse = {
      users: result.rows.map((row) => ({
        id: row.id,
        email: row.email,
        joinedAt: row.joined_at.toISOString()
      }))
    };
    res.json(response);
  } catch (err) {
    console.error('Organizations error:', err);
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Failed to fetch organization users'
    });
  }
};

/**
 * @openapi
 * /admin/organizations/{id}/groups:
 *   get:
 *     summary: Get groups belonging to an organization
 *     description: Returns all groups that belong to the specified organization.
 *     tags:
 *       - Admin
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Organization ID
 *     responses:
 *       200:
 *         description: List of organization groups
 *       404:
 *         description: Organization not found
 *       500:
 *         description: Database error
 */
export const getIdGroupsHandler = async (
  req: Request<{ id: string }>,
  res: Response
) => {
  try {
    const { id } = req.params;
    const pool = await getPostgresPool();
    if (!(await ensureOrganizationExists(pool, id, res))) return;

    const result = await pool.query<{
      id: string;
      name: string;
      description: string | null;
      member_count: number;
    }>(
      `SELECT g.id, g.name, g.description, COUNT(ug.user_id)::integer AS member_count
         FROM groups g
         LEFT JOIN user_groups ug ON ug.group_id = g.id
         WHERE g.organization_id = $1
         GROUP BY g.id
         ORDER BY g.name`,
      [id]
    );

    const response: OrganizationGroupsResponse = {
      groups: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        memberCount: row.member_count
      }))
    };
    res.json(response);
  } catch (err) {
    console.error('Organizations error:', err);
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Failed to fetch organization groups'
    });
  }
};

/**
 * @openapi
 * /admin/organizations/{id}:
 *   put:
 *     summary: Update an organization
 *     description: Updates an organization's name and/or description.
 *     tags:
 *       - Admin
 *     responses:
 *       200:
 *         description: Organization updated successfully
 *       400:
 *         description: Invalid request body
 *       404:
 *         description: Organization not found
 *       409:
 *         description: Organization name already exists
 *       500:
 *         description: Database error
 */
export const putIdHandler = async (
  req: Request<{ id: string }, unknown, UpdateOrganizationRequest>,
  res: Response
) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
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

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push(`updated_at = $${paramIndex++}`);
    values.push(new Date());
    values.push(id);

    const result = await pool.query<OrganizationRow>(
      `UPDATE organizations
         SET ${updates.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING id, name, description, created_at, updated_at`,
      values
    );

    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    const response: OrganizationResponse = {
      organization: mapOrganizationRow(row)
    };

    res.json(response);
  } catch (err) {
    console.error('Organizations error:', err);
    if (isDuplicateConstraintError(err)) {
      res.status(409).json({ error: 'Organization name already exists' });
      return;
    }
    res.status(500).json({
      error:
        err instanceof Error ? err.message : 'Failed to update organization'
    });
  }
};

/**
 * @openapi
 * /admin/organizations/{id}:
 *   delete:
 *     summary: Delete an organization
 *     description: Deletes an organization and its memberships.
 *     tags:
 *       - Admin
 *     responses:
 *       200:
 *         description: Organization deleted successfully
 *       500:
 *         description: Database error
 */
export const deleteIdHandler = async (
  req: Request<{ id: string }>,
  res: Response
) => {
  try {
    const { id } = req.params;
    const pool = await getPostgresPool();

    const result = await pool.query('DELETE FROM organizations WHERE id = $1', [
      id
    ]);
    res.json({ deleted: result.rowCount !== null && result.rowCount > 0 });
  } catch (err) {
    console.error('Organizations error:', err);
    res.status(500).json({
      error:
        err instanceof Error ? err.message : 'Failed to delete organization'
    });
  }
};

const organizationsRouter: RouterType = Router();
registerGetRootRoute(organizationsRouter);
registerPostRootRoute(organizationsRouter);
registerGetIdRoute(organizationsRouter);
registerGetIdUsersRoute(organizationsRouter);
registerGetIdGroupsRoute(organizationsRouter);
registerPutIdRoute(organizationsRouter);
registerDeleteIdRoute(organizationsRouter);

export { organizationsRouter };
