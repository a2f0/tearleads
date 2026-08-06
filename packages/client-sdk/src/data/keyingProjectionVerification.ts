import { KeyingVerificationError } from "@tearleads/crypto";
import type { ProjectionUserKeyResolver } from "./keyingProjectionVerification/types";
import { isTrustedUserIdentity } from "./trustedUserIdentity/types";

export type {
  PrincipalPolicyCache,
  ProjectionUserKey,
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "./keyingProjectionVerification/types";

export function requireProjectionUserKeyResolver(
  resolveProjectionUserKey: ProjectionUserKeyResolver | null | undefined,
  label: string,
): ProjectionUserKeyResolver {
  if (!resolveProjectionUserKey) {
    throw new Error(`${label} requires projection key verification`);
  }

  return async (userId) => {
    const userKey = await resolveProjectionUserKey(userId);
    if (!userKey) {
      return null;
    }
    if (!isTrustedUserIdentity(userKey)) {
      throw new KeyingVerificationError(
        "invalid_shape",
        `${label} received an untrusted projection identity`,
      );
    }
    if (userKey.userId !== userId) {
      throw new KeyingVerificationError(
        "object_mismatch",
        `${label} received a projection identity for another user`,
      );
    }
    return userKey;
  };
}

export {
  collectContainerWriterProjectionPrincipalPolicies,
  verifyContainerWriterProjection,
} from "./keyingProjectionVerification/containerProjectionVerification";
export { verifyDocumentWriterProjection } from "./keyingProjectionVerification/documentProjectionVerification";
