import { Code, ConnectError, type HandlerContext } from '@connectrpc/connect';
import type {
  DeleteSessionRequest,
  GetOrganizationsRequest,
  GetSessionsRequest,
  LogoutRequest
} from '@tearleads/shared/gen/tearleads/v1/auth_pb';
import { getPostgresPool } from '../../../lib/postgres.js';
import {
  deleteSession as deleteStoredSession,
  getSessionsByUserId
} from '../../../lib/sessions.js';
import { getRequiredConnectAuthContext } from '../../context.js';
import {
  getAuthContextOrThrow,
  parseRequiredSessionId,
  toOptionalTimestamp,
  toRequiredTimestamp
} from './shared.js';

export async function getSessionsHandler(
  _request: GetSessionsRequest,
  context: HandlerContext
) {
  const authContext = getAuthContextOrThrow({
    values: getRequiredConnectAuthContext(context)
  });

  try {
    const sessions = await getSessionsByUserId(authContext.claims.sub);
    return {
      sessions: sessions.map((session) => {
        const lastActiveAt = toOptionalTimestamp(session.lastActiveAt);
        return {
          id: session.id,
          createdAt: toRequiredTimestamp(session.createdAt),
          ...(lastActiveAt ? { lastActiveAt } : {}),
          isCurrent: session.id === authContext.claims.jti,
          isAdmin: session.admin,
          ipAddress: session.ipAddress
        };
      })
    };
  } catch (error) {
    console.error('Failed to list sessions', error);
    throw new ConnectError('Failed to list sessions', Code.Internal);
  }
}

export async function deleteSessionHandler(
  request: DeleteSessionRequest,
  context: HandlerContext
) {
  const authContext = getAuthContextOrThrow({
    values: getRequiredConnectAuthContext(context)
  });

  const sessionId = parseRequiredSessionId(request);
  if (sessionId === authContext.claims.jti) {
    throw new ConnectError(
      'Cannot delete current session',
      Code.PermissionDenied
    );
  }

  try {
    const deleted = await deleteStoredSession(
      sessionId,
      authContext.claims.sub
    );
    if (!deleted) {
      throw new ConnectError('Session not found', Code.NotFound);
    }
    return {
      deleted: true
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to delete session', error);
    throw new ConnectError('Failed to delete session', Code.Internal);
  }
}

export async function logout(_request: LogoutRequest, context: HandlerContext) {
  const authContext = getAuthContextOrThrow({
    values: getRequiredConnectAuthContext(context)
  });

  try {
    await deleteStoredSession(authContext.claims.jti, authContext.claims.sub);
    return {
      loggedOut: true
    };
  } catch (error) {
    console.error('Failed to logout session', error);
    throw new ConnectError('Failed to logout', Code.Internal);
  }
}

export async function getOrganizations(
  _request: GetOrganizationsRequest,
  context: HandlerContext
) {
  const authContext = getAuthContextOrThrow({
    values: getRequiredConnectAuthContext(context)
  });

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
      [authContext.claims.sub]
    );

    const personalOrgResult = await pool.query<{
      personal_organization_id: string;
    }>('SELECT personal_organization_id FROM users WHERE id = $1 LIMIT 1', [
      authContext.claims.sub
    ]);

    const personalOrganizationId =
      personalOrgResult.rows[0]?.personal_organization_id;
    if (!personalOrganizationId) {
      throw new ConnectError(
        'User personal organization ID not found',
        Code.Internal
      );
    }

    return {
      organizations: orgsResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        isPersonal: row.is_personal
      })),
      personalOrganizationId
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to list organizations', error);
    throw new ConnectError('Failed to list organizations', Code.Internal);
  }
}
