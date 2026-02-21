import type { UpdateGroupRequest } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../../lib/postgres.js';
import { ensureOrganizationAccess } from '../../../middleware/adminAccess.js';
import { isDuplicateConstraintError } from '../lib/db.js';
import { ensureOrganizationExists } from '../lib/organizations.js';
import {
  type GroupRow,
  getGroupOrganizationId,
  mapGroupRow
} from './shared.js';

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
const putIdHandler = async (
  req: Request<{ id: string }, unknown, UpdateGroupRequest>,
  res: Response
) => {
  try {
    const { id } = req.params;
    const { name, description, organizationId } = req.body;
    const pool = await getPostgresPool();

    const currentOrganizationId = await getGroupOrganizationId(pool, id);
    if (!currentOrganizationId) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    if (!ensureOrganizationAccess(req, res, currentOrganizationId)) {
      return;
    }

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
      if (typeof organizationId !== 'string' || organizationId.trim() === '') {
        res.status(400).json({ error: 'Organization ID cannot be empty' });
        return;
      }
      const trimmedOrganizationId = organizationId.trim();
      if (!(await ensureOrganizationExists(pool, trimmedOrganizationId, res))) {
        return;
      }
      if (!ensureOrganizationAccess(req, res, trimmedOrganizationId)) {
        return;
      }
      updates.push(`organization_id = $${paramIndex++}`);
      values.push(trimmedOrganizationId);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push(`updated_at = $${paramIndex++}`);
    values.push(new Date());
    values.push(id);

    const result = await pool.query<GroupRow>(
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

    res.json({ group: mapGroupRow(row) });
  } catch (err) {
    console.error('Groups error:', err);
    if (isDuplicateConstraintError(err)) {
      res.status(409).json({ error: 'Group name already exists' });
      return;
    }
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to update group'
    });
  }
};

export function registerPutIdRoute(routeRouter: RouterType): void {
  routeRouter.put('/:id', putIdHandler);
}
