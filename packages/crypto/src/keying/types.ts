import type {
  PrincipalContainerGrant,
  PrincipalProjectionMember,
  PrincipalStateMemberEnvelope,
  PrincipalStatePayloadCipherSuite,
  SignedPrincipalState,
} from "../principalState";
import type { PrincipalPolicyExternalAuthority } from "./principalPolicyExternalAuthorityTypes";

/** Security-boundary contracts for untrusted key data and verified outputs. */
type CanonicalJsonPrimitive = boolean | number | string | null;

export type KeyingCanonicalJson =
  | CanonicalJsonPrimitive
  | readonly KeyingCanonicalJson[]
  | { readonly [key: string]: KeyingCanonicalJson };

export type KeyingCanonicalPayload<T> = T extends CanonicalJsonPrimitive
  ? T
  : T extends readonly (infer Item)[]
    ? readonly KeyingCanonicalPayload<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: KeyingCanonicalPayload<T[Key]> }
      : never;

export type KeyingHashDomain =
  | "tearleads.document.content-record-ciphertext"
  | "tearleads.document.content-record-metadata"
  | "tearleads.keying.access-event-body"
  | "tearleads.keying.access-event-signing"
  | "tearleads.keying.access-event"
  | "tearleads.keying.access-manifest"
  | "tearleads.keying.blob-access-manifest"
  | "tearleads.keying.blob-content-key-targets"
  | "tearleads.keying.content-record-nonce-domain"
  | "tearleads.keying.container-access-direct-grants"
  | "tearleads.keying.container-access-key-target"
  | "tearleads.keying.container-access-structural"
  | "tearleads.keying.container-key-epoch"
  | "tearleads.keying.container-kek-material-id"
  | "tearleads.keying.container-kek-keyring"
  | "tearleads.keying.container-kek-predecessor-bridge"
  | "tearleads.keying.container-kek-recipient-targets"
  | "tearleads.keying.document-content-key-targets"
  | "tearleads.keying.document-link-set-grants"
  | "tearleads.keying.document-link-set-key-target"
  | "tearleads.keying.document-link-set-structural"
  | "tearleads.keying.transparency-empty-tree"
  | "tearleads.keying.transparency-leaf"
  | "tearleads.keying.transparency-node"
  | "tearleads.keying.transparency-tree-head-signing"
  | "tearleads.keying.write-header-signing"
  | "tearleads.keying.write-header";

export type AccessEventType =
  | "attachment.bind"
  | "attachment.detach"
  | "container.create"
  | "container.grant"
  | "container.move"
  | "container.recite"
  | "container.rekey"
  | "container.revoke"
  | "document.link"
  | "document.purge"
  | "document.unlink";

export type AccessObjectKind = "blob" | "container" | "document";
export type ManagedPrincipalKind = "group" | "organization";
export type KekRecipientKind = "container" | "group" | "user";
export type ContentObjectKind = "blob" | "document";
export type ContainerAccessLevel = "admin" | "read" | "write";
export type ContainerGrantSubjectType = "group" | "user";
export const CONTENT_RECORD_ENCRYPTION_SUITE =
  "aes-256-gcm-hkdf-sha256-record-key" as const;
export type ContentRecordEncryptionSuite =
  typeof CONTENT_RECORD_ENCRYPTION_SUITE;
export const DOCUMENT_CONTENT_KEY_WRAP_SUITE =
  "tearleads.document.content-key-wrap.aes-256-gcm-container-kek" as const;
export const BLOB_CONTENT_KEY_WRAP_SUITE =
  "tearleads.blob.content-key-wrap.aes-256-gcm-container-kek" as const;
export const CONTAINER_KEK_USER_WRAP_SUITE =
  "tearleads.container-kek-wrap.ml-kem-1024-aes-256-gcm" as const;
export const CONTAINER_KEK_PARENT_WRAP_SUITE =
  "tearleads.container-kek-wrap.aes-256-gcm-parent-kek" as const;
export const CONTAINER_KEK_PREDECESSOR_WRAP_SUITE =
  "tearleads.container-kek-wrap.aes-256-gcm-predecessor-kek" as const;
export const CONTAINER_KEK_MATERIAL_ID_PREFIX =
  "tearleads.container-kek.v1.sha256:" as const;
export const CONTAINER_KEK_KEYRING_SEAL_SUITE =
  "tearleads.container-kek-keyring.aes-256-gcm-current-kek" as const;
// Write-time sanity cap on lifetime rotations. Sized to be unreachable by
// legitimate use; it exists to stop runaway rotation loops and to give the
// keyring length equation a hard ceiling, not to budget rotations. Defined
// with the wire arithmetic in @tearleads/validators so every layer shares
// one equation.
export { MAX_CONTAINER_KEY_EPOCH } from "@tearleads/validators/util";

export interface UnsignedAccessEvent {
  version: 1;
  eventId: string;
  eventType: AccessEventType;
  objectKind: AccessObjectKind;
  objectId: string;
  organizationId: string;
  previousManifestHash: string | null;
  dependencyManifestHashes: string[];
  bodyHash: string;
  signerUserId: string;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signedAt: string;
}

export interface AccessEvent extends UnsignedAccessEvent {
  signature: string;
}

export interface ReferencedPrincipalHead {
  principalType: ManagedPrincipalKind;
  principalId: string;
  version: number;
  keyEpoch: number;
  stateHash: string;
  keyFingerprint: string;
}

export type ContainerGrantPrincipalHead = ReferencedPrincipalHead & {
  principalType: "group";
};

export interface AccessManifest {
  version: 1;
  objectKind: AccessObjectKind;
  objectId: string;
  organizationId: string;
  epoch: number;
  previousManifestHash: string | null;
  eventHash: string;
  structuralHash: string;
  grantRoot: string;
  referencedPrincipalHeads: ReferencedPrincipalHead[];
  keyTargetHash: string;
}

export interface ContainerAccessManifest extends AccessManifest {
  objectKind: "container";
  referencedPrincipalHeads: ContainerGrantPrincipalHead[];
}

export interface ContainerDirectGrant {
  accessLevel: ContainerAccessLevel;
  subjectId: string;
  subjectType: ContainerGrantSubjectType;
}

export interface ContainerAccessStructural {
  parentContainerId: string | null;
  parentManifestHash: string | null;
}

export interface ContainerAccessMetadata {
  metadataDocumentId: string;
}

export interface ContainerAccessKeyState {
  containerKeyEpochId: string | null;
}

export interface ContainerAccessManifestState
  extends ContainerAccessStructural,
    ContainerAccessKeyState,
    ContainerAccessMetadata {
  version: 1;
  containerId: string;
  organizationId: string;
  epoch: number;
  previousManifestHash: string | null;
  eventHash: string;
  directGrants: ContainerDirectGrant[];
  referencedPrincipalHeads: ContainerGrantPrincipalHead[];
}

export interface ContainerCreateAccessEventBody
  extends ContainerAccessStructural,
    ContainerAccessKeyState,
    ContainerAccessMetadata {
  eventType: "container.create";
  directGrants: ContainerDirectGrant[];
  referencedPrincipalHeads: ContainerGrantPrincipalHead[];
}

export interface ContainerGrantAccessEventBody extends ContainerAccessKeyState {
  eventType: "container.grant";
  grant: ContainerDirectGrant;
  referencedPrincipalHead: ContainerGrantPrincipalHead | null;
}

export interface ContainerRevokeAccessEventBody
  extends ContainerAccessKeyState {
  eventType: "container.revoke";
  keyringHash: string;
  predecessorBridgeHash: string;
  subjectId: string;
  subjectType: ContainerGrantSubjectType;
}

export interface ContainerRekeyAccessEventBody {
  eventType: "container.rekey";
  containerKeyEpochId: string;
  keyringHash: string;
  predecessorBridgeHash: string;
  referencedPrincipalHeads: ContainerGrantPrincipalHead[];
}

export interface ContainerReciteAccessEventBody
  extends ContainerAccessKeyState {
  eventType: "container.recite";
}

export interface ContainerMoveAccessEventBody
  extends ContainerAccessStructural,
    ContainerAccessKeyState {
  eventType: "container.move";
  keyringHash: string;
  predecessorBridgeHash: string;
}

export type ContainerAccessEventBody =
  | ContainerCreateAccessEventBody
  | ContainerGrantAccessEventBody
  | ContainerMoveAccessEventBody
  | ContainerReciteAccessEventBody
  | ContainerRekeyAccessEventBody
  | ContainerRevokeAccessEventBody;

export interface DocumentLinkSetStructural {
  linkedContainerIds: string[];
}

export interface DocumentLinkSetManifestState
  extends DocumentLinkSetStructural {
  version: 1;
  documentId: string;
  organizationId: string;
  epoch: number;
  previousManifestHash: string | null;
  eventHash: string;
}

export interface DocumentLinkAccessEventBody {
  eventType: "document.link";
  containerId: string;
  containerManifestHash: string;
}

export interface DocumentUnlinkAccessEventBody {
  eventType: "document.unlink";
  containerId: string;
  containerManifestHash: string;
}

export type DocumentAccessEventBody =
  | DocumentLinkAccessEventBody
  | DocumentUnlinkAccessEventBody;

export interface AttachmentBindAccessEventBody {
  eventType: "attachment.bind";
  bindingId: string;
  blobId: string;
  documentId: string;
  slotId: string;
  expectedBindingId: string | null;
  documentManifestHash: string;
}

export interface AttachmentDetachAccessEventBody {
  eventType: "attachment.detach";
  bindingId: string;
  blobId: string;
  documentId: string;
  slotId: string;
  documentManifestHash: string;
}

export type AttachmentAccessEventBody =
  | AttachmentBindAccessEventBody
  | AttachmentDetachAccessEventBody;

export interface ContainerKekRecipientTarget {
  recipientKind: KekRecipientKind;
  recipientId: string;
  recipientKeyEpochId: string;
  recipientKeyFingerprint: string;
}

export interface ContainerKeyEpoch {
  id: string;
  containerId: string;
  keyEpoch: number;
  accessManifestHash: string;
  parentContainerKeyEpochId: string | null;
  createdByEventHash: string;
  createdByManifestHash: string;
}

export interface ContainerKeyWrap {
  containerKeyEpochId: string;
  recipientKind: KekRecipientKind;
  recipientId: string;
  recipientKeyEpochId: string;
  recipientKeyFingerprint: string;
  kemCipherText: string;
  wrappedKey: string;
  wrapManifestHash: string;
}

export interface ContainerKekPredecessorBridge {
  version: 1;
  wrappingSuite: typeof CONTAINER_KEK_PREDECESSOR_WRAP_SUITE;
  containerId: string;
  predecessorContainerKeyEpochId: string;
  successorContainerKeyEpochId: string;
  iv: string;
  wrappedKey: string;
}

/**
 * The container's complete predecessor key history, AEAD-sealed under the
 * epoch named by `containerKeyEpochId`. The snapshot read path: one member
 * unwrap plus one open yields every retained historical KEK. The bridge log
 * remains the append-only ground truth the keyring is rebuilt from.
 */
export interface ContainerKekKeyring {
  version: 1;
  sealingSuite: typeof CONTAINER_KEK_KEYRING_SEAL_SUITE;
  containerId: string;
  containerKeyEpochId: string;
  iv: string;
  sealed: string;
}

export interface ContainerKekKeyringEntry {
  containerKeyEpochId: string;
  keyMaterial: Uint8Array;
}

export interface ContainerUserRecipientKey {
  userId: string;
  recipientKeyEpochId: string;
  recipientKeyFingerprint: string;
}

export interface ContainerKekTarget {
  containerId: string;
  containerManifestHash: string;
  containerKeyEpochId: string;
  containerKeyEpoch: number;
}

export type DocumentContentKeyTarget = ContainerKekTarget;

export interface BlobContentKeyTarget extends ContainerKekTarget {
  bindingId: string;
  documentId: string;
}

export interface BlobAccessManifest {
  version: 1;
  blobId: string;
  organizationId: string;
  activeBindingIds: string[];
  documentManifestHashes: string[];
  linkedContainerManifestHashes: string[];
  linkedContainerKeyEpochIds: string[];
  blobKeyTargetHash: string;
}

export interface UnsignedWriteHeader {
  version: 1;
  organizationId: string;
  objectKind: ContentObjectKind;
  objectId: string;
  accessManifestHash: string;
  contentKeyEpoch: number;
  targetHash: string;
  encryptionSuite: ContentRecordEncryptionSuite;
  contentRecordId: string;
  nonceDomainHash: string;
  metadataHash: string;
  ciphertextHash: string;
  writerUserId: string;
  writerDeviceId: string;
  writerKeyFingerprint: string;
  signedAt: string;
}

export interface WriteHeader extends UnsignedWriteHeader {
  signature: string;
}

export interface DocumentContentRecordMetadataInput {
  checkpointKind?: "rotate_baseline";
  checkpointPayloadKind?: "full_history_snapshot";
  documentId: string;
  partialEndVersionVector: string;
  partialStartVersionVector: string;
  plaintextHash: string;
  sourceVersionVector?: string;
  updateId: string;
}

export interface ContentRecordNonceDomain {
  version: 1;
  organizationId: string;
  objectKind: ContentObjectKind;
  objectId: string;
  contentKeyEpoch: number;
  encryptionSuite: ContentRecordEncryptionSuite;
  contentRecordId: string;
}

export interface IdentityStateHead {
  identityId: string;
  version: number;
  stateHash: string;
  previousStateHash: string | null;
}

export type TransparencyLeafKind =
  | "access_manifest_head"
  | "identity_state_head"
  | "principal_policy_head";

export interface IdentityStateTransparencyLeaf {
  version: 1;
  leafKind: "identity_state_head";
  identityId: string;
  stateVersion: number;
  stateHash: string;
}

export interface PrincipalPolicyTransparencyLeaf {
  version: 1;
  leafKind: "principal_policy_head";
  principalType: ManagedPrincipalKind;
  principalId: string;
  policyVersion: number;
  keyEpoch: number;
  stateHash: string;
  keyFingerprint: string;
}

export interface AccessManifestTransparencyLeaf {
  version: 1;
  leafKind: "access_manifest_head";
  objectKind: AccessObjectKind;
  objectId: string;
  organizationId: string;
  epoch: number;
  manifestHash: string;
}

export type TransparencyLeaf =
  | AccessManifestTransparencyLeaf
  | IdentityStateTransparencyLeaf
  | PrincipalPolicyTransparencyLeaf;

export interface UnsignedTransparencyTreeHead {
  version: 1;
  logId: string;
  treeSize: number;
  rootHash: string;
  signedAt: string;
  logKeyFingerprint: string;
}

export interface SignedTransparencyTreeHead
  extends UnsignedTransparencyTreeHead {
  signature: string;
}

export interface TransparencyInclusionProof {
  version: 1;
  treeSize: number;
  leafIndex: number;
  auditPath: readonly string[];
}

export interface TransparencyConsistencyProof {
  version: 1;
  previousTreeSize: number;
  treeSize: number;
  nodeHashes: readonly string[];
}

export interface TransparencyTreeCheckpoint {
  readonly logId: string;
  readonly treeSize: number;
  readonly rootHash: string;
}

export {
  type KeyingVerificationCode,
  KeyingVerificationError,
  type KeyingVerificationResult,
} from "./verificationError";

const verifiedBrandValue = true;
const verifiedIdentityStateBrand: unique symbol = Symbol(
  "verifiedIdentityState",
);
const verifiedPrincipalPolicyBrand: unique symbol = Symbol(
  "verifiedPrincipalPolicy",
);
const verifiedPrincipalPolicySnapshotBrand: unique symbol = Symbol();
const verifiedAccessEventBrand: unique symbol = Symbol("verifiedAccessEvent");
const verifiedAccessManifestBrand: unique symbol = Symbol(
  "verifiedAccessManifest",
);
const verifiedContainerAccessManifestBrand: unique symbol = Symbol(
  "verifiedContainerAccessManifest",
);
const verifiedDocumentLinkSetManifestBrand: unique symbol = Symbol(
  "verifiedDocumentLinkSetManifest",
);
const verifiedDocumentLinkSetStateEvidenceBrand: unique symbol = Symbol();
const verifiedDocumentKekTargetsBrand: unique symbol = Symbol(
  "verifiedDocumentKekTargets",
);
const verifiedAttachmentBindingBrand: unique symbol = Symbol(
  "verifiedAttachmentBinding",
);
const verifiedAttachmentDetachBrand: unique symbol = Symbol(
  "verifiedAttachmentDetach",
);
const verifiedBlobKekTargetsBrand: unique symbol = Symbol(
  "verifiedBlobKekTargets",
);
const verifiedContainerParentEdgeBrand: unique symbol = Symbol(
  "verifiedContainerParentEdge",
);
const verifiedContainerKekStateBrand: unique symbol = Symbol("kek");
const verifiedWriteHeaderBrand: unique symbol = Symbol("verifiedWriteHeader");
const verifiedTransparencyTreeHeadBrand: unique symbol = Symbol("treeHead");
const verifiedTransparencyProofBrand: unique symbol = Symbol("proof");

export interface VerifiedIdentityState {
  readonly identityId: string;
  readonly version: number;
  readonly stateHash: string;
  readonly head: IdentityStateHead;
  readonly checkpoint: IdentityStateCheckpoint;
  readonly [verifiedIdentityStateBrand]: true;
}

export interface VerifiedPrincipalPolicy {
  readonly principalType: ManagedPrincipalKind;
  readonly principalId: string;
  readonly version: number;
  readonly keyEpoch: number;
  readonly stateHash: string;
  readonly state: PrincipalPolicySignedState;
  readonly projection: PrincipalProjectionMember[];
  readonly grants: PrincipalContainerGrant[];
  readonly history?: readonly NormalizedPrincipalPolicyStateChainEntry[];
  readonly checkpoint: PrincipalPolicyCheckpoint;
  readonly [verifiedPrincipalPolicyBrand]: true;
}

export interface VerifiedPrincipalPolicySnapshot {
  readonly principalType: ManagedPrincipalKind;
  readonly principalId: string;
  readonly version: number;
  readonly keyEpoch: number;
  readonly stateHash: string;
  readonly state: PrincipalPolicySignedState;
  readonly projection: PrincipalProjectionMember[];
  readonly grants: PrincipalContainerGrant[];
  readonly history: readonly NormalizedPrincipalPolicyStateChainEntry[];
  readonly checkpoint: PrincipalPolicyCheckpoint;
  readonly [verifiedPrincipalPolicySnapshotBrand]: true;
}

export type AnyVerifiedPrincipalPolicy =
  | VerifiedPrincipalPolicy
  | VerifiedPrincipalPolicySnapshot;

export interface VerifiedAccessEvent {
  readonly event: AccessEvent;
  readonly body: KeyingCanonicalJson;
  readonly eventHash: string;
  readonly [verifiedAccessEventBrand]: true;
}

export interface VerifiedAccessManifest {
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly checkpoint: AccessManifestCheckpoint;
  readonly [verifiedAccessManifestBrand]: true;
}
export interface VerifiedContainerAccessManifest {
  readonly manifest: ContainerAccessManifest;
  readonly manifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly state: ContainerAccessManifestState;
  readonly checkpoint: AccessManifestCheckpoint;
  readonly [verifiedContainerAccessManifestBrand]: true;
}
export interface VerifiedDocumentLinkSetStateEvidence {
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
  readonly state: DocumentLinkSetManifestState;
  readonly checkpoint: AccessManifestCheckpoint;
  readonly [verifiedDocumentLinkSetStateEvidenceBrand]: true;
}
export interface VerifiedDocumentLinkSetManifest
  extends VerifiedDocumentLinkSetStateEvidence {
  readonly event: VerifiedAccessEvent;
  readonly [verifiedDocumentLinkSetManifestBrand]: true;
}
export type VerifiedDocumentLinkSetSnapshot =
  VerifiedDocumentLinkSetStateEvidence;
export type AnyVerifiedAccessManifest =
  | VerifiedAccessManifest
  | VerifiedContainerAccessManifest
  | VerifiedDocumentLinkSetManifest;
export interface VerifiedDocumentKekTargets {
  readonly documentId: string;
  readonly linkSetManifestHash: string;
  readonly linkedContainerManifestHashes: readonly string[];
  readonly linkedContainerKeyEpochIds: readonly string[];
  readonly targets: readonly DocumentContentKeyTarget[];
  readonly documentKeyTargetHash: string;
  readonly [verifiedDocumentKekTargetsBrand]: true;
}

export interface VerifiedAttachmentBinding {
  readonly bindingId: string;
  readonly blobId: string;
  readonly documentId: string;
  readonly slotId: string;
  readonly documentManifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly body: AttachmentBindAccessEventBody;
  readonly [verifiedAttachmentBindingBrand]: true;
}

export interface VerifiedAttachmentDetach {
  readonly bindingId: string;
  readonly blobId: string;
  readonly documentId: string;
  readonly slotId: string;
  readonly documentManifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly body: AttachmentDetachAccessEventBody;
  readonly [verifiedAttachmentDetachBrand]: true;
}

export interface VerifiedBlobKekTargets {
  readonly blobId: string;
  readonly organizationId: string;
  readonly activeBindingIds: readonly string[];
  readonly documentManifestHashes: readonly string[];
  readonly linkedContainerManifestHashes: readonly string[];
  readonly linkedContainerKeyEpochIds: readonly string[];
  readonly targets: readonly BlobContentKeyTarget[];
  readonly blobKeyTargetHash: string;
  readonly blobAccessManifestHash: string;
  readonly [verifiedBlobKekTargetsBrand]: true;
}

export interface VerifiedContainerParentEdge {
  readonly childContainerId: string;
  readonly childManifestHash: string;
  readonly parentContainerId: string;
  readonly parentManifestHash: string;
  readonly [verifiedContainerParentEdgeBrand]: true;
}

export interface VerifiedContainerKekState {
  readonly containerId: string;
  readonly accessManifestHash: string;
  readonly containerKeyEpochId: string;
  readonly containerKeyEpoch: number;
  readonly keyEpoch: ContainerKeyEpoch;
  readonly keyEpochHash: string;
  readonly parentContainerKeyEpochId: string | null;
  readonly keyTargetHash: string;
  readonly recipientTargets: readonly ContainerKekRecipientTarget[];
  readonly wraps: readonly ContainerKeyWrap[];
  readonly [verifiedContainerKekStateBrand]: true;
}

export interface VerifiedWriteHeader {
  readonly header: WriteHeader;
  readonly headerHash: string;
  readonly nonceDomain: ContentRecordNonceDomain;
  readonly nonceDomainHash: string;
  readonly [verifiedWriteHeaderBrand]: true;
}

export interface VerifiedTransparencyTreeHead {
  readonly treeHead: SignedTransparencyTreeHead;
  readonly checkpoint: TransparencyTreeCheckpoint;
  readonly [verifiedTransparencyTreeHeadBrand]: true;
}

export interface VerifiedTransparencyProof {
  readonly leaf: TransparencyLeaf;
  readonly leafHash: string;
  readonly treeHead: VerifiedTransparencyTreeHead;
  readonly inclusionProof: TransparencyInclusionProof;
  readonly consistencyProof?: TransparencyConsistencyProof;
  readonly [verifiedTransparencyProofBrand]: true;
}

export function makeVerifiedIdentityState(
  value: Omit<VerifiedIdentityState, typeof verifiedIdentityStateBrand>,
): VerifiedIdentityState {
  return {
    ...value,
    [verifiedIdentityStateBrand]: verifiedBrandValue,
  };
}

export function makeVerifiedPrincipalPolicy(
  value: Omit<VerifiedPrincipalPolicy, typeof verifiedPrincipalPolicyBrand>,
): VerifiedPrincipalPolicy {
  return {
    ...value,
    [verifiedPrincipalPolicyBrand]: verifiedBrandValue,
  };
}

export function makeVerifiedPrincipalPolicySnapshot(
  value: Omit<
    VerifiedPrincipalPolicySnapshot,
    typeof verifiedPrincipalPolicySnapshotBrand
  >,
): VerifiedPrincipalPolicySnapshot {
  return {
    ...value,
    [verifiedPrincipalPolicySnapshotBrand]: verifiedBrandValue,
  };
}

export function makeVerifiedAccessEvent(
  value: Omit<VerifiedAccessEvent, typeof verifiedAccessEventBrand>,
): VerifiedAccessEvent {
  return {
    ...value,
    [verifiedAccessEventBrand]: verifiedBrandValue,
  };
}

export function makeVerifiedAccessManifest(
  value: Omit<VerifiedAccessManifest, typeof verifiedAccessManifestBrand>,
): VerifiedAccessManifest {
  return {
    ...value,
    [verifiedAccessManifestBrand]: verifiedBrandValue,
  };
}

export function makeVerifiedContainerAccessManifest(
  value: Omit<
    VerifiedContainerAccessManifest,
    typeof verifiedContainerAccessManifestBrand
  >,
): VerifiedContainerAccessManifest {
  return {
    ...value,
    [verifiedContainerAccessManifestBrand]: verifiedBrandValue,
  };
}

export function makeVerifiedDocumentLinkSetManifest(
  value: Omit<
    VerifiedDocumentLinkSetManifest,
    | typeof verifiedDocumentLinkSetManifestBrand
    | typeof verifiedDocumentLinkSetStateEvidenceBrand
  >,
): VerifiedDocumentLinkSetManifest {
  return {
    ...value,
    [verifiedDocumentLinkSetManifestBrand]: verifiedBrandValue,
    [verifiedDocumentLinkSetStateEvidenceBrand]: verifiedBrandValue,
  };
}

export function makeVerifiedDocumentLinkSetSnapshot(
  value: Omit<
    VerifiedDocumentLinkSetSnapshot,
    typeof verifiedDocumentLinkSetStateEvidenceBrand
  >,
): VerifiedDocumentLinkSetSnapshot {
  return {
    ...value,
    [verifiedDocumentLinkSetStateEvidenceBrand]: verifiedBrandValue,
  };
}

export function makeVerifiedDocumentKekTargets(
  value: Omit<
    VerifiedDocumentKekTargets,
    typeof verifiedDocumentKekTargetsBrand
  >,
): VerifiedDocumentKekTargets {
  return {
    ...value,
    [verifiedDocumentKekTargetsBrand]: verifiedBrandValue,
  };
}

export function makeVerifiedAttachmentBinding(
  value: Omit<VerifiedAttachmentBinding, typeof verifiedAttachmentBindingBrand>,
): VerifiedAttachmentBinding {
  return {
    ...value,
    [verifiedAttachmentBindingBrand]: verifiedBrandValue,
  };
}

export function makeVerifiedAttachmentDetach(
  value: Omit<VerifiedAttachmentDetach, typeof verifiedAttachmentDetachBrand>,
): VerifiedAttachmentDetach {
  return {
    ...value,
    [verifiedAttachmentDetachBrand]: verifiedBrandValue,
  };
}

export function makeVerifiedBlobKekTargets(
  value: Omit<VerifiedBlobKekTargets, typeof verifiedBlobKekTargetsBrand>,
): VerifiedBlobKekTargets {
  return {
    ...value,
    [verifiedBlobKekTargetsBrand]: verifiedBrandValue,
  };
}

export function makeVerifiedContainerParentEdge(
  value: Omit<
    VerifiedContainerParentEdge,
    typeof verifiedContainerParentEdgeBrand
  >,
): VerifiedContainerParentEdge {
  return {
    ...value,
    [verifiedContainerParentEdgeBrand]: verifiedBrandValue,
  };
}

export function makeVerifiedContainerKekState(
  value: Omit<VerifiedContainerKekState, typeof verifiedContainerKekStateBrand>,
): VerifiedContainerKekState {
  return {
    ...value,
    [verifiedContainerKekStateBrand]: verifiedBrandValue,
  };
}

export function makeVerifiedWriteHeader(
  value: Omit<VerifiedWriteHeader, typeof verifiedWriteHeaderBrand>,
): VerifiedWriteHeader {
  return {
    ...value,
    [verifiedWriteHeaderBrand]: verifiedBrandValue,
  };
}

export function makeVerifiedTransparencyTreeHead(
  value: Omit<
    VerifiedTransparencyTreeHead,
    typeof verifiedTransparencyTreeHeadBrand
  >,
): VerifiedTransparencyTreeHead {
  return {
    ...value,
    [verifiedTransparencyTreeHeadBrand]: verifiedBrandValue,
  };
}

export function makeVerifiedTransparencyProof(
  value: Omit<VerifiedTransparencyProof, typeof verifiedTransparencyProofBrand>,
): VerifiedTransparencyProof {
  return {
    ...value,
    [verifiedTransparencyProofBrand]: verifiedBrandValue,
  };
}

interface ExpectedObject {
  readonly objectKind: AccessObjectKind;
  readonly objectId: string;
}

interface ExpectedWriteObject {
  readonly objectKind: ContentObjectKind;
  readonly objectId: string;
  readonly organizationId?: string;
}

export interface VerifyAccessEventInput {
  readonly event: AccessEvent;
  readonly body: KeyingCanonicalJson;
  readonly signerPublicKey: Uint8Array;
}

export interface VerifyAttachmentBindingEventInput
  extends VerifyAccessEventInput {
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly authorizingContainerPaths?: readonly (readonly VerifiedContainerAccessManifest[])[];
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
  readonly expectedBindingId?: string;
  readonly expectedBlobId?: string;
  readonly expectedDocumentId?: string;
  readonly expectedDocumentManifestHash?: string;
  readonly expectedPreviousBindingId?: string | null;
}

export interface VerifyAttachmentDetachEventInput
  extends VerifyAccessEventInput {
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly authorizingContainerPaths?: readonly (readonly VerifiedContainerAccessManifest[])[];
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
  readonly expectedBindingId?: string;
  readonly expectedBlobId?: string;
  readonly expectedDocumentId?: string;
  readonly expectedDocumentManifestHash?: string;
}

export interface VerifyAccessManifestInput {
  readonly manifest: AccessManifest;
  readonly expectedManifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly expectedObject?: ExpectedObject;
  readonly expectedPreviousManifestHash?: string | null;
  readonly localCheckpoint?: AccessManifestCheckpoint | null | undefined;
  readonly checkpointPredecessors?:
    | readonly AnyVerifiedAccessManifest[]
    | undefined;
}

export interface VerifyContainerAccessManifestInput {
  readonly authorizationMembership?: "current" | "referenced" | undefined;
  readonly manifest: AccessManifest;
  readonly expectedManifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly previousManifest?: VerifiedContainerAccessManifest | null;
  readonly localCheckpoint?: AccessManifestCheckpoint | null | undefined;
  readonly checkpointPredecessors?:
    | readonly AnyVerifiedAccessManifest[]
    | undefined;
  readonly previousContainerPath?: readonly VerifiedContainerAccessManifest[];
  readonly parentContainerPath?: readonly VerifiedContainerAccessManifest[];
  readonly destinationParentContainerPath?: readonly VerifiedContainerAccessManifest[];
  readonly principalPolicies?: readonly AnyVerifiedPrincipalPolicy[];
}

export interface VerifyContainerParentEdgeInput {
  readonly child: VerifiedContainerAccessManifest;
  readonly parentHistory: readonly VerifiedContainerAccessManifest[];
}

export interface VerifyDocumentLinkSetManifestInput {
  readonly authorizationMembership?: "current" | "referenced" | undefined;
  readonly manifest: AccessManifest;
  readonly expectedManifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly previousManifest?: VerifiedDocumentLinkSetStateEvidence | null;
  readonly localCheckpoint?: AccessManifestCheckpoint | null | undefined;
  readonly checkpointPredecessors?:
    | readonly AnyVerifiedAccessManifest[]
    | undefined;
  readonly targetContainerPath?: readonly VerifiedContainerAccessManifest[];
  readonly authorizingContainerPaths?: readonly VerifiedContainerAccessManifest[][];
  readonly principalPolicies?: readonly AnyVerifiedPrincipalPolicy[];
}

export interface DeriveContainerKekRecipientTargetsInput {
  readonly containerManifest: VerifiedContainerAccessManifest;
  readonly parentKekState?: VerifiedContainerKekState | null;
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
  readonly userRecipientKeys?: readonly ContainerUserRecipientKey[];
}

export interface VerifyContainerKekStateInput
  extends DeriveContainerKekRecipientTargetsInput {
  readonly keyEpoch: ContainerKeyEpoch;
  readonly wraps: readonly ContainerKeyWrap[];
  readonly containerManifestHistory?: readonly VerifiedContainerAccessManifest[];
}

export interface DeriveDocumentKekTargetsInput {
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly linkedContainerManifests: readonly VerifiedContainerAccessManifest[];
  readonly containerKekStates: readonly VerifiedContainerKekState[];
}

export interface DeriveBlobKekTargetsInput {
  readonly blobId: string;
  readonly activeBindings: readonly VerifiedAttachmentBinding[];
  readonly documentManifests: readonly VerifiedDocumentLinkSetManifest[];
  readonly linkedContainerManifests: readonly VerifiedContainerAccessManifest[];
  readonly containerKekStates: readonly VerifiedContainerKekState[];
}

export interface VerifyWriteHeaderInput {
  readonly header: WriteHeader;
  readonly writerPublicKey: Uint8Array;
  readonly expectedObject?: ExpectedWriteObject;
  readonly expectedAccessManifestHash?: string;
  readonly expectedTargetHash?: string;
  readonly documentAuthorization?: {
    readonly documentManifest: VerifiedDocumentLinkSetManifest;
    readonly documentKekTargets: VerifiedDocumentKekTargets;
    readonly authorizingContainerPaths: readonly (readonly VerifiedContainerAccessManifest[])[];
    readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
  };
  readonly blobAuthorization?: {
    readonly blobKekTargets: VerifiedBlobKekTargets;
    readonly authorizingContainerPaths: readonly (readonly VerifiedContainerAccessManifest[])[];
    readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
  };
}

export interface PrincipalPolicyCheckpoint {
  readonly principalType: ManagedPrincipalKind;
  readonly principalId: string;
  readonly version: number;
  readonly stateHash: string;
}

export interface IdentityStateCheckpoint {
  readonly identityId: string;
  readonly version: number;
  readonly stateHash: string;
}

export interface AccessManifestCheckpoint {
  readonly objectKind: AccessObjectKind;
  readonly objectId: string;
  readonly organizationId: string;
  readonly epoch: number;
  readonly manifestHash: string;
}

export interface KeyingLocalCheckpointStore {
  readonly readIdentityStateCheckpoint: (
    identityId: string,
  ) => Promise<IdentityStateCheckpoint | null>;
  readonly writeIdentityStateCheckpoint: (
    checkpoint: IdentityStateCheckpoint,
  ) => Promise<void>;
  readonly readPrincipalPolicyCheckpoint: (
    principalType: ManagedPrincipalKind,
    principalId: string,
  ) => Promise<PrincipalPolicyCheckpoint | null>;
  readonly writePrincipalPolicyCheckpoint: (
    checkpoint: PrincipalPolicyCheckpoint,
  ) => Promise<void>;
  readonly readAccessManifestCheckpoint: (
    objectKind: AccessObjectKind,
    organizationId: string,
    objectId: string,
  ) => Promise<AccessManifestCheckpoint | null>;
  readonly writeAccessManifestCheckpoint: (
    checkpoint: AccessManifestCheckpoint,
  ) => Promise<void>;
}

export interface VerifyIdentityStateCheckpointInput {
  readonly head: IdentityStateHead;
  readonly localCheckpoint?: IdentityStateCheckpoint | null | undefined;
  readonly checkpointPredecessors?: readonly IdentityStateHead[] | undefined;
}

export interface VerifySignedTransparencyTreeHeadInput {
  readonly treeHead: SignedTransparencyTreeHead;
  readonly logPublicKey: Uint8Array;
}

export interface VerifyTransparencyProofInput
  extends VerifySignedTransparencyTreeHeadInput {
  readonly leaf: TransparencyLeaf;
  readonly inclusionProof: TransparencyInclusionProof;
  readonly previousTreeHead?: SignedTransparencyTreeHead | null | undefined;
  readonly consistencyProof?: TransparencyConsistencyProof | null | undefined;
}

export interface PrincipalPolicySignedState extends SignedPrincipalState {
  readonly stateHash: string;
}

export interface PrincipalPolicyStateChainEntry {
  readonly state: PrincipalPolicySignedState;
  readonly projection: readonly PrincipalProjectionMember[];
  readonly grants: readonly PrincipalContainerGrant[];
}

export interface PrincipalPolicyPayload {
  readonly principalType: ManagedPrincipalKind;
  readonly principalId: string;
  readonly stateHash: string;
  readonly cipherSuite: PrincipalStatePayloadCipherSuite;
  readonly ciphertext: string;
  readonly ciphertextHash: string;
}

export interface PrincipalPolicyMemberEnvelopes {
  readonly principalType: ManagedPrincipalKind;
  readonly principalId: string;
  readonly stateHash: string;
  readonly epoch: number;
  readonly envelopes: readonly PrincipalStateMemberEnvelope[];
}

export interface PrincipalPolicyBundle {
  readonly currentState: PrincipalPolicySignedState;
  readonly currentPayload: PrincipalPolicyPayload;
  readonly currentProjection: readonly PrincipalProjectionMember[];
  readonly currentGrants: readonly PrincipalContainerGrant[];
  readonly currentMemberEnvelopes: PrincipalPolicyMemberEnvelopes;
  readonly previousStates: readonly PrincipalPolicyStateChainEntry[];
}

export interface PrincipalPolicySnapshot {
  readonly currentState: PrincipalPolicySignedState;
  readonly currentProjection: readonly PrincipalProjectionMember[];
  readonly currentGrants: readonly PrincipalContainerGrant[];
  readonly previousStates: readonly PrincipalPolicyStateChainEntry[];
}

export interface PrincipalPolicySignerPublicKey {
  readonly userId: string;
  readonly signingKeyFingerprint: string;
  readonly signingPublicKey: Uint8Array;
}

export interface VerifyPrincipalPolicyBundleInput {
  readonly bundle: PrincipalPolicyBundle;
  readonly externalAuthority?: PrincipalPolicyExternalAuthority;
  readonly expectedReference?: ReferencedPrincipalHead;
  readonly localCheckpoint?: PrincipalPolicyCheckpoint | null;
  readonly signerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
}

export interface VerifyPrincipalPolicySnapshotInput {
  readonly snapshot: PrincipalPolicySnapshot;
  readonly externalAuthority?: PrincipalPolicyExternalAuthority;
  readonly expectedReference?: ReferencedPrincipalHead;
  readonly signerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
}

export interface NormalizedPrincipalPolicyStateChainEntry {
  readonly state: PrincipalPolicySignedState;
  readonly projection: PrincipalProjectionMember[];
  readonly grants: PrincipalContainerGrant[];
}
