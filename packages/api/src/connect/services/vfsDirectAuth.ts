import { Code, ConnectError } from '@connectrpc/connect';
import { getPostgresPool } from '../../lib/postgres.js';
import {
  authenticate,
  resolveOrganizationMembership,
  verifyOrganizationMembership
} from './connectRequestAuth.js';
import { toConnectCode } from './httpStatusToConnectCode.js';

async function resolveRequiredOrganizationId(
  userId: string,
  resolvedOrganizationId: string | null,
  requireDeclaredOrganization: boolean,
  declaredOrganizationId?: string | null
): Promise<string> {
  if (
    declaredOrganizationId &&
    resolvedOrganizationId &&
    declaredOrganizationId !== resolvedOrganizationId
  ) {
    throw new ConnectError(
      'organizationId in request must match X-Organization-Id header',
      Code.InvalidArgument
    );
  }

  if (declaredOrganizationId) {
    const membershipResult = await verifyOrganizationMembership(
      userId,
      declaredOrganizationId
    );
    if (!membershipResult.ok) {
      throw new ConnectError(
        membershipResult.error,
        toConnectCode(membershipResult.status)
      );
    }

    return membershipResult.organizationId ?? declaredOrganizationId;
  }

  if (resolvedOrganizationId) {
    return resolvedOrganizationId;
  }

  if (requireDeclaredOrganization) {
    throw new ConnectError(
      'organizationId is required in request body for VFS write requests',
      Code.InvalidArgument
    );
  }

  const pool = await getPostgresPool();
  const result = await pool.query<{ personal_organization_id: string | null }>(
    `SELECT personal_organization_id
       FROM users
      WHERE id = $1::uuid
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
  requestHeaders: Headers,
  options?: {
    requireDeclaredOrganization?: boolean;
    declaredOrganizationId?: string | null;
  }
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
    membershipResult.organizationId,
    options?.requireDeclaredOrganization === true,
    options?.declaredOrganizationId
  );

  return {
    sub: authResult.claims.sub,
    organizationId
  };
}
