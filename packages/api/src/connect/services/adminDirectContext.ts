import { Code, ConnectError } from '@connectrpc/connect';
import type {
  AdminAccessContextResponse,
  AdminScopeOrganization
} from '@tearleads/shared';
import { getPool } from '../../lib/postgres.js';
import { requireScopedAdminAccess } from './adminDirectAuth.js';

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

export async function getContextDirect(
  _request: object,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const authorization = await requireScopedAdminAccess(
    '/admin/context',
    context.requestHeader
  );

  try {
    const organizations = authorization.adminAccess.isRootAdmin
      ? await loadOrganizationsForRoot()
      : await loadOrganizationsForOrgAdmin(authorization.sub);

    const response: AdminAccessContextResponse = {
      isRootAdmin: authorization.adminAccess.isRootAdmin,
      organizations,
      defaultOrganizationId: authorization.adminAccess.isRootAdmin
        ? null
        : (organizations[0]?.id ?? null)
    };

    return {
      json: JSON.stringify(response)
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Admin context error:', error);
    throw new ConnectError('Failed to load admin context', Code.Internal);
  }
}
