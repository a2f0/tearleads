import type { OrganizationResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPool } from '../../../lib/postgres.js';
import { ensureOrganizationAccess } from '../../../middleware/adminAccess.js';
import { mapOrganizationRow, type OrganizationRow } from './shared.js';

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
const getIdHandler = async (req: Request<{ id: string }>, res: Response) => {
  try {
    if (!ensureOrganizationAccess(req, res, req.params['id'])) {
      return;
    }

    const pool = await getPool('read');
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

export function registerGetIdRoute(routeRouter: RouterType): void {
  routeRouter.get('/:id', getIdHandler);
}
