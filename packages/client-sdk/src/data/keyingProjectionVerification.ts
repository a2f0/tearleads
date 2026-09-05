import type { ProjectionUserKeyResolver } from "./keyingProjectionVerification/types";
import { requireTrustedUserIdentityResolver } from "./trustedUserIdentity/requiredResolver";

export { resolveEventContainerPaths } from "./keyingProjectionVerification/documentDependencyPaths";
export {
  readAccessEvent,
  readRecordString,
  readRequiredRecordValue,
} from "./keyingProjectionVerification/readers";

export type {
  PrincipalPolicyBundleCacheRequest,
  PrincipalPolicyCache,
  ProjectionUserKey,
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "./keyingProjectionVerification/types";
export {
  isProjectionVerificationCancelledError,
  nullOnProjectionVerificationCancellation,
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
export {
  type DocumentWriterProjectionAuthorization,
  verifyDocumentWriterProjection,
  verifyDocumentWriterProjectionAuthorization,
} from "./keyingProjectionVerification/documentProjectionVerification";
export {
  verifyDocumentPurgeProof,
  verifyDocumentPurgeProofBaseline,
} from "./keyingProjectionVerification/documentPurgeProofVerification";
