import { isValidOrganizationLeaveRequest } from "@tearleads/crypto";
import type { TrustedUserIdentityResolver } from "../../../data/trustedUserIdentity";
import type {
  OrganizationDirectoryAndGroups,
  OrganizationDirectoryUser,
  OrganizationUserDetail,
} from "../readModel";

/**
 * The user as shown, with its leave request kept only when the member signed
 * it. Every directory user a client presents passes through here, whether a
 * read model or a mutation response carried it.
 */
export async function withVerifiedDirectoryUser(
  organizationId: string,
  user: OrganizationDirectoryUser,
  resolveTrustedUserIdentity: TrustedUserIdentityResolver,
): Promise<OrganizationDirectoryUser> {
  const request = user.leaveRequest;
  if (!request) return user;
  // The member's pinned identity, never the key the directory served beside
  // the request: a server that could swap both could forge any member's ask.
  const identity = await resolveTrustedUserIdentity(user.userId).catch(
    () => null,
  );
  const verified =
    identity !== null &&
    request.organizationId === organizationId &&
    request.userId === user.userId &&
    isValidOrganizationLeaveRequest(request, identity.signingPublicKey);
  return verified ? user : { ...user, leaveRequest: null };
}

/**
 * Keeps only leave requests their member signed, checked against the member's
 * trusted identity; any other is shown as no request at all.
 */
export async function withVerifiedLeaveRequests<
  Result extends OrganizationDirectoryAndGroups | null | undefined,
>(
  result: Result,
  resolveTrustedUserIdentity: TrustedUserIdentityResolver,
): Promise<Result> {
  if (!result?.directory.users.some((user) => user.leaveRequest)) {
    return result;
  }
  const { organizationId } = result.directory;
  return {
    ...result,
    directory: {
      ...result.directory,
      users: await Promise.all(
        result.directory.users.map((user) =>
          withVerifiedDirectoryUser(
            organizationId,
            user,
            resolveTrustedUserIdentity,
          ),
        ),
      ),
    },
  };
}

/** The user detail counterpart of withVerifiedLeaveRequests. */
export async function withVerifiedUserLeaveRequest(
  detail: OrganizationUserDetail | null,
  organizationId: string,
  resolveTrustedUserIdentity: TrustedUserIdentityResolver,
): Promise<OrganizationUserDetail | null> {
  if (!detail?.user.leaveRequest) return detail;
  return {
    ...detail,
    user: await withVerifiedDirectoryUser(
      organizationId,
      detail.user,
      resolveTrustedUserIdentity,
    ),
  };
}
