// Write-time sanity cap on lifetime rotations. Sized to be unreachable by
// legitimate use; it exists to stop runaway rotation loops and to give the
// keyring length equation a hard ceiling, not to budget rotations. Defined
// with the wire arithmetic in @tearleads/validators so every layer shares
// one equation.
export { MAX_CONTAINER_KEY_EPOCH } from "@tearleads/validators/util";
export * from "./accessEvent";
export * from "./accessEventTypes";
export * from "./accessManifestSnapshot";
export * from "./accessManifestTypes";
export { ACCESS_MANIFEST_VERIFICATION_REVISION } from "./accessManifestVerificationRevision";
export * from "./accessManifestVerificationTypes";
export {
  normalizeAttachmentAccessEventBody,
  verifyAttachmentBindingEvent,
  verifyAttachmentDetachEvent,
} from "./attachmentAccessEvent";
export * from "./attachmentAccessTypes";
export * from "./canonical";
export {
  computeContainerKekLevelDigest,
  isKeyingCanonicalJson,
  readKeyingCanonicalJson,
} from "./canonicalJsonGuard";
export * from "./canonicalJsonTypes";
export * from "./checkpoints";
export * from "./checkpointTypes";
export * from "./containerAccess";
export { MAX_CONTAINER_RECITATION_EPOCH } from "./containerAccessReciteBody";
export * from "./containerAccessTypes";
export * from "./containerKek";
export { computeBlobAccessManifestHash } from "./containerKek/blobAccessManifest";
export {
  computeBlobContentKeyTargetHash,
  deriveBlobKekTargets,
} from "./containerKek/blobKeyTargets";
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
} from "./containerKekKeyring";
export {
  computeContainerKekMaterialId,
  isContainerKekMaterialId,
} from "./containerKekMaterial";
export {
  computeContainerKekPredecessorBridgeHash,
  createContainerKekPredecessorBridge,
  normalizeContainerKekPredecessorBridge,
  unwrapContainerKekPredecessorBridge,
} from "./containerKekPredecessor";
export * from "./containerKekTypes";
export {
  deriveContainerKekWrappingPublicKey,
  unwrapContainerKekParentWrap,
} from "./containerKekWrapping";
export { verifyContainerParentEdge } from "./containerParentEdge";
export { resolveContainerStatePathUserAccessLevel } from "./containerPathAccess";
export * from "./contentKeyTargetTypes";
export * from "./documentAccess";
export { normalizeDocumentAccessEventBody } from "./documentAccessBody";
export * from "./documentAccessTypes";
export {
  computeDocumentLinkSetGrantRoot,
  computeDocumentLinkSetKeyTargetHash,
  computeDocumentLinkSetStructuralHash,
  deriveDocumentLinkSetManifest,
} from "./documentLinkSetManifest";
export {
  type DocumentPurgeAccessEventBody,
  normalizeDocumentPurgeAccessEventBody,
  type VerifyDocumentPurgeEventInput,
  verifyDocumentPurgeEvent,
} from "./documentPurge";
export type { KeyingHashDomain } from "./keyingHashDomains";
export * from "./principalPolicy";
export { verifyPrincipalPolicyBundleAgainstHistory } from "./principalPolicyBundleHistory";
export {
  type PrincipalPolicyCurrent,
  type VerifiedPrincipalPolicyCurrent,
  verifyPrincipalPolicyCurrent,
} from "./principalPolicyCurrent";
export { verifyPrincipalPolicyCurrentMutation } from "./principalPolicyCurrentMutation";
export { selectPrincipalPolicyCurrentPredecessorReferences } from "./principalPolicyCurrentPredecessorReferences";
export { verifyPrincipalPolicyCurrentSuccessor } from "./principalPolicyCurrentSuccessor";
export type {
  PrincipalPolicyExternalAuthority,
  PrincipalPolicyExternalAuthorityState,
} from "./principalPolicyExternalAuthorityTypes";
export {
  createPrincipalPolicyHistoryVerifier,
  restorePrincipalPolicyHistoryVerifier,
} from "./principalPolicyHistory";
export type { PrincipalHistoryIndexNode } from "./principalPolicyHistoryIndex";
export {
  createPrincipalHistoryIndexProof,
  principalHistoryIndexLeaf,
  resolvePrincipalHistoryIndexProof,
} from "./principalPolicyHistoryIndex";
export { PRINCIPAL_HISTORY_VERIFICATION_REVISION } from "./principalPolicyHistoryPage";
export type { PrincipalPolicyHistoryReferenceProof } from "./principalPolicyHistoryReferences";
export { verifyPrincipalPolicyHistoryReferences } from "./principalPolicyHistoryReferences";
export type { PrincipalHistorySigner } from "./principalPolicyHistorySigners";
export type {
  PrincipalPolicyHistoryInput,
  PrincipalPolicyHistoryPage,
  PrincipalPolicyHistoryProgressOptions,
  PrincipalPolicyHistoryVerifier,
  VerifiedPrincipalPolicyHistory,
} from "./principalPolicyHistoryTypes";
export { PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT } from "./principalPolicyHistoryTypes";
export {
  selectPrincipalPolicyAuthorization,
  type VerifiedPrincipalPolicySelection,
} from "./principalPolicySelection";
export type {
  PrincipalPolicyTransitionMismatch,
  PrincipalPolicyTransitionMismatchCode,
} from "./principalPolicyTransition";
export {
  getPrincipalPolicyTransitionMismatch,
  getPrincipalPolicyTransitionMismatchReason,
} from "./principalPolicyTransition";
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
} from "./principalPolicyTypes";
export { makeVerifiedPrincipalPolicy } from "./principalPolicyTypes";
export * from "./transparency";
export {
  accessManifestTransparencyLeaf,
  computeTransparencyLeafHash,
  identityStateTransparencyLeaf,
  principalPolicyTransparencyLeaf,
} from "./transparencyLeaf";
export {
  type VerifyTransparencyConsistencyProofInput,
  type VerifyTransparencyInclusionProofInput,
  verifyTransparencyConsistencyProof,
  verifyTransparencyInclusionProof,
} from "./transparencyProofs";
export {
  computeTransparencyMerkleRoot,
  createTransparencyConsistencyProof,
  createTransparencyInclusionProof,
  largestPowerOfTwoLessThan,
} from "./transparencyTree";
export * from "./transparencyTypes";
export {
  isKeyingVerificationCode,
  KEYING_VERIFICATION_CODES,
  type KeyingVerificationCode,
  KeyingVerificationError,
  type KeyingVerificationResult,
} from "./verificationError";
export * from "./writeHeader";
export * from "./writeHeaderTypes";
