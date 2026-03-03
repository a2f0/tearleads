import { Code, ConnectError } from '@connectrpc/connect';
import { getPostgresPool } from '../../lib/postgres.js';
import { toConnectCode } from './httpStatusToConnectCode.js';
import {
  authenticate,
  resolveOrganizationMembership
} from './legacyRouteProxyAuth.js';

async function resolveRequiredOrganizationId(
  userId: string,
  resolvedOrganizationId: string | null
): Promise<string> {
  if (resolvedOrganizationId) {
    return resolvedOrganizationId;
  }

  const pool = await getPostgresPool();
  const result = await pool.query<{ personal_organization_id: string | null }>(
    `SELECT personal_organization_id
       FROM users
      WHERE id = $1
      LIMIT 1`,
    [userId]
  );
  const personalOrganizationId = result.rows[0]?.personal_organization_id;
  if (
    typeof personalOrganizationId !== 'string' ||
    personalOrganizationId.trim().length === 0
  ) {
    throw new ConnectError(
      'Organization context is required for VFS access',
      Code.PermissionDenied
    );
  }

  return personalOrganizationId;
}

export async function requireVfsClaims(
  path: string,
  requestHeaders: Headers
): Promise<{ sub: string; organizationId: string }> {
  const authResult = await authenticate(requestHeaders);
  if (!authResult.ok) {
    throw new ConnectError(authResult.error, toConnectCode(authResult.status));
  }

  const membershipResult = await resolveOrganizationMembership(
    path,
    requestHeaders,
    authResult.claims.sub
  );
  if (!membershipResult.ok) {
    throw new ConnectError(
      membershipResult.error,
      toConnectCode(membershipResult.status)
    );
  }

  const organizationId = await resolveRequiredOrganizationId(
    authResult.claims.sub,
    membershipResult.organizationId
  );

  return {
    sub: authResult.claims.sub,
    organizationId
  };
}
