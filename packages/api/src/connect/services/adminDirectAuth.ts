import { Code, ConnectError } from '@connectrpc/connect';
import { toConnectCode } from './httpStatusToConnectCode.js';
import { authenticate, resolveAdminAccess } from './legacyRouteProxyAuth.js';
import type { AdminAccessContext } from './legacyRouteProxyTypes.js';

export type ScopedAdminAccess = {
  sub: string;
  adminAccess: AdminAccessContext;
};

async function authenticateAndAuthorize(
  path: string,
  requestHeaders: Headers
): Promise<{
  sub: string;
  adminAccess: AdminAccessContext | null;
}> {
  const authResult = await authenticate(requestHeaders);
  if (!authResult.ok) {
    throw new ConnectError(authResult.error, toConnectCode(authResult.status));
  }

  const adminAccessResult = await resolveAdminAccess(path, authResult.session);
  if (!adminAccessResult.ok) {
    throw new ConnectError(
      adminAccessResult.error,
      toConnectCode(adminAccessResult.status)
    );
  }

  return {
    sub: authResult.claims.sub,
    adminAccess: adminAccessResult.adminAccess
  };
}

export async function requireAdminSession(
  path: string,
  requestHeaders: Headers
): Promise<{ sub: string }> {
  const authorization = await authenticateAndAuthorize(path, requestHeaders);
  return { sub: authorization.sub };
}

export async function requireScopedAdminAccess(
  path: string,
  requestHeaders: Headers
): Promise<ScopedAdminAccess> {
  const authorization = await authenticateAndAuthorize(path, requestHeaders);
  if (!authorization.adminAccess) {
    throw new ConnectError('Forbidden', Code.PermissionDenied);
  }

  return {
    sub: authorization.sub,
    adminAccess: authorization.adminAccess
  };
}
