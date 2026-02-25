import type {
  Organization,
  OrganizationsListResponse
} from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPool } from '../../../lib/postgres.js';
import {
  ensureOrganizationAccess,
  parseOrganizationIdQuery
} from '../../../middleware/adminAccess.js';
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
export const getRootHandler = async (req: Request, res: Response) => {
  try {
    const access = req.adminAccess;
    if (!access) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const requestedOrganizationId = parseOrganizationIdQuery(req, res);
    if (requestedOrganizationId === undefined) {
      return;
    }
    if (
      requestedOrganizationId &&
      !ensureOrganizationAccess(req, res, requestedOrganizationId)
    ) {
      return;
    }

    const pool = await getPool('read');
    const result =
      access.isRootAdmin && !requestedOrganizationId
        ? await pool.query<OrganizationRow>(
            `SELECT id, name, description, created_at, updated_at
             FROM organizations
             ORDER BY name`
          )
        : await pool.query<OrganizationRow>(
            `SELECT id, name, description, created_at, updated_at
           FROM organizations
           WHERE id = ANY($1::text[])
           ORDER BY name`,
            [
              requestedOrganizationId
                ? [requestedOrganizationId]
                : access.organizationIds
            ]
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
