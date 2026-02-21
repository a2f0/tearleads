import type {
  OrganizationResponse,
  UpdateOrganizationRequest
} from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../../lib/postgres.js';
import { requireRootAdmin } from '../../../middleware/adminAccess.js';
import { isDuplicateConstraintError } from '../lib/db.js';
import { mapOrganizationRow, type OrganizationRow } from './shared.js';

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
const putIdHandler = async (
  req: Request<{ id: string }, unknown, UpdateOrganizationRequest>,
  res: Response
) => {
  if (!requireRootAdmin(req, res)) {
    return;
  }

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

export function registerPutIdRoute(routeRouter: RouterType): void {
  routeRouter.put('/:id', putIdHandler);
}
