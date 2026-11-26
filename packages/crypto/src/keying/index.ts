// Write-time sanity cap on lifetime rotations. Sized to be unreachable by
// legitimate use; it exists to stop runaway rotation loops and to give the
// keyring length equation a hard ceiling, not to budget rotations. Defined
// with the wire arithmetic in @tearleads/validators so every layer shares
// one equation.
export { MAX_CONTAINER_KEY_EPOCH } from "@tearleads/validators/util";
export * from "./access/accessEvent";
export * from "./access/accessEventTypes";
export * from "./access/accessManifestSnapshot";
export * from "./access/accessManifestTypes";
export { ACCESS_MANIFEST_VERIFICATION_REVISION } from "./access/accessManifestVerificationRevision";
export * from "./access/accessManifestVerificationTypes";
export * from "./access/checkpoints";
export * from "./access/checkpointTypes";
export { prepareHeldProjectionCitations } from "./access/heldProjectionCitations";
export * from "./containerAccess/containerAccess";
export { MAX_CONTAINER_RECITATION_EPOCH } from "./containerAccess/containerAccessReciteBody";
export * from "./containerAccess/containerAccessTypes";
export { verifyContainerParentEdge } from "./containerAccess/containerParentEdge";
export { resolveContainerStatePathUserAccessLevel } from "./containerAccess/containerPathAccess";
export { computeBlobAccessManifestHash } from "./containerKek/blobAccessManifest";
export {
  computeBlobContentKeyTargetHash,
  deriveBlobKekTargets,
} from "./containerKek/blobKeyTargets";
export * from "./containerKek/containerKek";
export {
  assertSealedContainerKekKeyringLength,
  CONTAINER_KEK_KEYRING_ENTRY_BYTES,
  CONTAINER_KEK_KEYRING_FORMAT_VERSION,
  CONTAINER_KEK_KEYRING_HEADER_BYTES,
  computeContainerKekKeyringHash,
  expectedSealedContainerKekKeyringBytes,
  normalizeContainerKekKeyring,
  openContainerKekKeyring,
  sealContainerKekKeyring,
  verifyContainerKekKeyringEntry,
} from "./containerKek/containerKekKeyring";
export {
  computeContainerKekMaterialId,
  isContainerKekMaterialId,
} from "./containerKek/containerKekMaterial";
export {
  computeContainerKekPredecessorBridgeHash,
  createContainerKekPredecessorBridge,
  normalizeContainerKekPredecessorBridge,
  unwrapContainerKekPredecessorBridge,
} from "./containerKek/containerKekPredecessor";
export * from "./containerKek/containerKekTypes";
export {
  deriveContainerKekWrappingPublicKey,
  unwrapContainerKekParentWrap,
} from "./containerKek/containerKekWrapping";
export * from "./containerKek/contentKeyTargetTypes";
export {
  computeDocumentContentKeyTargetHash,
  deriveDocumentKekTargets,
} from "./containerKek/documentKeyTargets";
export {
  computeContainerKekRecipientTargetHash,
  deriveContainerKekRecipientTargets,
  derivePrincipalRecipientKeyEpochId,
} from "./containerKek/recipientTargets";
export {
  computeDocumentBaselineSegmentsDigest,
  type DocumentBaselineSegmentDigestEntry,
  extendDocumentBaselineSegmentsDigest,
  startDocumentBaselineSegmentsDigest,
} from "./core/baselineSegmentsDigest";
export * from "./core/canonical";
export {
  computeAccessManifestBundleDigest,
  computeContainerKekLevelDigest,
  isKeyingCanonicalJson,
  readKeyingCanonicalJson,
} from "./core/canonicalJsonGuard";
export * from "./core/canonicalJsonTypes";
export type { KeyingHashDomain } from "./core/keyingHashDomains";
export {
  isKeyingVerificationCode,
  KEYING_VERIFICATION_CODES,
  type KeyingVerificationCode,
  KeyingVerificationError,
  type KeyingVerificationResult,
} from "./core/verificationError";
export {
  normalizeAttachmentAccessEventBody,
  verifyAttachmentBindingEvent,
  verifyAttachmentDetachEvent,
} from "./documentAccess/attachmentAccessEvent";
export * from "./documentAccess/attachmentAccessTypes";
export * from "./documentAccess/documentAccess";
export { normalizeDocumentAccessEventBody } from "./documentAccess/documentAccessBody";
export * from "./documentAccess/documentAccessTypes";
export {
  computeDocumentLinkSetGrantRoot,
  computeDocumentLinkSetKeyTargetHash,
  computeDocumentLinkSetStructuralHash,
  deriveDocumentLinkSetManifest,
} from "./documentAccess/documentLinkSetManifest";
export {
  type DocumentPurgeAccessEventBody,
  normalizeDocumentPurgeAccessEventBody,
  type VerifyDocumentPurgeEventInput,
  verifyDocumentPurgeEvent,
} from "./documentAccess/documentPurge";
export * from "./principalPolicy/principalPolicy";
export type {
  PrincipalPolicyExternalAuthority,
  PrincipalPolicyExternalAuthorityState,
} from "./principalPolicy/principalPolicyExternalAuthorityTypes";
export {
  selectPrincipalPolicyAuthorization,
  type VerifiedPrincipalPolicySelection,
} from "./principalPolicy/principalPolicySelection";
export type {
  PrincipalPolicyTransitionMismatch,
  PrincipalPolicyTransitionMismatchCode,
} from "./principalPolicy/principalPolicyTransition";
export {
  getPrincipalPolicyTransitionMismatch,
  getPrincipalPolicyTransitionMismatchReason,
} from "./principalPolicy/principalPolicyTransition";
export type {
  AnyVerifiedPrincipalPolicy,
  ManagedPrincipalKind,
  PrincipalPolicyAuthorization,
  PrincipalPolicyBundle,
  PrincipalPolicyCheckpoint,
  PrincipalPolicyMemberEnvelopes,
  PrincipalPolicyPayload,
  PrincipalPolicySignedState,
  PrincipalPolicySignerPublicKey,
  PrincipalPolicySnapshot,
  PrincipalPolicyStateChainEntry,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicy,
  VerifiedPrincipalPolicySnapshot,
  VerifyPrincipalPolicyBundleInput,
  VerifyPrincipalPolicySnapshotInput,
} from "./principalPolicy/principalPolicyTypes";
export { makeVerifiedPrincipalPolicy } from "./principalPolicy/principalPolicyTypes";
export {
  type PrincipalPolicyCurrent,
  type VerifiedPrincipalPolicyCurrent,
  verifyPrincipalPolicyCurrent,
} from "./principalPolicyCurrent/principalPolicyCurrent";
export { verifyPrincipalPolicyCurrentMutation } from "./principalPolicyCurrent/principalPolicyCurrentMutation";
export { selectPrincipalPolicyCurrentPredecessorReferences } from "./principalPolicyCurrent/principalPolicyCurrentPredecessorReferences";
export { verifyPrincipalPolicyCurrentSuccessor } from "./principalPolicyCurrent/principalPolicyCurrentSuccessor";
export { verifyPrincipalPolicyBundleAgainstHistory } from "./principalPolicyHistory/principalPolicyBundleHistory";
export {
  createPrincipalPolicyHistoryVerifier,
  restorePrincipalPolicyHistoryVerifier,
} from "./principalPolicyHistory/principalPolicyHistory";
export type { PrincipalHistoryIndexNode } from "./principalPolicyHistory/principalPolicyHistoryIndex";
export {
  createPrincipalHistoryIndexProof,
  principalHistoryIndexLeaf,
  resolvePrincipalHistoryIndexProof,
} from "./principalPolicyHistory/principalPolicyHistoryIndex";
export { PRINCIPAL_HISTORY_VERIFICATION_REVISION } from "./principalPolicyHistory/principalPolicyHistoryPage";
export type { PrincipalPolicyHistoryReferenceProof } from "./principalPolicyHistory/principalPolicyHistoryReferences";
export { verifyPrincipalPolicyHistoryReferences } from "./principalPolicyHistory/principalPolicyHistoryReferences";
export type { PrincipalHistorySigner } from "./principalPolicyHistory/principalPolicyHistorySigners";
export type {
  PrincipalPolicyHistoryInput,
  PrincipalPolicyHistoryPage,
  PrincipalPolicyHistoryProgressOptions,
  PrincipalPolicyHistoryVerifier,
  VerifiedPrincipalPolicyHistory,
} from "./principalPolicyHistory/principalPolicyHistoryTypes";
export { PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT } from "./principalPolicyHistory/principalPolicyHistoryTypes";
export * from "./transparency/transparency";
export {
  accessManifestTransparencyLeaf,
  computeTransparencyLeafHash,
  identityStateTransparencyLeaf,
  principalPolicyTransparencyLeaf,
} from "./transparency/transparencyLeaf";
export {
  type VerifyTransparencyConsistencyProofInput,
  type VerifyTransparencyInclusionProofInput,
  verifyTransparencyConsistencyProof,
  verifyTransparencyInclusionProof,
} from "./transparency/transparencyProofs";
export {
  computeTransparencyMerkleRoot,
  createTransparencyConsistencyProof,
  createTransparencyInclusionProof,
  largestPowerOfTwoLessThan,
} from "./transparency/transparencyTree";
export * from "./transparency/transparencyTypes";
export * from "./writeHeader/writeHeader";
export * from "./writeHeader/writeHeaderTypes";
