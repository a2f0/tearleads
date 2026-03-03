import { verifyJwt } from '../../lib/jwt.js';
import { getPostgresPool } from '../../lib/postgres.js';
import type { SessionData } from '../../lib/sessions.js';
import { getSession, updateSessionActivity } from '../../lib/sessions.js';
import type {
  AdminAccessResult,
  AuthResult,
  OrganizationMembershipResult
} from './connectRequestAuthTypes.js';

const AUTH_HEADER_PREFIX = 'Bearer ';
const MAX_ORG_ID_LENGTH = 100;
const ORG_ID_PATTERN = /^[a-zA-Z0-9-]+$/u;

function extractBearerToken(authorizationHeader: string | null): string | null {
  if (
    !authorizationHeader ||
    !authorizationHeader.startsWith(AUTH_HEADER_PREFIX)
  ) {
    return null;
  }

  const token = authorizationHeader.slice(AUTH_HEADER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

export async function authenticate(
  requestHeaders: Headers
): Promise<AuthResult> {
  const token = extractBearerToken(requestHeaders.get('authorization'));
  if (!token) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) {
    return { ok: false, status: 500, error: 'Failed to authenticate' };
  }

  const claims = verifyJwt(token, jwtSecret);
  if (!claims) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  try {
    const session = await getSession(claims.jti);
    if (!session || session.userId !== claims.sub) {
      return { ok: false, status: 401, error: 'Unauthorized' };
    }

    void updateSessionActivity(claims.jti).catch((error: unknown) => {
      console.error('Failed to update session activity', error);
    });

    return {
      ok: true,
      claims,
      session
    };
  } catch (error) {
    console.error('Failed to authenticate request', error);
    return {
      ok: false,
      status: 500,
      error: 'Failed to authenticate'
    };
  }
}

function isAdminSessionPath(path: string): boolean {
  return path.startsWith('/admin/postgres') || path.startsWith('/admin/redis');
}

function isAdminAccessPath(path: string): boolean {
  return (
    path.startsWith('/admin/context') ||
    path.startsWith('/admin/groups') ||
    path.startsWith('/admin/organizations') ||
    path.startsWith('/admin/users')
  );
}

export async function resolveOrganizationMembership(
  path: string,
  requestHeaders: Headers,
  userId: string
): Promise<OrganizationMembershipResult> {
  if (path.startsWith('/admin/')) {
    return {
      ok: true,
      organizationId: null
    };
  }

  const organizationIdHeader = requestHeaders.get('x-organization-id');
  if (!organizationIdHeader) {
    return {
      ok: true,
      organizationId: null
    };
  }

  if (
    organizationIdHeader.length > MAX_ORG_ID_LENGTH ||
    !ORG_ID_PATTERN.test(organizationIdHeader)
  ) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid X-Organization-Id format'
    };
  }

  try {
    const pool = await getPostgresPool();
    const result = await pool.query<{ organization_id: string }>(
      `SELECT organization_id
         FROM user_organizations
         WHERE user_id = $1
           AND organization_id = $2`,
      [userId, organizationIdHeader]
    );

    if (result.rows.length === 0) {
      return {
        ok: false,
        status: 403,
        error: 'Not a member of the specified organization'
      };
    }

    return {
      ok: true,
      organizationId: organizationIdHeader
    };
  } catch (error) {
    console.error('Failed to verify organization membership', error);
    return {
      ok: false,
      status: 500,
      error: 'Failed to verify organization membership'
    };
  }
}

export async function resolveAdminAccess(
  path: string,
  session: SessionData
): Promise<AdminAccessResult> {
  if (isAdminSessionPath(path)) {
    if (!session.admin) {
      return {
        ok: false,
        status: 403,
        error: 'Forbidden'
      };
    }

    return {
      ok: true,
      adminAccess: null
    };
  }

  if (!isAdminAccessPath(path)) {
    return {
      ok: true,
      adminAccess: null
    };
  }

  if (session.admin) {
    return {
      ok: true,
      adminAccess: {
        isRootAdmin: true,
        organizationIds: []
      }
    };
  }

  try {
    const pool = await getPostgresPool();
    const result = await pool.query<{ organization_id: string }>(
      `SELECT organization_id
         FROM user_organizations
         WHERE user_id = $1
           AND is_admin = TRUE
         ORDER BY organization_id`,
      [session.userId]
    );

    const organizationIds = result.rows.map((row) => row.organization_id);
    if (organizationIds.length === 0) {
      return {
        ok: false,
        status: 403,
        error: 'Forbidden'
      };
    }

    return {
      ok: true,
      adminAccess: {
        isRootAdmin: false,
        organizationIds
      }
    };
  } catch (error) {
    console.error('Failed to authorize admin access', error);
    return {
      ok: false,
      status: 500,
      error: 'Failed to authorize admin access'
    };
  }
}
