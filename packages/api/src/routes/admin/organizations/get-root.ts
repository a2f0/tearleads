import type {
  Organization,
  OrganizationsListResponse
} from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../../lib/postgres.js';
import { mapOrganizationRow, type OrganizationRow } from './shared.js';

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

export function registerGetRootRoute(routeRouter: RouterType): void {
  routeRouter.get('/', getRootHandler);
}
