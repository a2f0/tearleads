import type { ProjectionUserKeyResolver } from "./keyingProjectionVerification/types";
import { requireTrustedUserIdentityResolver } from "./trustedUserIdentity/requiredResolver";

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

  // A ProjectionUserKey is a TrustedUserIdentity, so the shared adapter
  // provides the untrusted-shape and wrong-user guards (with identity caching).
  return requireTrustedUserIdentityResolver(resolveProjectionUserKey);
}

export {
  collectContainerWriterProjectionPrincipalPolicies,
  verifyContainerWriterProjection,
} from "./keyingProjectionVerification/containerProjectionVerification";
export { verifyDocumentWriterProjection } from "./keyingProjectionVerification/documentProjectionVerification";
