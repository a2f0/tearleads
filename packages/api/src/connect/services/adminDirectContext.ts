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
  organizationIds: string[]
): Promise<AdminScopeOrganization[]> {
  if (organizationIds.length === 0) {
    return [];
  }

  const pool = await getPool('read');
  const result = await pool.query<{ id: string; name: string }>(
    `SELECT id, name
       FROM organizations
       WHERE id = ANY($1::text[])
       ORDER BY name`,
    [organizationIds]
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
      : await loadOrganizationsForOrgAdmin(
          authorization.adminAccess.organizationIds
        );

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
