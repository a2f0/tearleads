import type { PrincipalProjectionMemberRequest } from "@tearleads/validators/request";
import {
  requireTrustedUserIdentityResolver,
  type TrustedUserIdentity,
  type TrustedUserIdentityResolver,
} from "../../data/trustedUserIdentity";

export function projectionUserIds(
  projection: ReadonlyArray<PrincipalProjectionMemberRequest>,
): string[] {
  return projection.map((member) => member.userId);
}

export async function resolveRequiredUserIdentities(input: {
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly userIds: readonly string[];
}): Promise<TrustedUserIdentity[]> {
  const resolveTrustedUserIdentity = requireTrustedUserIdentityResolver(
    input.resolveTrustedUserIdentity,
  );
  const userIds = [...new Set(input.userIds)];
  const identities = await Promise.all(
    userIds.map((userId) => resolveTrustedUserIdentity(userId)),
  );
  return identities.map((identity, index) => {
    if (!identity) {
      throw new Error(
        `User identity could not be loaded for ${userIds[index]}`,
      );
    }
    return identity;
  });
}
