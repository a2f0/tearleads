import { requireTrustedUserIdentityResolver } from "../trustedUserIdentity/requiredResolver";
import type { ProjectionUserKeyResolver } from "./types";

export { resolveEventContainerPaths } from "./documentDependencyPaths";
export {
  readAccessEvent,
  readRecordString,
  readRequiredRecordValue,
} from "./readers";

export type {
  PrincipalPolicyCache,
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "./types";
export {
  isProjectionVerificationCancelledError,
  nullOnProjectionVerificationCancellation,
} from "./types";

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
} from "./containerProjectionVerification";
export {
  type DocumentWriterProjectionAuthorization,
  verifyDocumentWriterProjection,
  verifyDocumentWriterProjectionAuthorization,
} from "./documentProjectionVerification";
export {
  verifyDocumentPurgeProof,
  verifyDocumentPurgeProofBaseline,
} from "./documentPurgeProofVerification";
