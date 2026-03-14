import { Code, ConnectError } from '@connectrpc/connect';
import { getPostgresPool } from '../../lib/postgres.js';
import {
  authenticate,
  resolveOrganizationMembership,
  verifyOrganizationMembership
} from './connectRequestAuth.js';
import { toConnectCode } from './httpStatusToConnectCode.js';

export interface VfsClaims {
  sub: string;
  organizationId: string;
}

interface PersonalOrganizationRow {
  personal_organization_id: string | null;
}

function normalizeOrganizationId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function loadPersonalOrganizationId(
  userId: string
): Promise<string | null> {
  const pool = await getPostgresPool();
  const result = await pool.query<PersonalOrganizationRow>(
    `SELECT personal_organization_id
       FROM users
      WHERE id = $1
      LIMIT 1`,
    [userId]
  );

  return normalizeOrganizationId(result.rows[0]?.personal_organization_id);
}

async function resolveVfsOrganizationId(
  methodPath: string,
  headers: Headers,
  userId: string,
  options: {
    requireDeclaredOrganization?: boolean;
    declaredOrganizationId?: string | null;
  }
): Promise<string> {
  const membershipResult = await resolveOrganizationMembership(
    methodPath,
    headers,
    userId
  );
  if (!membershipResult.ok) {
    throw new ConnectError(
      membershipResult.error,
      toConnectCode(membershipResult.status)
    );
  }

  const headerOrganizationId = normalizeOrganizationId(
    membershipResult.organizationId
  );
  const declaredOrganizationId = normalizeOrganizationId(
    options.declaredOrganizationId
  );

  if (!declaredOrganizationId) {
    if (options.requireDeclaredOrganization) {
      throw new ConnectError(
        'organizationId is required in request body for VFS write requests',
        Code.InvalidArgument
      );
    }
  } else {
    if (
      headerOrganizationId !== null &&
      headerOrganizationId !== declaredOrganizationId
    ) {
      throw new ConnectError(
        'organizationId in request must match X-Organization-Id header',
        Code.InvalidArgument
      );
    }

    const declaredMembershipResult = await verifyOrganizationMembership(
      userId,
      declaredOrganizationId
    );
    if (!declaredMembershipResult.ok) {
      throw new ConnectError(
        declaredMembershipResult.error,
        toConnectCode(declaredMembershipResult.status)
      );
    }

    return declaredOrganizationId;
  }

  if (headerOrganizationId !== null) {
    return headerOrganizationId;
  }

  const personalOrganizationId = await loadPersonalOrganizationId(userId);
  if (personalOrganizationId !== null) {
    return personalOrganizationId;
  }

  throw new ConnectError(
    'Organization context is required for VFS access',
    Code.PermissionDenied
  );
}

export async function requireVfsClaims(
  methodPath: string,
  headers: Headers,
  options: {
    requireDeclaredOrganization?: boolean;
    declaredOrganizationId?: string | null;
  } = {}
): Promise<VfsClaims> {
  const authResult = await authenticate(headers);
  if (!authResult.ok) {
    throw new ConnectError(authResult.error, toConnectCode(authResult.status));
  }

  const organizationId = await resolveVfsOrganizationId(
    methodPath,
    headers,
    authResult.claims.sub,
    options
  );

  return {
    sub: authResult.claims.sub,
    organizationId
  };
}
