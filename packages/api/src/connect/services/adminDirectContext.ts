import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import type { AdminGetContextResponse } from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import { AdminGetContextResponseSchema } from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import { getPool } from '../../lib/postgres.js';
import { requireScopedAdminAccess } from './adminDirectAuth.js';

type AdminScopeOrganizationInit = {
  id: string;
  name: string;
};

async function loadOrganizationsForRoot(): Promise<
  AdminScopeOrganizationInit[]
> {
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
): Promise<AdminScopeOrganizationInit[]> {
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
): Promise<AdminGetContextResponse> {
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

    const defaultOrganizationId = authorization.adminAccess.isRootAdmin
      ? undefined
      : organizations[0]?.id;

    return create(AdminGetContextResponseSchema, {
      isRootAdmin: authorization.adminAccess.isRootAdmin,
      organizations,
      ...(typeof defaultOrganizationId === 'string'
        ? { defaultOrganizationId }
        : {})
    });
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Admin context error:', error);
    throw new ConnectError('Failed to load admin context', Code.Internal);
  }
}
