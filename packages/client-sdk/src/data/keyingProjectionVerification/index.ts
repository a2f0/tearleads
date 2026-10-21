import { requireTrustedUserIdentityResolver } from "../trustedUserIdentity";
import type { ProjectionUserKeyResolver } from "./types";

export { resolveEventContainerPaths } from "./document/documentDependencyPaths";
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

export { verifiedContainerCreateManifest } from "./container/containerCreateManifest";
export { verifyContainerDestinationProjection } from "./container/containerDestinationVerification";
export {
  collectContainerWriterProjectionPrincipalPolicies,
  verifyContainerWriterProjection,
} from "./container/containerProjectionVerification";
export {
  type DocumentWriterProjectionAuthorization,
  verifyDocumentWriterProjection,
  verifyDocumentWriterProjectionAuthorization,
} from "./document/documentProjectionVerification";
export {
  verifyDocumentPurgeProof,
  verifyDocumentPurgeProofBaseline,
} from "./documentPurge/documentPurgeProofVerification";
export { mergeProjectionPolicyEvidence } from "./principalPolicy/mergeProjectionPolicyEvidence";
export { isPrincipalPolicyNotCachedError } from "./principalPolicy/principalPolicyVerification";
