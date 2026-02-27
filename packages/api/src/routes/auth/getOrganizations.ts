import type { UserOrganization } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPostgresPool } from '../../lib/postgres.js';

/**
 * @openapi
 * /auth/organizations:
 *   get:
 *     summary: List the authenticated user's organizations
 *     description: Returns all organizations the user belongs to, plus their personal org ID.
 *     tags:
 *       - Auth
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of organizations
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
const getOrganizationsHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const pool = await getPostgresPool();

    const orgsResult = await pool.query<{
      id: string;
      name: string;
      is_personal: boolean;
    }>(
      `SELECT o.id, o.name, o.is_personal
       FROM user_organizations uo
       JOIN organizations o ON o.id = uo.organization_id
       WHERE uo.user_id = $1
       ORDER BY o.created_at`,
      [claims.sub]
    );

    const personalOrgResult = await pool.query<{
      personal_organization_id: string;
    }>('SELECT personal_organization_id FROM users WHERE id = $1 LIMIT 1', [
      claims.sub
    ]);

    const personalOrganizationId =
      personalOrgResult.rows[0]?.personal_organization_id;
    if (!personalOrganizationId) {
      res
        .status(500)
        .json({ error: 'User personal organization ID not found' });
      return;
    }

    const organizations: UserOrganization[] = orgsResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      isPersonal: row.is_personal
    }));

    res.json({ organizations, personalOrganizationId });
  } catch (error) {
    console.error('Failed to list organizations:', error);
    res.status(500).json({ error: 'Failed to list organizations' });
  }
};

export function registerGetOrganizationsRoute(authRouter: RouterType): void {
  authRouter.get('/organizations', getOrganizationsHandler);
}
