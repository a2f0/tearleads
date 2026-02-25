import type {
  AdminAccessContextResponse,
  AdminScopeOrganization
} from '@tearleads/shared';
import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';
import { getPool } from '../../lib/postgres.js';

async function loadOrganizationsForRoot(): Promise<AdminScopeOrganization[]> {
  const pool = await getPool('read');
  const result = await pool.query<{ id: string; name: string }>(
    `SELECT id, name
       FROM organizations
       ORDER BY name`
  );
  return result.rows.map((row) => ({ id: row.id, name: row.name }));
}

async function loadOrganizationsForOrgAdmin(
  userId: string
): Promise<AdminScopeOrganization[]> {
  const pool = await getPool('read');
  const result = await pool.query<{ id: string; name: string }>(
    `SELECT o.id, o.name
       FROM user_organizations uo
       INNER JOIN organizations o ON o.id = uo.organization_id
       WHERE uo.user_id = $1
         AND uo.is_admin = TRUE
       ORDER BY o.name`,
    [userId]
  );
  return result.rows.map((row) => ({ id: row.id, name: row.name }));
}

export const adminContextRouter: RouterType = Router();

adminContextRouter.get('/', async (req: Request, res: Response) => {
  const access = req.adminAccess;
  const claims = req.authClaims;
  if (!access || !claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const organizations = access.isRootAdmin
      ? await loadOrganizationsForRoot()
      : await loadOrganizationsForOrgAdmin(claims.sub);

    const response: AdminAccessContextResponse = {
      isRootAdmin: access.isRootAdmin,
      organizations,
      defaultOrganizationId: access.isRootAdmin
        ? null
        : (organizations[0]?.id ?? null)
    };
    res.json(response);
  } catch (error) {
    console.error('Admin context error:', error);
    res.status(500).json({
      error:
        error instanceof Error ? error.message : 'Failed to load admin context'
    });
  }
});
