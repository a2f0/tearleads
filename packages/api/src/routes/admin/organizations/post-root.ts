import { randomUUID } from 'node:crypto';
import type { CreateOrganizationRequest } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../../lib/postgres.js';
import { isDuplicateConstraintError } from '../lib/db.js';
import { mapOrganizationRow, type OrganizationRow } from './shared.js';

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

export function registerPostRootRoute(routeRouter: RouterType): void {
  routeRouter.post('/', postRootHandler);
}
