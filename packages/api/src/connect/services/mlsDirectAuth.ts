import { ConnectError } from '@connectrpc/connect';
import { toConnectCode } from './httpStatusToConnectCode.js';
import {
  authenticate,
  resolveOrganizationMembership
} from './connectRequestAuth.js';

export async function requireMlsClaims(
  path: string,
  requestHeaders: Headers
): Promise<{ sub: string }> {
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

  return {
    sub: authResult.claims.sub
  };
}
