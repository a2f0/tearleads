import { randomUUID } from 'node:crypto';
import type { CreateGroupRequest } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../../lib/postgres.js';
import { ensureOrganizationAccess } from '../../../middleware/adminAccess.js';
import { isDuplicateConstraintError } from '../lib/db.js';
import { ensureOrganizationExists } from '../lib/organizations.js';
import { type GroupRow, mapGroupRow } from './shared.js';

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
const postRootHandler = async (
  req: Request<Record<string, never>, unknown, CreateGroupRequest>,
  res: Response
) => {
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
    if (!ensureOrganizationAccess(req, res, trimmedOrganizationId)) {
      return;
    }
    if (!(await ensureOrganizationExists(pool, trimmedOrganizationId, res))) {
      return;
    }
    const id = randomUUID();
    const now = new Date();

    const result = await pool.query<GroupRow>(
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

    const group = mapGroupRow(row);

    res.status(201).json({ group });
  } catch (err) {
    console.error('Groups error:', err);
    if (isDuplicateConstraintError(err)) {
      res.status(409).json({ error: 'Group name already exists' });
      return;
    }
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to create group'
    });
  }
};

export function registerPostRootRoute(routeRouter: RouterType): void {
  routeRouter.post('/', postRootHandler);
}
