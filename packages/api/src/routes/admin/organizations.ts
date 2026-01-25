import { randomUUID } from 'node:crypto';
import type {
  CreateOrganizationRequest,
  Organization,
  OrganizationResponse,
  OrganizationsListResponse,
  UpdateOrganizationRequest
} from '@rapid/shared';
import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';
import { getPostgresPool } from '../../lib/postgres.js';

const router: RouterType = Router();

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
router.get('/', async (_req: Request, res: Response) => {
  try {
    const pool = await getPostgresPool();
    const result = await pool.query<{
      id: string;
      name: string;
      description: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, name, description, created_at, updated_at
       FROM organizations
       ORDER BY name`
    );

    const organizations: Organization[] = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    }));

    const response: OrganizationsListResponse = { organizations };
    res.json(response);
  } catch (err) {
    console.error('Organizations error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to fetch organizations'
    });
  }
});

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
router.post(
  '/',
  async (
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

      const result = await pool.query<{
        id: string;
        name: string;
        description: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
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

      const organization: Organization = {
        id: row.id,
        name: row.name,
        description: row.description,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString()
      };

      res.status(201).json({ organization });
    } catch (err) {
      console.error('Organizations error:', err);
      if (
        err instanceof Error &&
        err.message.includes('duplicate key value violates unique constraint')
      ) {
        res.status(409).json({ error: 'Organization name already exists' });
        return;
      }
      res.status(500).json({
        error:
          err instanceof Error ? err.message : 'Failed to create organization'
      });
    }
  }
);

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
router.get('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const pool = await getPostgresPool();
    const result = await pool.query<{
      id: string;
      name: string;
      description: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
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
      organization: {
        id: row.id,
        name: row.name,
        description: row.description,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString()
      }
    };
    res.json(response);
  } catch (err) {
    console.error('Organizations error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to fetch organization'
    });
  }
});

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
router.put(
  '/:id',
  async (
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

      const result = await pool.query<{
        id: string;
        name: string;
        description: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
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
        organization: {
          id: row.id,
          name: row.name,
          description: row.description,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString()
        }
      };

      res.json(response);
    } catch (err) {
      console.error('Organizations error:', err);
      if (
        err instanceof Error &&
        err.message.includes('duplicate key value violates unique constraint')
      ) {
        res.status(409).json({ error: 'Organization name already exists' });
        return;
      }
      res.status(500).json({
        error:
          err instanceof Error ? err.message : 'Failed to update organization'
      });
    }
  }
);

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
router.delete('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    const pool = await getPostgresPool();

    const result = await pool.query(
      'DELETE FROM organizations WHERE id = $1',
      [id]
    );
    res.json({ deleted: result.rowCount !== null && result.rowCount > 0 });
  } catch (err) {
    console.error('Organizations error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to delete organization'
    });
  }
});

export { router as organizationsRouter };
