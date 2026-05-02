import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { toFingerprint } from "./fingerprint";
import { isPlainObject } from "./plainObject";
import type {
  PrincipalProjectionMember,
  PrincipalStatePayloadCipherSuite,
  SignedPrincipalState,
} from "./principalState";
import {
  computePrincipalProjectionRoot,
  computePrincipalStateHash,
  computePrincipalStatePayloadCiphertextHash,
  normalizePrincipalProjectionMembers,
  verifySignedPrincipalState,
} from "./principalState";
import { sign } from "./signing/sign";
import { verify } from "./signing/verify";

/**
 * Keying verifier contracts are the executable security boundary.
 *
 * API responses are untrusted JSON until they pass these pure verifiers. Route
 * code and app code should derive encryption targets only from branded verified
 * values, never directly from server-authored projection rows.
 */

const TEXT_ENCODER = new TextEncoder();

type CanonicalJsonPrimitive = boolean | number | string | null;

export type KeyingCanonicalJson =
  | CanonicalJsonPrimitive
  | readonly KeyingCanonicalJson[]
  | { readonly [key: string]: KeyingCanonicalJson };

type KeyingCanonicalPayload<T> = T extends CanonicalJsonPrimitive
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
  | "container.rekey"
  | "container.revoke"
  | "document.link"
  | "document.unlink";

export type AccessObjectKind = "blob" | "container" | "document";
export type ManagedPrincipalKind = "group" | "organization";
export type KekRecipientKind = "container" | "group" | "organization" | "user";
export type ContentObjectKind = "blob" | "document";
export type ContainerAccessLevel = "admin" | "read" | "write";
export type ContainerGrantSubjectType = "group" | "organization" | "user";
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
export const CONTAINER_KEK_MATERIAL_ID_PREFIX =
  "tearleads.container-kek.v1.sha256:" as const;

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
  referencedPrincipalHeads: ReferencedPrincipalHead[];
}

export interface ContainerCreateAccessEventBody
  extends ContainerAccessStructural,
    ContainerAccessKeyState,
    ContainerAccessMetadata {
  eventType: "container.create";
  directGrants: ContainerDirectGrant[];
  referencedPrincipalHeads: ReferencedPrincipalHead[];
}

export interface ContainerGrantAccessEventBody extends ContainerAccessKeyState {
  eventType: "container.grant";
  grant: ContainerDirectGrant;
  referencedPrincipalHead: ReferencedPrincipalHead | null;
}

export interface ContainerRevokeAccessEventBody
  extends ContainerAccessKeyState {
  eventType: "container.revoke";
  subjectId: string;
  subjectType: ContainerGrantSubjectType;
}

export interface ContainerRekeyAccessEventBody {
  eventType: "container.rekey";
  containerKeyEpochId: string;
}

export interface ContainerMoveAccessEventBody
  extends ContainerAccessStructural,
    ContainerAccessKeyState {
  eventType: "container.move";
}

export type ContainerAccessEventBody =
  | ContainerCreateAccessEventBody
  | ContainerGrantAccessEventBody
  | ContainerMoveAccessEventBody
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
  documentId: string;
  partialEndVersionVector: string;
  partialStartVersionVector: string;
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

export type KeyingVerificationCode =
  | "duplicate_entry"
  | "equivocation"
  | "hash_mismatch"
  | "invalid_domain"
  | "invalid_shape"
  | "key_epoch_reuse"
  | "missing_dependency"
  | "object_mismatch"
  | "rollback"
  | "signature_mismatch"
  | "signer_mismatch"
  | "stale_predecessor"
  | "unauthorized";

export class KeyingVerificationError extends Error {
  constructor(
    readonly code: KeyingVerificationCode,
    message: string,
  ) {
    super(message);
    this.name = "KeyingVerificationError";
  }
}

export type KeyingVerificationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: KeyingVerificationError };

declare const verifiedIdentityStateBrand: unique symbol;
declare const verifiedPrincipalPolicyBrand: unique symbol;
declare const verifiedAccessEventBrand: unique symbol;
declare const verifiedAccessManifestBrand: unique symbol;
declare const verifiedContainerAccessManifestBrand: unique symbol;
declare const verifiedDocumentLinkSetManifestBrand: unique symbol;
declare const verifiedDocumentKekTargetsBrand: unique symbol;
declare const verifiedAttachmentBindingBrand: unique symbol;
declare const verifiedAttachmentDetachBrand: unique symbol;
declare const verifiedBlobKekTargetsBrand: unique symbol;
declare const verifiedContainerParentEdgeBrand: unique symbol;
declare const verifiedContainerKekStateBrand: unique symbol;
declare const verifiedWriteHeaderBrand: unique symbol;
declare const verifiedTransparencyTreeHeadBrand: unique symbol;
declare const verifiedTransparencyProofBrand: unique symbol;

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
  readonly checkpoint: PrincipalPolicyCheckpoint;
  readonly [verifiedPrincipalPolicyBrand]: true;
}

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
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly state: ContainerAccessManifestState;
  readonly checkpoint: AccessManifestCheckpoint;
  readonly [verifiedContainerAccessManifestBrand]: true;
}

export interface VerifiedDocumentLinkSetManifest {
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly state: DocumentLinkSetManifestState;
  readonly checkpoint: AccessManifestCheckpoint;
  readonly [verifiedDocumentLinkSetManifestBrand]: true;
}

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
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
}

export interface VerifyContainerParentEdgeInput {
  readonly child: VerifiedContainerAccessManifest;
  readonly parentHistory: readonly VerifiedContainerAccessManifest[];
}

export interface VerifyDocumentLinkSetManifestInput {
  readonly manifest: AccessManifest;
  readonly expectedManifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly previousManifest?: VerifiedDocumentLinkSetManifest | null;
  readonly localCheckpoint?: AccessManifestCheckpoint | null | undefined;
  readonly checkpointPredecessors?:
    | readonly AnyVerifiedAccessManifest[]
    | undefined;
  readonly targetContainerPath?: readonly VerifiedContainerAccessManifest[];
  readonly authorizingContainerPaths?: readonly VerifiedContainerAccessManifest[][];
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
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
}

export interface PrincipalPolicyBundle {
  readonly currentState: PrincipalPolicySignedState;
  readonly currentPayload: PrincipalPolicyPayload;
  readonly currentProjection: readonly PrincipalProjectionMember[];
  readonly currentMemberEnvelopes?: PrincipalPolicyMemberEnvelopes;
  readonly previousStates: readonly PrincipalPolicyStateChainEntry[];
}

export interface PrincipalPolicySignerPublicKey {
  readonly userId: string;
  readonly signingKeyFingerprint: string;
  readonly signingPublicKey: Uint8Array;
}

export interface VerifyPrincipalPolicyBundleInput {
  readonly bundle: PrincipalPolicyBundle;
  readonly expectedReference?: ReferencedPrincipalHead;
  readonly localCheckpoint?: PrincipalPolicyCheckpoint | null;
  readonly signerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
}

interface NormalizedPrincipalPolicyStateChainEntry {
  readonly state: PrincipalPolicySignedState;
  readonly projection: PrincipalProjectionMember[];
}

function ok<T>(value: T): KeyingVerificationResult<T> {
  return { ok: true, value };
}

function fail<T>(
  code: KeyingVerificationCode,
  message: string,
): KeyingVerificationResult<T> {
  return {
    ok: false,
    error: new KeyingVerificationError(code, message),
  };
}

function throwVerification(
  code: KeyingVerificationCode,
  message: string,
): never {
  throw new KeyingVerificationError(code, message);
}

function toVerificationResult<T>(error: unknown): KeyingVerificationResult<T> {
  if (error instanceof KeyingVerificationError) {
    return { ok: false, error };
  }

  return fail(
    "invalid_shape",
    error instanceof Error ? error.message : String(error),
  );
}

async function runVerifier<T>(
  operation: () => Promise<T>,
): Promise<KeyingVerificationResult<T>> {
  try {
    return ok(await operation());
  } catch (error) {
    return toVerificationResult(error);
  }
}

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertExactKeys<const ExpectedKeys extends readonly string[]>(
  value: unknown,
  expectedKeys: ExpectedKeys,
  label: string,
): Record<ExpectedKeys[number], unknown> {
  if (!isPlainObject(value)) {
    throwVerification("invalid_shape", `${label} must be a plain object`);
  }

  const actualKeys = [
    ...Object.getOwnPropertyNames(value),
    ...Object.getOwnPropertySymbols(value).map(String),
  ].sort(compareCanonicalStrings);
  const sortedExpectedKeys = [...expectedKeys].sort(compareCanonicalStrings);

  if (
    actualKeys.length !== sortedExpectedKeys.length ||
    actualKeys.some((key, index) => key !== sortedExpectedKeys[index])
  ) {
    throwVerification(
      "invalid_shape",
      `${label} has unexpected keys: ${actualKeys.join(",")}`,
    );
  }

  return value;
}

function readString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = record[key];

  if (typeof value !== "string" || value.length === 0) {
    throwVerification("invalid_shape", `${label}.${key} must be a string`);
  }

  return value;
}

function readNullableString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  const value = record[key];

  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || value.length === 0) {
    throwVerification(
      "invalid_shape",
      `${label}.${key} must be null or string`,
    );
  }

  return value;
}

function readHashString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = readString(record, key, label);

  if (!/^[0-9a-f]{64}$/.test(value)) {
    throwVerification(
      "hash_mismatch",
      `${label}.${key} must be a 64-character lowercase hex hash`,
    );
  }

  return value;
}

function readContentRecordId(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = readString(record, key, label).toLowerCase();

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  ) {
    throwVerification(
      "invalid_shape",
      `${label}.${key} must be a UUIDv4 content record id`,
    );
  }

  return value;
}

function readNullableHashString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  const value = record[key];

  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throwVerification(
      "hash_mismatch",
      `${label}.${key} must be null or a 64-character lowercase hex hash`,
    );
  }

  return value;
}

function readPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = record[key];

  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
    throwVerification(
      "invalid_shape",
      `${label}.${key} must be a positive integer`,
    );
  }

  return value;
}

function readNonNegativeInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = record[key];

  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    throwVerification(
      "invalid_shape",
      `${label}.${key} must be a non-negative integer`,
    );
  }

  return value;
}

function readVersion(record: { readonly version: unknown }, label: string): 1 {
  const value = record.version;

  if (value !== 1) {
    throwVerification("invalid_domain", `${label}.version must be 1`);
  }

  return 1;
}

function readSignedAt(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = readString(record, key, label);

  if (Number.isNaN(new Date(value).valueOf())) {
    throwVerification("invalid_shape", `${label}.${key} must be a timestamp`);
  }

  return value;
}

function readStringArray(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string[] {
  const value = record[key];

  if (!Array.isArray(value)) {
    throwVerification("invalid_shape", `${label}.${key} must be an array`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string" || item.length === 0) {
      throwVerification(
        "invalid_shape",
        `${label}.${key}[${index}] must be a string`,
      );
    }

    return item;
  });
}

function normalizeUniqueSortedStrings(
  values: readonly string[],
  label: string,
): string[] {
  const sortedValues = [...values].sort(compareCanonicalStrings);

  for (let index = 1; index < sortedValues.length; index += 1) {
    if (sortedValues[index - 1] === sortedValues[index]) {
      throwVerification("duplicate_entry", `${label} contains a duplicate`);
    }
  }

  return sortedValues;
}

function normalizeCanonicalJsonValue(
  value: KeyingCanonicalJson,
  label: string,
): KeyingCanonicalJson {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throwVerification(
        "invalid_shape",
        `${label} contains a non-finite number`,
      );
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      normalizeCanonicalJsonValue(item, `${label}[${index}]`),
    );
  }

  if (!isPlainObject(value)) {
    throwVerification("invalid_shape", `${label} must be canonical JSON`);
  }

  const normalized: Record<string, KeyingCanonicalJson> = {};

  for (const key of Object.keys(value).sort(compareCanonicalStrings)) {
    const item = value[key];
    if (item === undefined) {
      throwVerification("invalid_shape", `${label}.${key} is undefined`);
    }
    normalized[key] = normalizeCanonicalJsonValue(item, `${label}.${key}`);
  }

  return normalized;
}

function stringifyNormalizedCanonicalJson(value: KeyingCanonicalJson): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    return JSON.stringify(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyNormalizedCanonicalJson(item)).join(",")}]`;
  }

  const normalizedObject = value as {
    readonly [key: string]: KeyingCanonicalJson;
  };

  return `{${Object.keys(normalizedObject)
    .sort(compareCanonicalStrings)
    .map((key) => {
      const item = normalizedObject[key];
      if (item === undefined) {
        throwVerification("invalid_shape", `payload.${key} is undefined`);
      }
      return `${JSON.stringify(key)}:${stringifyNormalizedCanonicalJson(item)}`;
    })
    .join(",")}}`;
}

function stringifyCanonicalJson(value: KeyingCanonicalJson): string {
  return stringifyNormalizedCanonicalJson(
    normalizeCanonicalJsonValue(value, "payload"),
  );
}

function encodeDomainPayload(
  domain: KeyingHashDomain,
  payload: KeyingCanonicalJson,
): Uint8Array {
  return TEXT_ENCODER.encode(
    stringifyCanonicalJson({
      domain,
      payload,
    }),
  );
}

export function serializeKeyingCanonicalJson(
  value: KeyingCanonicalJson,
): string {
  return stringifyCanonicalJson(value);
}

export async function computeKeyingDomainHash(
  domain: KeyingHashDomain,
  payload: KeyingCanonicalJson,
): Promise<string> {
  return toFingerprint(encodeDomainPayload(domain, payload));
}

export function documentContentRecordMetadata(
  input: DocumentContentRecordMetadataInput,
): KeyingCanonicalPayload<DocumentContentRecordMetadataInput> & {
  readonly recordKind: "loro_update";
  readonly version: 1;
} {
  return {
    version: 1,
    recordKind: "loro_update",
    documentId: input.documentId,
    updateId: input.updateId,
    partialStartVersionVector: input.partialStartVersionVector,
    partialEndVersionVector: input.partialEndVersionVector,
  };
}

export async function computeDocumentContentRecordMetadataHash(
  input: DocumentContentRecordMetadataInput,
): Promise<string> {
  return computeKeyingDomainHash(
    "tearleads.document.content-record-metadata",
    documentContentRecordMetadata(input),
  );
}

export async function computeDocumentContentRecordCiphertextHash(
  encryptedData: string,
): Promise<string> {
  return computeKeyingDomainHash(
    "tearleads.document.content-record-ciphertext",
    encryptedData,
  );
}

function isAccessEventType(value: string): value is AccessEventType {
  return (
    value === "attachment.bind" ||
    value === "attachment.detach" ||
    value === "container.create" ||
    value === "container.grant" ||
    value === "container.move" ||
    value === "container.rekey" ||
    value === "container.revoke" ||
    value === "document.link" ||
    value === "document.unlink"
  );
}

function isAccessObjectKind(value: string): value is AccessObjectKind {
  return value === "blob" || value === "container" || value === "document";
}

function isManagedPrincipalKind(value: string): value is ManagedPrincipalKind {
  return value === "group" || value === "organization";
}

function isKekRecipientKind(value: string): value is KekRecipientKind {
  return (
    value === "container" ||
    value === "group" ||
    value === "organization" ||
    value === "user"
  );
}

function isContentObjectKind(value: string): value is ContentObjectKind {
  return value === "blob" || value === "document";
}

function isContainerAccessLevel(value: string): value is ContainerAccessLevel {
  return value === "admin" || value === "read" || value === "write";
}

function isContainerGrantSubjectType(
  value: string,
): value is ContainerGrantSubjectType {
  return value === "group" || value === "organization" || value === "user";
}

function expectedObjectKindForEventType(
  eventType: AccessEventType,
): AccessObjectKind {
  if (eventType.startsWith("container.")) {
    return "container";
  }

  if (eventType.startsWith("document.")) {
    return "document";
  }

  return "blob";
}

function normalizeAccessEventType(
  value: unknown,
  label: string,
): AccessEventType {
  if (typeof value !== "string" || !isAccessEventType(value)) {
    throwVerification("invalid_domain", `${label}.eventType is unsupported`);
  }

  return value;
}

function normalizeAccessObjectKind(
  value: unknown,
  label: string,
): AccessObjectKind {
  if (typeof value !== "string" || !isAccessObjectKind(value)) {
    throwVerification("invalid_domain", `${label}.objectKind is unsupported`);
  }

  return value;
}

function normalizeManagedPrincipalKind(
  value: unknown,
  label: string,
): ManagedPrincipalKind {
  if (typeof value !== "string" || !isManagedPrincipalKind(value)) {
    throwVerification(
      "invalid_domain",
      `${label}.principalType is unsupported`,
    );
  }

  return value;
}

function normalizeKekRecipientKind(
  value: unknown,
  label: string,
): KekRecipientKind {
  if (typeof value !== "string" || !isKekRecipientKind(value)) {
    throwVerification(
      "invalid_domain",
      `${label}.recipientKind is unsupported`,
    );
  }

  return value;
}

function normalizeContentObjectKind(
  value: unknown,
  label: string,
): ContentObjectKind {
  if (typeof value !== "string" || !isContentObjectKind(value)) {
    throwVerification("invalid_domain", `${label}.objectKind is unsupported`);
  }

  return value;
}

function normalizeContentRecordEncryptionSuite(
  value: unknown,
  label: string,
): ContentRecordEncryptionSuite {
  if (value !== CONTENT_RECORD_ENCRYPTION_SUITE) {
    throwVerification(
      "invalid_domain",
      `${label}.encryptionSuite is unsupported`,
    );
  }

  return value;
}

function normalizeContainerAccessLevel(
  value: unknown,
  label: string,
): ContainerAccessLevel {
  if (typeof value !== "string" || !isContainerAccessLevel(value)) {
    throwVerification("invalid_domain", `${label}.accessLevel is unsupported`);
  }

  return value;
}

function normalizeContainerGrantSubjectType(
  value: unknown,
  label: string,
): ContainerGrantSubjectType {
  if (typeof value !== "string" || !isContainerGrantSubjectType(value)) {
    throwVerification("invalid_domain", `${label}.subjectType is unsupported`);
  }

  return value;
}

function readHashArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throwVerification("invalid_shape", `${label} must be an array`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string" || !/^[0-9a-f]{64}$/.test(item)) {
      throwVerification(
        "hash_mismatch",
        `${label}[${index}] must be a 64-character lowercase hex hash`,
      );
    }

    return item;
  });
}

function normalizeIdentityStateHead(
  value: IdentityStateHead,
): IdentityStateHead {
  const record = assertExactKeys(
    value,
    ["identityId", "previousStateHash", "stateHash", "version"],
    "identity state head",
  );

  return {
    identityId: readString(record, "identityId", "identity state head"),
    version: readPositiveInteger(record, "version", "identity state head"),
    stateHash: readHashString(record, "stateHash", "identity state head"),
    previousStateHash: readNullableHashString(
      record,
      "previousStateHash",
      "identity state head",
    ),
  };
}

function normalizeIdentityStateCheckpoint(
  value: IdentityStateCheckpoint,
): IdentityStateCheckpoint {
  const record = assertExactKeys(
    value,
    ["identityId", "stateHash", "version"],
    "identity state checkpoint",
  );

  return {
    identityId: readString(record, "identityId", "identity state checkpoint"),
    version: readPositiveInteger(
      record,
      "version",
      "identity state checkpoint",
    ),
    stateHash: readHashString(record, "stateHash", "identity state checkpoint"),
  };
}

function identityStateCheckpointFromHead(
  head: IdentityStateHead,
): IdentityStateCheckpoint {
  return {
    identityId: head.identityId,
    version: head.version,
    stateHash: head.stateHash,
  };
}

function verifyIdentityStateCheckpointChain(input: {
  readonly head: IdentityStateHead;
  readonly localCheckpoint: IdentityStateCheckpoint | null | undefined;
  readonly checkpointPredecessors: readonly IdentityStateHead[] | undefined;
}): void {
  const { head, localCheckpoint } = input;

  if (!localCheckpoint) {
    return;
  }

  if (head.identityId !== localCheckpoint.identityId) {
    throwVerification(
      "object_mismatch",
      "identity state checkpoint does not match current identity",
    );
  }

  if (head.version < localCheckpoint.version) {
    throwVerification(
      "rollback",
      "identity state head is older than the local checkpoint",
    );
  }

  if (
    head.version === localCheckpoint.version &&
    head.stateHash !== localCheckpoint.stateHash
  ) {
    throwVerification(
      "equivocation",
      "identity state head conflicts with the local checkpoint",
    );
  }

  if (head.version === localCheckpoint.version) {
    return;
  }

  let expectedVersion = localCheckpoint.version + 1;
  let expectedPreviousHash = localCheckpoint.stateHash;
  const chain = [
    ...(input.checkpointPredecessors ?? []).map(normalizeIdentityStateHead),
    head,
  ];

  for (const chainHead of chain) {
    if (chainHead.identityId !== localCheckpoint.identityId) {
      throwVerification(
        "object_mismatch",
        "identity state checkpoint predecessor identity mismatch",
      );
    }

    if (
      chainHead.version !== expectedVersion ||
      chainHead.previousStateHash !== expectedPreviousHash
    ) {
      throwVerification(
        "stale_predecessor",
        "identity state chain does not extend the local checkpoint",
      );
    }

    expectedVersion += 1;
    expectedPreviousHash = chainHead.stateHash;
  }
}

export async function verifyIdentityStateCheckpoint({
  checkpointPredecessors,
  head,
  localCheckpoint,
}: VerifyIdentityStateCheckpointInput): Promise<
  KeyingVerificationResult<VerifiedIdentityState>
> {
  return runVerifier(async () => {
    const normalizedHead = normalizeIdentityStateHead(head);
    verifyIdentityStateCheckpointChain({
      head: normalizedHead,
      localCheckpoint: localCheckpoint
        ? normalizeIdentityStateCheckpoint(localCheckpoint)
        : null,
      checkpointPredecessors,
    });

    return {
      identityId: normalizedHead.identityId,
      version: normalizedHead.version,
      stateHash: normalizedHead.stateHash,
      head: normalizedHead,
      checkpoint: identityStateCheckpointFromHead(normalizedHead),
    } as VerifiedIdentityState;
  });
}

function normalizeAccessManifestCheckpoint(
  value: AccessManifestCheckpoint,
): AccessManifestCheckpoint {
  const record = assertExactKeys(
    value,
    ["epoch", "manifestHash", "objectId", "objectKind", "organizationId"],
    "access manifest checkpoint",
  );

  return {
    objectKind: normalizeAccessObjectKind(
      record.objectKind,
      "access manifest checkpoint",
    ),
    objectId: readString(record, "objectId", "access manifest checkpoint"),
    organizationId: readString(
      record,
      "organizationId",
      "access manifest checkpoint",
    ),
    epoch: readPositiveInteger(record, "epoch", "access manifest checkpoint"),
    manifestHash: readHashString(
      record,
      "manifestHash",
      "access manifest checkpoint",
    ),
  };
}

function accessManifestCheckpointFromManifest(input: {
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
}): AccessManifestCheckpoint {
  return {
    objectKind: input.manifest.objectKind,
    objectId: input.manifest.objectId,
    organizationId: input.manifest.organizationId,
    epoch: input.manifest.epoch,
    manifestHash: input.manifestHash,
  };
}

function accessManifestCheckpointObjectMatches(
  left: AccessManifestCheckpoint,
  right: AccessManifestCheckpoint,
): boolean {
  return (
    left.objectKind === right.objectKind &&
    left.objectId === right.objectId &&
    left.organizationId === right.organizationId
  );
}

function verifiedAccessManifestCheckpointLink(
  manifest: AnyVerifiedAccessManifest,
): AccessManifestCheckpoint & {
  readonly previousManifestHash: string | null;
} {
  return {
    ...manifest.checkpoint,
    previousManifestHash: manifest.manifest.previousManifestHash,
  };
}

function verifyAccessManifestLocalCheckpoint(input: {
  readonly current: AccessManifestCheckpoint & {
    readonly previousManifestHash: string | null;
  };
  readonly localCheckpoint: AccessManifestCheckpoint | null | undefined;
  readonly checkpointPredecessors:
    | readonly AnyVerifiedAccessManifest[]
    | undefined;
}): void {
  const { current, localCheckpoint } = input;

  if (!localCheckpoint) {
    return;
  }

  const normalizedCheckpoint =
    normalizeAccessManifestCheckpoint(localCheckpoint);

  if (!accessManifestCheckpointObjectMatches(current, normalizedCheckpoint)) {
    throwVerification(
      "object_mismatch",
      "access manifest checkpoint does not match current object",
    );
  }

  if (current.epoch < normalizedCheckpoint.epoch) {
    throwVerification(
      "rollback",
      "access manifest is older than the local checkpoint",
    );
  }

  if (
    current.epoch === normalizedCheckpoint.epoch &&
    current.manifestHash !== normalizedCheckpoint.manifestHash
  ) {
    throwVerification(
      "equivocation",
      "access manifest conflicts with the local checkpoint",
    );
  }

  if (current.epoch === normalizedCheckpoint.epoch) {
    return;
  }

  let expectedEpoch = normalizedCheckpoint.epoch + 1;
  let expectedPreviousHash = normalizedCheckpoint.manifestHash;
  const chain = [
    ...(input.checkpointPredecessors ?? []).map(
      verifiedAccessManifestCheckpointLink,
    ),
    current,
  ];

  for (const link of chain) {
    if (!accessManifestCheckpointObjectMatches(link, normalizedCheckpoint)) {
      throwVerification(
        "object_mismatch",
        "access manifest checkpoint predecessor object mismatch",
      );
    }

    if (
      link.epoch !== expectedEpoch ||
      link.previousManifestHash !== expectedPreviousHash
    ) {
      throwVerification(
        "stale_predecessor",
        "access manifest chain does not extend the local checkpoint",
      );
    }

    expectedEpoch += 1;
    expectedPreviousHash = link.manifestHash;
  }
}

function normalizeIdentityTransparencyLeaf(
  value: IdentityStateTransparencyLeaf,
): IdentityStateTransparencyLeaf {
  const record = assertExactKeys(
    value,
    ["identityId", "leafKind", "stateHash", "stateVersion", "version"],
    "identity transparency leaf",
  );

  if (record.leafKind !== "identity_state_head") {
    throwVerification(
      "invalid_domain",
      "identity transparency leaf.leafKind is unsupported",
    );
  }

  return {
    version: readVersion(record, "identity transparency leaf"),
    leafKind: "identity_state_head",
    identityId: readString(record, "identityId", "identity transparency leaf"),
    stateVersion: readPositiveInteger(
      record,
      "stateVersion",
      "identity transparency leaf",
    ),
    stateHash: readHashString(
      record,
      "stateHash",
      "identity transparency leaf",
    ),
  };
}

function normalizePrincipalPolicyTransparencyLeaf(
  value: PrincipalPolicyTransparencyLeaf,
): PrincipalPolicyTransparencyLeaf {
  const record = assertExactKeys(
    value,
    [
      "keyEpoch",
      "keyFingerprint",
      "leafKind",
      "policyVersion",
      "principalId",
      "principalType",
      "stateHash",
      "version",
    ],
    "principal policy transparency leaf",
  );

  if (record.leafKind !== "principal_policy_head") {
    throwVerification(
      "invalid_domain",
      "principal policy transparency leaf.leafKind is unsupported",
    );
  }

  return {
    version: readVersion(record, "principal policy transparency leaf"),
    leafKind: "principal_policy_head",
    principalType: normalizeManagedPrincipalKind(
      record.principalType,
      "principal policy transparency leaf",
    ),
    principalId: readString(
      record,
      "principalId",
      "principal policy transparency leaf",
    ),
    policyVersion: readPositiveInteger(
      record,
      "policyVersion",
      "principal policy transparency leaf",
    ),
    keyEpoch: readPositiveInteger(
      record,
      "keyEpoch",
      "principal policy transparency leaf",
    ),
    stateHash: readHashString(
      record,
      "stateHash",
      "principal policy transparency leaf",
    ),
    keyFingerprint: readHashString(
      record,
      "keyFingerprint",
      "principal policy transparency leaf",
    ),
  };
}

function normalizeAccessManifestTransparencyLeaf(
  value: AccessManifestTransparencyLeaf,
): AccessManifestTransparencyLeaf {
  const record = assertExactKeys(
    value,
    [
      "epoch",
      "leafKind",
      "manifestHash",
      "objectId",
      "objectKind",
      "organizationId",
      "version",
    ],
    "access manifest transparency leaf",
  );

  if (record.leafKind !== "access_manifest_head") {
    throwVerification(
      "invalid_domain",
      "access manifest transparency leaf.leafKind is unsupported",
    );
  }

  return {
    version: readVersion(record, "access manifest transparency leaf"),
    leafKind: "access_manifest_head",
    objectKind: normalizeAccessObjectKind(
      record.objectKind,
      "access manifest transparency leaf",
    ),
    objectId: readString(
      record,
      "objectId",
      "access manifest transparency leaf",
    ),
    organizationId: readString(
      record,
      "organizationId",
      "access manifest transparency leaf",
    ),
    epoch: readPositiveInteger(
      record,
      "epoch",
      "access manifest transparency leaf",
    ),
    manifestHash: readHashString(
      record,
      "manifestHash",
      "access manifest transparency leaf",
    ),
  };
}

function normalizeTransparencyLeaf(value: TransparencyLeaf): TransparencyLeaf {
  if (!isPlainObject(value)) {
    throwVerification("invalid_shape", "transparency leaf must be an object");
  }

  if (value.leafKind === "identity_state_head") {
    return normalizeIdentityTransparencyLeaf(
      value as IdentityStateTransparencyLeaf,
    );
  }

  if (value.leafKind === "principal_policy_head") {
    return normalizePrincipalPolicyTransparencyLeaf(
      value as PrincipalPolicyTransparencyLeaf,
    );
  }

  if (value.leafKind === "access_manifest_head") {
    return normalizeAccessManifestTransparencyLeaf(
      value as AccessManifestTransparencyLeaf,
    );
  }

  throwVerification(
    "invalid_domain",
    "transparency leaf.leafKind is unsupported",
  );
}

export function identityStateTransparencyLeaf(
  head: IdentityStateHead,
): IdentityStateTransparencyLeaf {
  const normalizedHead = normalizeIdentityStateHead(head);

  return {
    version: 1,
    leafKind: "identity_state_head",
    identityId: normalizedHead.identityId,
    stateVersion: normalizedHead.version,
    stateHash: normalizedHead.stateHash,
  };
}

export function principalPolicyTransparencyLeaf(
  policy: VerifiedPrincipalPolicy,
): PrincipalPolicyTransparencyLeaf {
  return {
    version: 1,
    leafKind: "principal_policy_head",
    principalType: policy.principalType,
    principalId: policy.principalId,
    policyVersion: policy.version,
    keyEpoch: policy.keyEpoch,
    stateHash: policy.stateHash,
    keyFingerprint: policy.state.keyFingerprint,
  };
}

export function accessManifestTransparencyLeaf(
  manifest: AnyVerifiedAccessManifest,
): AccessManifestTransparencyLeaf {
  return {
    version: 1,
    leafKind: "access_manifest_head",
    objectKind: manifest.checkpoint.objectKind,
    objectId: manifest.checkpoint.objectId,
    organizationId: manifest.checkpoint.organizationId,
    epoch: manifest.checkpoint.epoch,
    manifestHash: manifest.checkpoint.manifestHash,
  };
}

export async function computeTransparencyLeafHash(
  leaf: TransparencyLeaf,
): Promise<string> {
  const payload: KeyingCanonicalPayload<TransparencyLeaf> =
    normalizeTransparencyLeaf(leaf);

  return computeKeyingDomainHash("tearleads.keying.transparency-leaf", payload);
}

async function computeTransparencyEmptyTreeHash(): Promise<string> {
  return computeKeyingDomainHash("tearleads.keying.transparency-empty-tree", {
    version: 1,
  });
}

async function computeTransparencyNodeHash(
  leftHash: string,
  rightHash: string,
): Promise<string> {
  return computeKeyingDomainHash("tearleads.keying.transparency-node", {
    leftHash,
    rightHash,
    version: 1,
  });
}

function largestPowerOfTwoLessThan(value: number): number {
  let power = 1;

  while (power * 2 < value) {
    power *= 2;
  }

  return power;
}

function normalizeLeafHashes(
  leafHashes: readonly string[],
  label: string,
): string[] {
  return readHashArray(leafHashes, label);
}

export async function computeTransparencyMerkleRoot(
  leafHashes: readonly string[],
): Promise<string> {
  const normalizedLeafHashes = normalizeLeafHashes(
    leafHashes,
    "transparency leaf hashes",
  );

  if (normalizedLeafHashes.length === 0) {
    return computeTransparencyEmptyTreeHash();
  }

  if (normalizedLeafHashes.length === 1) {
    return normalizedLeafHashes[0] as string;
  }

  const splitIndex = largestPowerOfTwoLessThan(normalizedLeafHashes.length);
  return computeTransparencyNodeHash(
    await computeTransparencyMerkleRoot(
      normalizedLeafHashes.slice(0, splitIndex),
    ),
    await computeTransparencyMerkleRoot(normalizedLeafHashes.slice(splitIndex)),
  );
}

async function createTransparencyInclusionAuditPath(input: {
  readonly leafHashes: readonly string[];
  readonly leafIndex: number;
}): Promise<string[]> {
  if (input.leafHashes.length === 1) {
    return [];
  }

  const splitIndex = largestPowerOfTwoLessThan(input.leafHashes.length);
  if (input.leafIndex < splitIndex) {
    return [
      ...(await createTransparencyInclusionAuditPath({
        leafHashes: input.leafHashes.slice(0, splitIndex),
        leafIndex: input.leafIndex,
      })),
      await computeTransparencyMerkleRoot(input.leafHashes.slice(splitIndex)),
    ];
  }

  return [
    ...(await createTransparencyInclusionAuditPath({
      leafHashes: input.leafHashes.slice(splitIndex),
      leafIndex: input.leafIndex - splitIndex,
    })),
    await computeTransparencyMerkleRoot(input.leafHashes.slice(0, splitIndex)),
  ];
}

export async function createTransparencyInclusionProof(
  leafHashes: readonly string[],
  leafIndex: number,
): Promise<TransparencyInclusionProof> {
  const normalizedLeafHashes = normalizeLeafHashes(
    leafHashes,
    "transparency leaf hashes",
  );

  if (normalizedLeafHashes.length === 0) {
    throwVerification(
      "invalid_shape",
      "transparency inclusion proof requires at least one leaf",
    );
  }

  if (
    !Number.isInteger(leafIndex) ||
    leafIndex < 0 ||
    leafIndex >= normalizedLeafHashes.length
  ) {
    throwVerification(
      "invalid_shape",
      "transparency inclusion proof leafIndex is out of bounds",
    );
  }

  return {
    version: 1,
    treeSize: normalizedLeafHashes.length,
    leafIndex,
    auditPath: await createTransparencyInclusionAuditPath({
      leafHashes: normalizedLeafHashes,
      leafIndex,
    }),
  };
}

async function createTransparencyConsistencyNodeHashes(input: {
  readonly leafHashes: readonly string[];
  readonly previousTreeSize: number;
  readonly subtreeComplete: boolean;
}): Promise<string[]> {
  const treeSize = input.leafHashes.length;

  if (input.previousTreeSize === treeSize) {
    return input.subtreeComplete
      ? []
      : [await computeTransparencyMerkleRoot(input.leafHashes)];
  }

  const splitIndex = largestPowerOfTwoLessThan(treeSize);
  if (input.previousTreeSize <= splitIndex) {
    return [
      ...(await createTransparencyConsistencyNodeHashes({
        leafHashes: input.leafHashes.slice(0, splitIndex),
        previousTreeSize: input.previousTreeSize,
        subtreeComplete: input.subtreeComplete,
      })),
      await computeTransparencyMerkleRoot(input.leafHashes.slice(splitIndex)),
    ];
  }

  return [
    ...(await createTransparencyConsistencyNodeHashes({
      leafHashes: input.leafHashes.slice(splitIndex),
      previousTreeSize: input.previousTreeSize - splitIndex,
      subtreeComplete: false,
    })),
    await computeTransparencyMerkleRoot(input.leafHashes.slice(0, splitIndex)),
  ];
}

export async function createTransparencyConsistencyProof(
  leafHashes: readonly string[],
  previousTreeSize: number,
): Promise<TransparencyConsistencyProof> {
  const normalizedLeafHashes = normalizeLeafHashes(
    leafHashes,
    "transparency leaf hashes",
  );

  if (
    !Number.isInteger(previousTreeSize) ||
    previousTreeSize < 0 ||
    previousTreeSize > normalizedLeafHashes.length
  ) {
    throwVerification(
      "invalid_shape",
      "transparency consistency proof previousTreeSize is out of bounds",
    );
  }

  return {
    version: 1,
    previousTreeSize,
    treeSize: normalizedLeafHashes.length,
    nodeHashes:
      previousTreeSize === 0
        ? []
        : await createTransparencyConsistencyNodeHashes({
            leafHashes: normalizedLeafHashes,
            previousTreeSize,
            subtreeComplete: true,
          }),
  };
}

function normalizeUnsignedTransparencyTreeHead(
  value: UnsignedTransparencyTreeHead,
): UnsignedTransparencyTreeHead {
  const record = assertExactKeys(
    value,
    [
      "logId",
      "logKeyFingerprint",
      "rootHash",
      "signedAt",
      "treeSize",
      "version",
    ],
    "transparency tree head",
  );

  return {
    version: readVersion(record, "transparency tree head"),
    logId: readString(record, "logId", "transparency tree head"),
    treeSize: readNonNegativeInteger(
      record,
      "treeSize",
      "transparency tree head",
    ),
    rootHash: readHashString(record, "rootHash", "transparency tree head"),
    signedAt: readSignedAt(record, "signedAt", "transparency tree head"),
    logKeyFingerprint: readHashString(
      record,
      "logKeyFingerprint",
      "transparency tree head",
    ),
  };
}

function normalizeSignedTransparencyTreeHead(
  value: SignedTransparencyTreeHead,
): SignedTransparencyTreeHead {
  const record = assertExactKeys(
    value,
    [
      "logId",
      "logKeyFingerprint",
      "rootHash",
      "signature",
      "signedAt",
      "treeSize",
      "version",
    ],
    "transparency tree head",
  );
  const unsignedHead = normalizeUnsignedTransparencyTreeHead({
    version: record.version,
    logId: record.logId,
    treeSize: record.treeSize,
    rootHash: record.rootHash,
    signedAt: record.signedAt,
    logKeyFingerprint: record.logKeyFingerprint,
  } as UnsignedTransparencyTreeHead);

  return {
    ...unsignedHead,
    signature: readString(record, "signature", "transparency tree head"),
  };
}

function transparencyTreeHeadSigningBytes(
  treeHead: UnsignedTransparencyTreeHead,
): Uint8Array {
  const payload: KeyingCanonicalPayload<UnsignedTransparencyTreeHead> =
    normalizeUnsignedTransparencyTreeHead(treeHead);

  return encodeDomainPayload(
    "tearleads.keying.transparency-tree-head-signing",
    payload,
  );
}

function toUnsignedTransparencyTreeHead(
  treeHead: SignedTransparencyTreeHead,
): UnsignedTransparencyTreeHead {
  return {
    version: treeHead.version,
    logId: treeHead.logId,
    treeSize: treeHead.treeSize,
    rootHash: treeHead.rootHash,
    signedAt: treeHead.signedAt,
    logKeyFingerprint: treeHead.logKeyFingerprint,
  };
}

export async function signTransparencyTreeHead(
  treeHead: UnsignedTransparencyTreeHead,
  signingPrivateKey: Uint8Array,
): Promise<SignedTransparencyTreeHead> {
  const normalizedTreeHead = normalizeUnsignedTransparencyTreeHead(treeHead);
  const signature = sign(
    transparencyTreeHeadSigningBytes(normalizedTreeHead),
    signingPrivateKey,
  );

  return {
    ...normalizedTreeHead,
    signature: bytesToBase64(signature),
  };
}

function transparencyTreeCheckpointFromHead(
  treeHead: UnsignedTransparencyTreeHead,
): TransparencyTreeCheckpoint {
  return {
    logId: treeHead.logId,
    treeSize: treeHead.treeSize,
    rootHash: treeHead.rootHash,
  };
}

export async function verifySignedTransparencyTreeHead({
  logPublicKey,
  treeHead,
}: VerifySignedTransparencyTreeHeadInput): Promise<
  KeyingVerificationResult<VerifiedTransparencyTreeHead>
> {
  return runVerifier(async () => {
    const normalizedTreeHead = normalizeSignedTransparencyTreeHead(treeHead);
    const logKeyFingerprint = await toFingerprint(logPublicKey);
    if (logKeyFingerprint !== normalizedTreeHead.logKeyFingerprint) {
      throwVerification(
        "signer_mismatch",
        "transparency tree head log key fingerprint does not match public key",
      );
    }

    let signature: Uint8Array;
    try {
      signature = base64ToBytes(normalizedTreeHead.signature);
    } catch {
      throwVerification(
        "signature_mismatch",
        "transparency tree head signature invalid",
      );
    }

    if (
      !verify(
        signature,
        transparencyTreeHeadSigningBytes(
          toUnsignedTransparencyTreeHead(normalizedTreeHead),
        ),
        logPublicKey,
      )
    ) {
      throwVerification(
        "signature_mismatch",
        "transparency tree head signature verification failed",
      );
    }

    return {
      treeHead: normalizedTreeHead,
      checkpoint: transparencyTreeCheckpointFromHead(normalizedTreeHead),
    } as VerifiedTransparencyTreeHead;
  });
}

function normalizeTransparencyInclusionProof(
  value: TransparencyInclusionProof,
): TransparencyInclusionProof {
  const record = assertExactKeys(
    value,
    ["auditPath", "leafIndex", "treeSize", "version"],
    "transparency inclusion proof",
  );

  return {
    version: readVersion(record, "transparency inclusion proof"),
    treeSize: readPositiveInteger(
      record,
      "treeSize",
      "transparency inclusion proof",
    ),
    leafIndex: readNonNegativeInteger(
      record,
      "leafIndex",
      "transparency inclusion proof",
    ),
    auditPath: readHashArray(
      record.auditPath,
      "transparency inclusion proof.auditPath",
    ),
  };
}

function normalizeTransparencyConsistencyProof(
  value: TransparencyConsistencyProof,
): TransparencyConsistencyProof {
  const record = assertExactKeys(
    value,
    ["nodeHashes", "previousTreeSize", "treeSize", "version"],
    "transparency consistency proof",
  );

  return {
    version: readVersion(record, "transparency consistency proof"),
    previousTreeSize: readNonNegativeInteger(
      record,
      "previousTreeSize",
      "transparency consistency proof",
    ),
    treeSize: readNonNegativeInteger(
      record,
      "treeSize",
      "transparency consistency proof",
    ),
    nodeHashes: readHashArray(
      record.nodeHashes,
      "transparency consistency proof.nodeHashes",
    ),
  };
}

async function computeTransparencyInclusionRoot(input: {
  readonly leafHash: string;
  readonly proof: TransparencyInclusionProof;
}): Promise<string> {
  let proofIndex = input.proof.auditPath.length - 1;

  const computeRoot = async (
    leafIndex: number,
    treeSize: number,
  ): Promise<string> => {
    if (treeSize === 1) {
      return input.leafHash;
    }

    const siblingHash = input.proof.auditPath[proofIndex];
    if (!siblingHash) {
      throwVerification(
        "missing_dependency",
        "transparency inclusion proof is missing an audit path node",
      );
    }
    proofIndex -= 1;

    const splitIndex = largestPowerOfTwoLessThan(treeSize);
    if (leafIndex < splitIndex) {
      return computeTransparencyNodeHash(
        await computeRoot(leafIndex, splitIndex),
        siblingHash,
      );
    }

    return computeTransparencyNodeHash(
      siblingHash,
      await computeRoot(leafIndex - splitIndex, treeSize - splitIndex),
    );
  };

  const computedRoot = await computeRoot(
    input.proof.leafIndex,
    input.proof.treeSize,
  );

  if (proofIndex !== -1) {
    throwVerification(
      "invalid_shape",
      "transparency inclusion proof has extra audit path nodes",
    );
  }

  return computedRoot;
}

function verifyTransparencyInclusionProofAgainstHead(input: {
  readonly leafHash: string;
  readonly proof: TransparencyInclusionProof;
  readonly treeHead: VerifiedTransparencyTreeHead;
}): void {
  if (input.proof.treeSize !== input.treeHead.treeHead.treeSize) {
    throwVerification(
      "object_mismatch",
      "transparency inclusion proof tree size does not match tree head",
    );
  }

  if (input.proof.leafIndex >= input.proof.treeSize) {
    throwVerification(
      "invalid_shape",
      "transparency inclusion proof leafIndex is out of bounds",
    );
  }
}

async function verifyTransparencyInclusionRoot(input: {
  readonly leafHash: string;
  readonly proof: TransparencyInclusionProof;
  readonly treeHead: VerifiedTransparencyTreeHead;
}): Promise<void> {
  verifyTransparencyInclusionProofAgainstHead(input);
  const computedRoot = await computeTransparencyInclusionRoot({
    leafHash: input.leafHash,
    proof: input.proof,
  });

  if (computedRoot !== input.treeHead.treeHead.rootHash) {
    throwVerification(
      "hash_mismatch",
      "transparency inclusion proof root does not match tree head",
    );
  }
}

async function verifyTransparencyConsistencyRoot(input: {
  readonly proof: TransparencyConsistencyProof;
  readonly previousTreeHead: VerifiedTransparencyTreeHead;
  readonly treeHead: VerifiedTransparencyTreeHead;
}): Promise<void> {
  verifyTransparencyConsistencyShape(input);

  if (await verifyTrivialTransparencyConsistency(input)) {
    return;
  }

  const roots = await computeTransparencyConsistencyProofRoots(input);
  if (roots.proofIndex !== input.proof.nodeHashes.length) {
    throwVerification(
      "invalid_shape",
      "transparency consistency proof has extra nodes",
    );
  }

  verifyTransparencyConsistencyProofRoots({
    ...input,
    previousRoot: roots.previousRoot,
    currentRoot: roots.currentRoot,
  });
}

function verifyTransparencyConsistencyShape(input: {
  readonly proof: TransparencyConsistencyProof;
  readonly previousTreeHead: VerifiedTransparencyTreeHead;
  readonly treeHead: VerifiedTransparencyTreeHead;
}): void {
  if (input.previousTreeHead.treeHead.logId !== input.treeHead.treeHead.logId) {
    throwVerification(
      "object_mismatch",
      "transparency consistency proof log id does not match",
    );
  }

  if (
    input.proof.previousTreeSize !== input.previousTreeHead.treeHead.treeSize
  ) {
    throwVerification(
      "object_mismatch",
      "transparency consistency proof previous tree size does not match",
    );
  }

  if (input.proof.treeSize !== input.treeHead.treeHead.treeSize) {
    throwVerification(
      "object_mismatch",
      "transparency consistency proof tree size does not match",
    );
  }

  if (
    input.previousTreeHead.treeHead.treeSize > input.treeHead.treeHead.treeSize
  ) {
    throwVerification(
      "rollback",
      "transparency tree head is older than the local checkpoint",
    );
  }
}

async function verifyTrivialTransparencyConsistency(input: {
  readonly proof: TransparencyConsistencyProof;
  readonly previousTreeHead: VerifiedTransparencyTreeHead;
  readonly treeHead: VerifiedTransparencyTreeHead;
}): Promise<boolean> {
  if (input.previousTreeHead.treeHead.treeSize === 0) {
    const emptyRoot = await computeTransparencyEmptyTreeHash();
    if (input.previousTreeHead.treeHead.rootHash !== emptyRoot) {
      throwVerification(
        "hash_mismatch",
        "empty transparency tree checkpoint root is invalid",
      );
    }
    if (input.proof.nodeHashes.length !== 0) {
      throwVerification(
        "invalid_shape",
        "transparency consistency proof for empty tree must be empty",
      );
    }
    return true;
  }

  if (
    input.previousTreeHead.treeHead.treeSize ===
    input.treeHead.treeHead.treeSize
  ) {
    if (input.proof.nodeHashes.length !== 0) {
      throwVerification(
        "invalid_shape",
        "same-size transparency consistency proof must be empty",
      );
    }

    if (
      input.previousTreeHead.treeHead.rootHash !==
      input.treeHead.treeHead.rootHash
    ) {
      throwVerification(
        "equivocation",
        "same-size transparency tree head root changed",
      );
    }
    return true;
  }

  return false;
}

function readTransparencyConsistencyNode(
  proof: TransparencyConsistencyProof,
  proofIndex: number,
): string {
  const proofHash = proof.nodeHashes[proofIndex];
  if (!proofHash) {
    throwVerification(
      "missing_dependency",
      "transparency consistency proof is missing a node",
    );
  }
  return proofHash;
}

function halveTreeIndex(value: number): number {
  return Math.floor(value / 2);
}

interface TransparencyConsistencyRootState {
  readonly previousNodeIndex: number;
  readonly currentNodeIndex: number;
  readonly previousRoot: string;
  readonly currentRoot: string;
  readonly proofIndex: number;
}

function initializeTransparencyConsistencyRootState(input: {
  readonly proof: TransparencyConsistencyProof;
  readonly previousTreeHead: VerifiedTransparencyTreeHead;
  readonly treeHead: VerifiedTransparencyTreeHead;
}): TransparencyConsistencyRootState {
  let previousNodeIndex = input.previousTreeHead.treeHead.treeSize - 1;
  let currentNodeIndex = input.treeHead.treeHead.treeSize - 1;

  while (previousNodeIndex % 2 === 1) {
    previousNodeIndex = halveTreeIndex(previousNodeIndex);
    currentNodeIndex = halveTreeIndex(currentNodeIndex);
  }

  let proofIndex = 0;
  let previousRoot: string;
  let currentRoot: string;

  if (previousNodeIndex === 0) {
    previousRoot = input.previousTreeHead.treeHead.rootHash;
    currentRoot = input.previousTreeHead.treeHead.rootHash;
  } else {
    const firstProofHash = readTransparencyConsistencyNode(input.proof, 0);
    previousRoot = firstProofHash;
    currentRoot = firstProofHash;
    proofIndex += 1;
  }

  return {
    previousNodeIndex,
    currentNodeIndex,
    previousRoot,
    currentRoot,
    proofIndex,
  };
}

async function foldPreviousTransparencyConsistencyNodes(input: {
  readonly proof: TransparencyConsistencyProof;
  readonly state: TransparencyConsistencyRootState;
}): Promise<TransparencyConsistencyRootState> {
  let { currentNodeIndex, currentRoot, previousNodeIndex, previousRoot } =
    input.state;
  let { proofIndex } = input.state;

  while (previousNodeIndex > 0) {
    const proofHash = readTransparencyConsistencyNode(input.proof, proofIndex);

    if (previousNodeIndex % 2 === 1) {
      previousRoot = await computeTransparencyNodeHash(proofHash, previousRoot);
      currentRoot = await computeTransparencyNodeHash(proofHash, currentRoot);
    } else {
      currentRoot = await computeTransparencyNodeHash(currentRoot, proofHash);
    }

    previousNodeIndex = halveTreeIndex(previousNodeIndex);
    currentNodeIndex = halveTreeIndex(currentNodeIndex);
    proofIndex += 1;
  }

  return {
    previousNodeIndex,
    currentNodeIndex,
    previousRoot,
    currentRoot,
    proofIndex,
  };
}

async function foldCurrentTransparencyConsistencyNodes(input: {
  readonly proof: TransparencyConsistencyProof;
  readonly state: TransparencyConsistencyRootState;
}): Promise<TransparencyConsistencyRootState> {
  let { currentNodeIndex, currentRoot, previousNodeIndex, previousRoot } =
    input.state;
  let { proofIndex } = input.state;

  while (currentNodeIndex > 0) {
    const proofHash = readTransparencyConsistencyNode(input.proof, proofIndex);

    currentRoot = await computeTransparencyNodeHash(currentRoot, proofHash);
    currentNodeIndex = halveTreeIndex(currentNodeIndex);
    proofIndex += 1;
  }

  return {
    previousNodeIndex,
    currentNodeIndex,
    previousRoot,
    currentRoot,
    proofIndex,
  };
}

async function computeTransparencyConsistencyProofRoots(input: {
  readonly proof: TransparencyConsistencyProof;
  readonly previousTreeHead: VerifiedTransparencyTreeHead;
  readonly treeHead: VerifiedTransparencyTreeHead;
}): Promise<{
  readonly previousRoot: string;
  readonly currentRoot: string;
  readonly proofIndex: number;
}> {
  const previousFold = await foldPreviousTransparencyConsistencyNodes({
    proof: input.proof,
    state: initializeTransparencyConsistencyRootState(input),
  });
  const currentFold = await foldCurrentTransparencyConsistencyNodes({
    proof: input.proof,
    state: previousFold,
  });

  return {
    previousRoot: currentFold.previousRoot,
    currentRoot: currentFold.currentRoot,
    proofIndex: currentFold.proofIndex,
  };
}

function verifyTransparencyConsistencyProofRoots(input: {
  readonly previousTreeHead: VerifiedTransparencyTreeHead;
  readonly treeHead: VerifiedTransparencyTreeHead;
  readonly previousRoot: string;
  readonly currentRoot: string;
}): void {
  if (input.previousRoot !== input.previousTreeHead.treeHead.rootHash) {
    throwVerification(
      "hash_mismatch",
      "transparency consistency proof previous root mismatch",
    );
  }

  if (input.currentRoot !== input.treeHead.treeHead.rootHash) {
    throwVerification(
      "hash_mismatch",
      "transparency consistency proof current root mismatch",
    );
  }
}

export async function verifyTransparencyProof({
  consistencyProof,
  inclusionProof,
  leaf,
  logPublicKey,
  previousTreeHead,
  treeHead,
}: VerifyTransparencyProofInput): Promise<
  KeyingVerificationResult<VerifiedTransparencyProof>
> {
  return runVerifier(async () => {
    const verifiedTreeHead = await verifySignedTransparencyTreeHead({
      treeHead,
      logPublicKey,
    });

    if (!verifiedTreeHead.ok) {
      throw verifiedTreeHead.error;
    }

    const normalizedLeaf = normalizeTransparencyLeaf(leaf);
    const leafHash = await computeTransparencyLeafHash(normalizedLeaf);
    const normalizedInclusionProof =
      normalizeTransparencyInclusionProof(inclusionProof);

    await verifyTransparencyInclusionRoot({
      leafHash,
      proof: normalizedInclusionProof,
      treeHead: verifiedTreeHead.value,
    });

    let normalizedConsistencyProof: TransparencyConsistencyProof | undefined;

    if (previousTreeHead || consistencyProof) {
      if (!previousTreeHead || !consistencyProof) {
        throwVerification(
          "missing_dependency",
          "transparency consistency verification requires both previous tree head and proof",
        );
      }

      const verifiedPreviousTreeHead = await verifySignedTransparencyTreeHead({
        treeHead: previousTreeHead,
        logPublicKey,
      });

      if (!verifiedPreviousTreeHead.ok) {
        throw verifiedPreviousTreeHead.error;
      }

      normalizedConsistencyProof =
        normalizeTransparencyConsistencyProof(consistencyProof);
      await verifyTransparencyConsistencyRoot({
        proof: normalizedConsistencyProof,
        previousTreeHead: verifiedPreviousTreeHead.value,
        treeHead: verifiedTreeHead.value,
      });
    }

    return {
      leaf: normalizedLeaf,
      leafHash,
      treeHead: verifiedTreeHead.value,
      inclusionProof: normalizedInclusionProof,
      ...(normalizedConsistencyProof
        ? { consistencyProof: normalizedConsistencyProof }
        : {}),
    } as VerifiedTransparencyProof;
  });
}

function principalProjectionMemberKey(
  member: PrincipalProjectionMember,
): string {
  return `${member.memberPrincipalType}:${member.memberPrincipalId}`;
}

function principalProjectionRoleRank(
  role: PrincipalProjectionMember["role"],
): number {
  return role === "admin" ? 2 : 1;
}

function projectionIncludesAdminUser(
  projection: readonly PrincipalProjectionMember[],
  userId: string,
): boolean {
  return projection.some(
    (member) =>
      member.memberPrincipalType === "user" &&
      member.memberPrincipalId === userId &&
      member.role === "admin",
  );
}

function hasPrincipalPolicyProjectionShrink(input: {
  currentProjection: readonly PrincipalProjectionMember[];
  previousProjection: readonly PrincipalProjectionMember[];
}): boolean {
  const currentProjectionByMember = new Map<string, PrincipalProjectionMember>(
    input.currentProjection.map((member) => [
      principalProjectionMemberKey(member),
      member,
    ]),
  );

  return input.previousProjection.some((previousMember) => {
    const currentMember = currentProjectionByMember.get(
      principalProjectionMemberKey(previousMember),
    );

    if (!currentMember) {
      return true;
    }

    return (
      principalProjectionRoleRank(currentMember.role) <
      principalProjectionRoleRank(previousMember.role)
    );
  });
}

function principalPolicyKeyMaterialChanged(input: {
  currentState: SignedPrincipalState;
  previousState: SignedPrincipalState;
}): boolean {
  return (
    input.currentState.encapsulationPublicKey !==
      input.previousState.encapsulationPublicKey ||
    input.currentState.keyFingerprint !== input.previousState.keyFingerprint
  );
}

export function getPrincipalPolicyTransitionMismatchReason(input: {
  readonly current: {
    readonly projection: readonly PrincipalProjectionMember[];
    readonly state: SignedPrincipalState;
  };
  readonly previous: {
    readonly projection: readonly PrincipalProjectionMember[];
    readonly state: PrincipalPolicySignedState;
  };
}): string | null {
  const { current, previous } = input;

  if (
    current.state.principalType !== previous.state.principalType ||
    current.state.principalId !== previous.state.principalId
  ) {
    return "Principal policy transition principal mismatch";
  }

  if (current.state.version !== previous.state.version + 1) {
    return "Principal policy transition version is not contiguous";
  }

  if (current.state.prevStateHash !== previous.state.stateHash) {
    return "Principal policy transition previous hash mismatch";
  }

  if (current.state.keyEpoch < previous.state.keyEpoch) {
    return "Principal policy key epoch cannot decrease";
  }

  const previousProjection = normalizePrincipalProjectionMembers(
    previous.projection,
  );
  const currentProjection = normalizePrincipalProjectionMembers(
    current.projection,
  );
  const keyMaterialChanged = principalPolicyKeyMaterialChanged({
    currentState: current.state,
    previousState: previous.state,
  });

  if (
    current.state.keyEpoch === previous.state.keyEpoch &&
    keyMaterialChanged
  ) {
    return "Principal policy key change requires a new key epoch";
  }

  if (current.state.keyEpoch > previous.state.keyEpoch && !keyMaterialChanged) {
    return "Principal policy key epoch advance requires new key material";
  }

  if (
    hasPrincipalPolicyProjectionShrink({
      currentProjection,
      previousProjection,
    }) &&
    (current.state.keyEpoch <= previous.state.keyEpoch || !keyMaterialChanged)
  ) {
    return "Principal policy shrink requires a new key epoch and key material";
  }

  return null;
}

function mapPrincipalPolicyTransitionError(message: string): void {
  if (
    message.includes("key epoch") ||
    message.includes("key change") ||
    message.includes("shrink")
  ) {
    throwVerification("key_epoch_reuse", message);
  }

  if (message.includes("previous hash")) {
    throwVerification("stale_predecessor", message);
  }

  throwVerification("invalid_shape", message);
}

function normalizePrincipalPolicySignerKey(
  signerKey: PrincipalPolicySignerPublicKey,
): PrincipalPolicySignerPublicKey {
  if (signerKey.userId.length === 0) {
    throwVerification("invalid_shape", "principal policy signer user missing");
  }

  if (!/^[0-9a-f]{64}$/.test(signerKey.signingKeyFingerprint)) {
    throwVerification(
      "hash_mismatch",
      "principal policy signer fingerprint must be a 64-character lowercase hex hash",
    );
  }

  if (signerKey.signingPublicKey.length === 0) {
    throwVerification(
      "invalid_shape",
      "principal policy signer public key missing",
    );
  }

  return signerKey;
}

async function buildPrincipalPolicySignerKeyMap(
  signerPublicKeys: readonly PrincipalPolicySignerPublicKey[],
): Promise<Map<string, Uint8Array>> {
  const signerPublicKeyByUserAndFingerprint = new Map<string, Uint8Array>();

  for (const signerKey of signerPublicKeys.map(
    normalizePrincipalPolicySignerKey,
  )) {
    const computedFingerprint = await toFingerprint(signerKey.signingPublicKey);

    if (computedFingerprint !== signerKey.signingKeyFingerprint) {
      throwVerification(
        "signer_mismatch",
        "principal policy signer key fingerprint does not match public key",
      );
    }

    const key = `${signerKey.userId}:${signerKey.signingKeyFingerprint}`;
    if (signerPublicKeyByUserAndFingerprint.has(key)) {
      throwVerification(
        "duplicate_entry",
        "principal policy signer key list contains a duplicate",
      );
    }

    signerPublicKeyByUserAndFingerprint.set(key, signerKey.signingPublicKey);
  }

  return signerPublicKeyByUserAndFingerprint;
}

function getPrincipalPolicySignerPublicKey(input: {
  readonly signerPublicKeyByUserAndFingerprint: ReadonlyMap<string, Uint8Array>;
  readonly state: SignedPrincipalState;
}): Uint8Array {
  const signerPublicKey = input.signerPublicKeyByUserAndFingerprint.get(
    `${input.state.signerUserId}:${input.state.signerUserKeyFingerprint}`,
  );

  if (!signerPublicKey) {
    throwVerification(
      "missing_dependency",
      "principal policy signer public key is unavailable",
    );
  }

  return signerPublicKey;
}

async function normalizePrincipalPolicyStateChainEntry(
  entry: PrincipalPolicyStateChainEntry,
): Promise<NormalizedPrincipalPolicyStateChainEntry> {
  const projection = normalizePrincipalProjectionMembers(entry.projection);
  const computedStateHash = await computePrincipalStateHash(entry.state);

  if (computedStateHash !== entry.state.stateHash) {
    throwVerification(
      "hash_mismatch",
      "principal policy state hash does not match signed state",
    );
  }

  const computedProjectionRoot =
    await computePrincipalProjectionRoot(projection);

  if (computedProjectionRoot !== entry.state.projectionRoot) {
    throwVerification(
      "hash_mismatch",
      "principal policy projection root does not match projection",
    );
  }

  if (projection.length !== entry.state.memberCount) {
    throwVerification(
      "invalid_shape",
      "principal policy projection count does not match state member count",
    );
  }

  return {
    state: entry.state,
    projection,
  };
}

function verifyPrincipalPolicyReference(input: {
  readonly expectedReference: ReferencedPrincipalHead | undefined;
  readonly state: PrincipalPolicySignedState;
}): void {
  const { expectedReference, state } = input;

  if (!expectedReference) {
    return;
  }

  if (
    expectedReference.principalType !== state.principalType ||
    expectedReference.principalId !== state.principalId
  ) {
    throwVerification(
      "object_mismatch",
      "principal policy bundle does not match referenced principal",
    );
  }

  if (
    expectedReference.version !== state.version ||
    expectedReference.keyEpoch !== state.keyEpoch ||
    expectedReference.stateHash !== state.stateHash ||
    expectedReference.keyFingerprint !== state.keyFingerprint
  ) {
    throwVerification(
      "hash_mismatch",
      "principal policy bundle does not match referenced principal head",
    );
  }
}

async function verifyPrincipalPolicyPayload(input: {
  readonly bundle: PrincipalPolicyBundle;
}): Promise<void> {
  const { currentPayload, currentState } = input.bundle;

  if (
    currentPayload.principalType !== currentState.principalType ||
    currentPayload.principalId !== currentState.principalId
  ) {
    throwVerification(
      "object_mismatch",
      "principal policy payload does not match current state principal",
    );
  }

  if (currentPayload.stateHash !== currentState.stateHash) {
    throwVerification(
      "hash_mismatch",
      "principal policy payload state hash does not match current state",
    );
  }

  const computedPayloadHash = await computePrincipalStatePayloadCiphertextHash(
    currentPayload.ciphertext,
  );

  if (computedPayloadHash !== currentPayload.ciphertextHash) {
    throwVerification(
      "hash_mismatch",
      "principal policy payload hash does not match ciphertext",
    );
  }

  if (computedPayloadHash !== currentState.payloadCiphertextHash) {
    throwVerification(
      "hash_mismatch",
      "principal policy payload hash does not match current state",
    );
  }
}

function verifyPrincipalPolicyMemberEnvelopes(input: {
  readonly bundle: PrincipalPolicyBundle;
}): void {
  const { currentMemberEnvelopes, currentState } = input.bundle;

  if (!currentMemberEnvelopes) {
    return;
  }

  if (
    currentMemberEnvelopes.principalType !== currentState.principalType ||
    currentMemberEnvelopes.principalId !== currentState.principalId
  ) {
    throwVerification(
      "object_mismatch",
      "principal policy member envelopes do not match current state principal",
    );
  }

  if (
    currentMemberEnvelopes.stateHash !== currentState.stateHash ||
    currentMemberEnvelopes.epoch !== currentState.keyEpoch
  ) {
    throwVerification(
      "hash_mismatch",
      "principal policy member envelopes do not match current state",
    );
  }
}

function verifyPrincipalPolicyCheckpoint(input: {
  readonly chain: readonly NormalizedPrincipalPolicyStateChainEntry[];
  readonly currentState: PrincipalPolicySignedState;
  readonly localCheckpoint: PrincipalPolicyCheckpoint | null | undefined;
}): void {
  const { currentState, localCheckpoint } = input;

  if (!localCheckpoint) {
    return;
  }

  if (
    localCheckpoint.principalType !== currentState.principalType ||
    localCheckpoint.principalId !== currentState.principalId
  ) {
    throwVerification(
      "object_mismatch",
      "principal policy checkpoint does not match current principal",
    );
  }

  if (currentState.version < localCheckpoint.version) {
    throwVerification(
      "rollback",
      "principal policy state is older than the local checkpoint",
    );
  }

  if (
    currentState.version === localCheckpoint.version &&
    currentState.stateHash !== localCheckpoint.stateHash
  ) {
    throwVerification(
      "equivocation",
      "principal policy state conflicts with the local checkpoint",
    );
  }

  if (currentState.version === localCheckpoint.version) {
    return;
  }

  const checkpointEntry = input.chain[localCheckpoint.version - 1];
  if (
    !checkpointEntry ||
    checkpointEntry.state.stateHash !== localCheckpoint.stateHash
  ) {
    throwVerification(
      "stale_predecessor",
      "principal policy chain does not extend the local checkpoint",
    );
  }
}

function verifyPrincipalPolicyChainShape(input: {
  readonly chainLength: number;
  readonly currentState: PrincipalPolicySignedState;
}): void {
  if (input.chainLength !== input.currentState.version) {
    throwVerification(
      "missing_dependency",
      "principal policy chain length does not match current state version",
    );
  }
}

function verifyPrincipalPolicyChainEntryIdentity(input: {
  readonly currentState: PrincipalPolicySignedState;
  readonly expectedVersion: number;
  readonly normalizedEntry: NormalizedPrincipalPolicyStateChainEntry;
}): void {
  if (
    input.normalizedEntry.state.principalType !==
      input.currentState.principalType ||
    input.normalizedEntry.state.principalId !== input.currentState.principalId
  ) {
    throwVerification(
      "object_mismatch",
      "principal policy chain entry principal does not match current state",
    );
  }

  if (input.normalizedEntry.state.version !== input.expectedVersion) {
    throwVerification(
      "stale_predecessor",
      "principal policy chain entry version is not contiguous",
    );
  }
}

function verifyInitialPrincipalPolicyChainEntry(
  normalizedEntry: NormalizedPrincipalPolicyStateChainEntry,
): void {
  if (normalizedEntry.state.prevStateHash !== null) {
    throwVerification(
      "stale_predecessor",
      "initial principal policy chain entry has a previous state hash",
    );
  }

  if (
    !projectionIncludesAdminUser(
      normalizedEntry.projection,
      normalizedEntry.state.signerUserId,
    )
  ) {
    throwVerification(
      "unauthorized",
      "initial principal policy state signer is not an admin",
    );
  }
}

function verifySuccessorPrincipalPolicyChainEntry(input: {
  readonly normalizedEntry: NormalizedPrincipalPolicyStateChainEntry;
  readonly previousEntry: NormalizedPrincipalPolicyStateChainEntry;
}): void {
  if (
    input.normalizedEntry.state.prevStateHash !==
    input.previousEntry.state.stateHash
  ) {
    throwVerification(
      "stale_predecessor",
      "principal policy chain entry previous hash mismatch",
    );
  }

  if (
    !projectionIncludesAdminUser(
      input.previousEntry.projection,
      input.normalizedEntry.state.signerUserId,
    )
  ) {
    throwVerification(
      "unauthorized",
      "principal policy state signer is not an admin in previous projection",
    );
  }

  const transitionMismatch = getPrincipalPolicyTransitionMismatchReason({
    current: input.normalizedEntry,
    previous: input.previousEntry,
  });

  if (transitionMismatch) {
    mapPrincipalPolicyTransitionError(transitionMismatch);
  }
}

async function verifyPrincipalPolicyChainEntrySignature(input: {
  readonly normalizedEntry: NormalizedPrincipalPolicyStateChainEntry;
  readonly signerPublicKeyByUserAndFingerprint: ReadonlyMap<string, Uint8Array>;
}): Promise<void> {
  const signerPublicKey = getPrincipalPolicySignerPublicKey({
    signerPublicKeyByUserAndFingerprint:
      input.signerPublicKeyByUserAndFingerprint,
    state: input.normalizedEntry.state,
  });

  if (
    !(await verifySignedPrincipalState(
      input.normalizedEntry.state,
      signerPublicKey,
    ))
  ) {
    throwVerification(
      "signature_mismatch",
      "principal policy state signature verification failed",
    );
  }
}

async function verifyPrincipalPolicyChain(input: {
  readonly bundle: PrincipalPolicyBundle;
  readonly signerPublicKeyByUserAndFingerprint: ReadonlyMap<string, Uint8Array>;
}): Promise<NormalizedPrincipalPolicyStateChainEntry[]> {
  const chain = [
    ...input.bundle.previousStates,
    {
      state: input.bundle.currentState,
      projection: input.bundle.currentProjection,
    },
  ];

  verifyPrincipalPolicyChainShape({
    chainLength: chain.length,
    currentState: input.bundle.currentState,
  });

  const normalizedChain: NormalizedPrincipalPolicyStateChainEntry[] = [];

  for (let index = 0; index < chain.length; index += 1) {
    const entry = chain[index];
    if (!entry) {
      throwVerification(
        "missing_dependency",
        "principal policy chain entry is missing",
      );
    }

    const normalizedEntry =
      await normalizePrincipalPolicyStateChainEntry(entry);

    verifyPrincipalPolicyChainEntryIdentity({
      currentState: input.bundle.currentState,
      expectedVersion: index + 1,
      normalizedEntry,
    });

    const previousEntry = normalizedChain[index - 1];
    if (previousEntry) {
      verifySuccessorPrincipalPolicyChainEntry({
        normalizedEntry,
        previousEntry,
      });
    } else {
      verifyInitialPrincipalPolicyChainEntry(normalizedEntry);
    }

    await verifyPrincipalPolicyChainEntrySignature({
      normalizedEntry,
      signerPublicKeyByUserAndFingerprint:
        input.signerPublicKeyByUserAndFingerprint,
    });

    normalizedChain.push(normalizedEntry);
  }

  return normalizedChain;
}

export async function verifyPrincipalPolicyBundle({
  bundle,
  expectedReference,
  localCheckpoint,
  signerPublicKeys,
}: VerifyPrincipalPolicyBundleInput): Promise<
  KeyingVerificationResult<VerifiedPrincipalPolicy>
> {
  return runVerifier(async () => {
    const signerPublicKeyByUserAndFingerprint =
      await buildPrincipalPolicySignerKeyMap(signerPublicKeys);
    const normalizedChain = await verifyPrincipalPolicyChain({
      bundle,
      signerPublicKeyByUserAndFingerprint,
    });
    const currentEntry = normalizedChain.at(-1);

    if (!currentEntry) {
      throwVerification(
        "missing_dependency",
        "principal policy chain is empty",
      );
    }

    await verifyPrincipalPolicyPayload({ bundle });
    verifyPrincipalPolicyMemberEnvelopes({ bundle });
    verifyPrincipalPolicyReference({
      expectedReference,
      state: currentEntry.state,
    });
    verifyPrincipalPolicyCheckpoint({
      chain: normalizedChain,
      currentState: currentEntry.state,
      localCheckpoint,
    });

    return {
      principalType: currentEntry.state.principalType,
      principalId: currentEntry.state.principalId,
      version: currentEntry.state.version,
      keyEpoch: currentEntry.state.keyEpoch,
      stateHash: currentEntry.state.stateHash,
      state: currentEntry.state,
      projection: currentEntry.projection,
      checkpoint: {
        principalType: currentEntry.state.principalType,
        principalId: currentEntry.state.principalId,
        version: currentEntry.state.version,
        stateHash: currentEntry.state.stateHash,
      },
    } as VerifiedPrincipalPolicy;
  });
}

function normalizeUnsignedAccessEvent(
  value: UnsignedAccessEvent,
): UnsignedAccessEvent {
  const record = assertExactKeys(
    value,
    [
      "bodyHash",
      "dependencyManifestHashes",
      "eventId",
      "eventType",
      "objectId",
      "objectKind",
      "organizationId",
      "previousManifestHash",
      "signedAt",
      "signerDeviceId",
      "signerKeyFingerprint",
      "signerUserId",
      "version",
    ],
    "access event",
  );
  const eventType = normalizeAccessEventType(record.eventType, "access event");
  const objectKind = normalizeAccessObjectKind(
    record.objectKind,
    "access event",
  );
  const expectedObjectKind = expectedObjectKindForEventType(eventType);

  if (objectKind !== expectedObjectKind) {
    throwVerification(
      "object_mismatch",
      `access event ${eventType} must use objectKind ${expectedObjectKind}`,
    );
  }

  return {
    version: readVersion(record, "access event"),
    eventId: readString(record, "eventId", "access event"),
    eventType,
    objectKind,
    objectId: readString(record, "objectId", "access event"),
    organizationId: readString(record, "organizationId", "access event"),
    previousManifestHash: readNullableHashString(
      record,
      "previousManifestHash",
      "access event",
    ),
    dependencyManifestHashes: normalizeUniqueSortedStrings(
      readStringArray(record, "dependencyManifestHashes", "access event"),
      "access event dependencyManifestHashes",
    ),
    bodyHash: readHashString(record, "bodyHash", "access event"),
    signerUserId: readString(record, "signerUserId", "access event"),
    signerDeviceId: readString(record, "signerDeviceId", "access event"),
    signerKeyFingerprint: readHashString(
      record,
      "signerKeyFingerprint",
      "access event",
    ),
    signedAt: readSignedAt(record, "signedAt", "access event"),
  };
}

function normalizeAccessEvent(value: AccessEvent): AccessEvent {
  const record = assertExactKeys(
    value,
    [
      "bodyHash",
      "dependencyManifestHashes",
      "eventId",
      "eventType",
      "objectId",
      "objectKind",
      "organizationId",
      "previousManifestHash",
      "signature",
      "signedAt",
      "signerDeviceId",
      "signerKeyFingerprint",
      "signerUserId",
      "version",
    ],
    "access event",
  );
  const unsignedEvent = normalizeUnsignedAccessEvent({
    version: record.version,
    eventId: record.eventId,
    eventType: record.eventType,
    objectKind: record.objectKind,
    objectId: record.objectId,
    organizationId: record.organizationId,
    previousManifestHash: record.previousManifestHash,
    dependencyManifestHashes: record.dependencyManifestHashes,
    bodyHash: record.bodyHash,
    signerUserId: record.signerUserId,
    signerDeviceId: record.signerDeviceId,
    signerKeyFingerprint: record.signerKeyFingerprint,
    signedAt: record.signedAt,
  } as UnsignedAccessEvent);

  return {
    ...unsignedEvent,
    signature: readString(record, "signature", "access event"),
  };
}

function unsignedAccessEventPayload(
  event: UnsignedAccessEvent,
): KeyingCanonicalPayload<UnsignedAccessEvent> {
  return normalizeUnsignedAccessEvent(event);
}

function accessEventSigningBytes(event: UnsignedAccessEvent): Uint8Array {
  return encodeDomainPayload(
    "tearleads.keying.access-event-signing",
    unsignedAccessEventPayload(event),
  );
}

function toUnsignedAccessEvent(event: AccessEvent): UnsignedAccessEvent {
  return {
    version: event.version,
    eventId: event.eventId,
    eventType: event.eventType,
    objectKind: event.objectKind,
    objectId: event.objectId,
    organizationId: event.organizationId,
    previousManifestHash: event.previousManifestHash,
    dependencyManifestHashes: event.dependencyManifestHashes,
    bodyHash: event.bodyHash,
    signerUserId: event.signerUserId,
    signerDeviceId: event.signerDeviceId,
    signerKeyFingerprint: event.signerKeyFingerprint,
    signedAt: event.signedAt,
  };
}

export async function computeAccessEventBodyHash(
  body: KeyingCanonicalJson,
): Promise<string> {
  return computeKeyingDomainHash("tearleads.keying.access-event-body", body);
}

export async function signAccessEvent(
  event: UnsignedAccessEvent,
  signingPrivateKey: Uint8Array,
): Promise<AccessEvent> {
  const normalizedEvent = normalizeUnsignedAccessEvent(event);
  const signature = sign(
    accessEventSigningBytes(normalizedEvent),
    signingPrivateKey,
  );

  return {
    ...normalizedEvent,
    signature: bytesToBase64(signature),
  };
}

export async function computeAccessEventHash(
  event: AccessEvent,
): Promise<string> {
  const payload: KeyingCanonicalPayload<AccessEvent> =
    normalizeAccessEvent(event);

  return computeKeyingDomainHash("tearleads.keying.access-event", payload);
}

export async function verifySignedAccessEvent({
  body,
  event,
  signerPublicKey,
}: VerifyAccessEventInput): Promise<
  KeyingVerificationResult<VerifiedAccessEvent>
> {
  return runVerifier(async () => {
    const normalizedBody = normalizeCanonicalJsonValue(
      body,
      "access event body",
    );
    const normalizedEvent = normalizeAccessEvent(event);
    const computedBodyHash = await computeAccessEventBodyHash(normalizedBody);

    if (computedBodyHash !== normalizedEvent.bodyHash) {
      throwVerification(
        "hash_mismatch",
        "access event body hash does not match body",
      );
    }

    const signerKeyFingerprint = await toFingerprint(signerPublicKey);
    if (signerKeyFingerprint !== normalizedEvent.signerKeyFingerprint) {
      throwVerification(
        "signer_mismatch",
        "access event signer fingerprint does not match signer public key",
      );
    }

    let signature: Uint8Array;
    try {
      signature = base64ToBytes(normalizedEvent.signature);
    } catch {
      throwVerification("signature_mismatch", "access event signature invalid");
    }

    if (
      !verify(
        signature,
        accessEventSigningBytes(toUnsignedAccessEvent(normalizedEvent)),
        signerPublicKey,
      )
    ) {
      throwVerification(
        "signature_mismatch",
        "access event signature verification failed",
      );
    }

    return {
      event: normalizedEvent,
      body: normalizedBody,
      eventHash: await computeAccessEventHash(normalizedEvent),
    } as VerifiedAccessEvent;
  });
}

function normalizeReferencedPrincipalHead(
  value: ReferencedPrincipalHead,
): ReferencedPrincipalHead {
  const record = assertExactKeys(
    value,
    [
      "keyEpoch",
      "keyFingerprint",
      "principalId",
      "principalType",
      "stateHash",
      "version",
    ],
    "referenced principal head",
  );

  return {
    principalType: normalizeManagedPrincipalKind(
      record.principalType,
      "referenced principal head",
    ),
    principalId: readString(record, "principalId", "referenced principal head"),
    version: readPositiveInteger(
      record,
      "version",
      "referenced principal head",
    ),
    keyEpoch: readPositiveInteger(
      record,
      "keyEpoch",
      "referenced principal head",
    ),
    stateHash: readHashString(record, "stateHash", "referenced principal head"),
    keyFingerprint: readHashString(
      record,
      "keyFingerprint",
      "referenced principal head",
    ),
  };
}

function referencedPrincipalKey(principal: ReferencedPrincipalHead): string {
  return `${principal.principalType}:${principal.principalId}`;
}

function normalizeReferencedPrincipalHeads(
  values: readonly ReferencedPrincipalHead[],
): ReferencedPrincipalHead[] {
  const normalizedValues = values
    .map(normalizeReferencedPrincipalHead)
    .sort((left, right) =>
      compareCanonicalStrings(
        referencedPrincipalKey(left),
        referencedPrincipalKey(right),
      ),
    );

  for (let index = 1; index < normalizedValues.length; index += 1) {
    if (
      referencedPrincipalKey(
        normalizedValues[index - 1] as ReferencedPrincipalHead,
      ) ===
      referencedPrincipalKey(normalizedValues[index] as ReferencedPrincipalHead)
    ) {
      throwVerification(
        "duplicate_entry",
        "access manifest referencedPrincipalHeads contains a duplicate",
      );
    }
  }

  return normalizedValues;
}

function normalizeAccessManifest(value: AccessManifest): AccessManifest {
  const record = assertExactKeys(
    value,
    [
      "epoch",
      "eventHash",
      "grantRoot",
      "keyTargetHash",
      "objectId",
      "objectKind",
      "organizationId",
      "previousManifestHash",
      "referencedPrincipalHeads",
      "structuralHash",
      "version",
    ],
    "access manifest",
  );
  const referencedPrincipalHeads = record.referencedPrincipalHeads;

  if (!Array.isArray(referencedPrincipalHeads)) {
    throwVerification(
      "invalid_shape",
      "access manifest.referencedPrincipalHeads must be an array",
    );
  }

  return {
    version: readVersion(record, "access manifest"),
    objectKind: normalizeAccessObjectKind(record.objectKind, "access manifest"),
    objectId: readString(record, "objectId", "access manifest"),
    organizationId: readString(record, "organizationId", "access manifest"),
    epoch: readPositiveInteger(record, "epoch", "access manifest"),
    previousManifestHash: readNullableHashString(
      record,
      "previousManifestHash",
      "access manifest",
    ),
    eventHash: readHashString(record, "eventHash", "access manifest"),
    structuralHash: readHashString(record, "structuralHash", "access manifest"),
    grantRoot: readHashString(record, "grantRoot", "access manifest"),
    referencedPrincipalHeads: normalizeReferencedPrincipalHeads(
      referencedPrincipalHeads as ReferencedPrincipalHead[],
    ),
    keyTargetHash: readHashString(record, "keyTargetHash", "access manifest"),
  };
}

export async function computeAccessManifestHash(
  manifest: AccessManifest,
): Promise<string> {
  const payload: KeyingCanonicalPayload<AccessManifest> =
    normalizeAccessManifest(manifest);

  return computeKeyingDomainHash("tearleads.keying.access-manifest", payload);
}

export async function verifyAccessManifest({
  checkpointPredecessors,
  event,
  expectedManifestHash,
  expectedObject,
  expectedPreviousManifestHash,
  localCheckpoint,
  manifest,
}: VerifyAccessManifestInput): Promise<
  KeyingVerificationResult<VerifiedAccessManifest>
> {
  return runVerifier(async () => {
    const normalizedManifest = normalizeAccessManifest(manifest);
    const manifestHash = await computeAccessManifestHash(normalizedManifest);

    if (manifestHash !== expectedManifestHash) {
      throwVerification(
        "hash_mismatch",
        "access manifest hash does not match expected hash",
      );
    }

    if (event.eventHash !== normalizedManifest.eventHash) {
      throwVerification(
        "hash_mismatch",
        "access manifest event hash does not match verified event",
      );
    }

    if (
      event.event.objectKind !== normalizedManifest.objectKind ||
      event.event.objectId !== normalizedManifest.objectId ||
      event.event.organizationId !== normalizedManifest.organizationId
    ) {
      throwVerification(
        "object_mismatch",
        "access manifest object does not match verified event",
      );
    }

    if (
      event.event.previousManifestHash !==
      normalizedManifest.previousManifestHash
    ) {
      throwVerification(
        "stale_predecessor",
        "access manifest predecessor does not match verified event",
      );
    }

    if (
      expectedPreviousManifestHash !== undefined &&
      expectedPreviousManifestHash !== normalizedManifest.previousManifestHash
    ) {
      throwVerification(
        "stale_predecessor",
        "access manifest predecessor does not match expected predecessor",
      );
    }

    if (
      expectedObject &&
      (expectedObject.objectKind !== normalizedManifest.objectKind ||
        expectedObject.objectId !== normalizedManifest.objectId)
    ) {
      throwVerification(
        "object_mismatch",
        "access manifest object does not match expected object",
      );
    }

    const checkpoint = accessManifestCheckpointFromManifest({
      manifest: normalizedManifest,
      manifestHash,
    });
    verifyAccessManifestLocalCheckpoint({
      current: {
        ...checkpoint,
        previousManifestHash: normalizedManifest.previousManifestHash,
      },
      localCheckpoint,
      checkpointPredecessors,
    });

    return {
      manifest: normalizedManifest,
      manifestHash,
      event,
      checkpoint,
    } as VerifiedAccessManifest;
  });
}

function containerAccessLevelRank(accessLevel: ContainerAccessLevel): number {
  if (accessLevel === "admin") {
    return 3;
  }

  if (accessLevel === "write") {
    return 2;
  }

  return 1;
}

function mergeContainerAccessLevel(
  current: ContainerAccessLevel | null,
  incoming: ContainerAccessLevel,
): ContainerAccessLevel {
  if (
    current === null ||
    containerAccessLevelRank(incoming) > containerAccessLevelRank(current)
  ) {
    return incoming;
  }

  return current;
}

function normalizeContainerDirectGrant(
  value: ContainerDirectGrant,
): ContainerDirectGrant {
  const record = assertExactKeys(
    value,
    ["accessLevel", "subjectId", "subjectType"],
    "container direct grant",
  );

  return {
    accessLevel: normalizeContainerAccessLevel(
      record.accessLevel,
      "container direct grant",
    ),
    subjectId: readString(record, "subjectId", "container direct grant"),
    subjectType: normalizeContainerGrantSubjectType(
      record.subjectType,
      "container direct grant",
    ),
  };
}

function containerDirectGrantKey(grant: ContainerDirectGrant): string {
  return `${grant.subjectType}:${grant.subjectId}`;
}

function normalizeContainerDirectGrants(
  values: readonly ContainerDirectGrant[],
): ContainerDirectGrant[] {
  return normalizeSortedUniqueArray(
    values,
    normalizeContainerDirectGrant,
    containerDirectGrantKey,
    "container direct grants",
  );
}

function normalizeContainerAccessStructural(
  value: ContainerAccessStructural,
): ContainerAccessStructural {
  const record = assertExactKeys(
    value,
    ["parentContainerId", "parentManifestHash"],
    "container access structural state",
  );
  const parentContainerId = readNullableString(
    record,
    "parentContainerId",
    "container access structural state",
  );
  const parentManifestHash = readNullableHashString(
    record,
    "parentManifestHash",
    "container access structural state",
  );

  if ((parentContainerId === null) !== (parentManifestHash === null)) {
    throwVerification(
      "invalid_shape",
      "container access parent id and parent manifest hash must both be present or both be null",
    );
  }

  return {
    parentContainerId,
    parentManifestHash,
  };
}

function normalizeContainerAccessMetadata(
  value: ContainerAccessMetadata,
): ContainerAccessMetadata {
  const record = assertExactKeys(
    value,
    ["metadataDocumentId"],
    "container access metadata state",
  );

  return {
    metadataDocumentId: readString(
      record,
      "metadataDocumentId",
      "container access metadata state",
    ),
  };
}

function normalizeContainerAccessStructuralState(
  value: ContainerAccessStructural & ContainerAccessMetadata,
): ContainerAccessStructural & ContainerAccessMetadata {
  const record = assertExactKeys(
    value,
    ["metadataDocumentId", "parentContainerId", "parentManifestHash"],
    "container access structural state",
  );

  return {
    ...normalizeContainerAccessStructural({
      parentContainerId: record.parentContainerId,
      parentManifestHash: record.parentManifestHash,
    } as ContainerAccessStructural),
    ...normalizeContainerAccessMetadata({
      metadataDocumentId: record.metadataDocumentId,
    } as ContainerAccessMetadata),
  };
}

function normalizeContainerAccessKeyState(
  value: ContainerAccessKeyState,
): ContainerAccessKeyState {
  const record = assertExactKeys(
    value,
    ["containerKeyEpochId"],
    "container access key state",
  );

  return {
    containerKeyEpochId: readNullableString(
      record,
      "containerKeyEpochId",
      "container access key state",
    ),
  };
}

function managedGrantReferenceKey(grant: ContainerDirectGrant): string | null {
  if (grant.subjectType === "user") {
    return null;
  }

  return `${grant.subjectType}:${grant.subjectId}`;
}

function assertReferencedPrincipalHeadsMatchDirectGrants(input: {
  readonly directGrants: readonly ContainerDirectGrant[];
  readonly referencedPrincipalHeads: readonly ReferencedPrincipalHead[];
}): void {
  const managedGrantKeys = new Set<string>();
  for (const grant of input.directGrants) {
    const key = managedGrantReferenceKey(grant);
    if (key) {
      managedGrantKeys.add(key);
    }
  }

  const referencedKeys = new Set<string>();
  for (const principalHead of input.referencedPrincipalHeads) {
    referencedKeys.add(referencedPrincipalKey(principalHead));
  }

  for (const grantKey of managedGrantKeys) {
    if (!referencedKeys.has(grantKey)) {
      throwVerification(
        "missing_dependency",
        "container access manifest is missing a referenced principal head",
      );
    }
  }

  for (const referencedKey of referencedKeys) {
    if (!managedGrantKeys.has(referencedKey)) {
      throwVerification(
        "missing_dependency",
        "container access manifest references a principal without a direct grant",
      );
    }
  }
}

function normalizeContainerAccessGrantState(input: {
  readonly directGrants: unknown;
  readonly label: string;
  readonly referencedPrincipalHeads: unknown;
}): Pick<
  ContainerAccessManifestState,
  "directGrants" | "referencedPrincipalHeads"
> {
  if (!Array.isArray(input.directGrants)) {
    throwVerification(
      "invalid_shape",
      `${input.label}.directGrants must be an array`,
    );
  }

  if (!Array.isArray(input.referencedPrincipalHeads)) {
    throwVerification(
      "invalid_shape",
      `${input.label}.referencedPrincipalHeads must be an array`,
    );
  }

  const directGrants = normalizeContainerDirectGrants(
    input.directGrants as ContainerDirectGrant[],
  );
  const referencedPrincipalHeads = normalizeReferencedPrincipalHeads(
    input.referencedPrincipalHeads as ReferencedPrincipalHead[],
  );

  assertReferencedPrincipalHeadsMatchDirectGrants({
    directGrants,
    referencedPrincipalHeads,
  });

  return { directGrants, referencedPrincipalHeads };
}

function normalizeContainerAccessManifestState(
  value: ContainerAccessManifestState,
): ContainerAccessManifestState {
  const record = assertExactKeys(
    value,
    [
      "containerId",
      "containerKeyEpochId",
      "directGrants",
      "epoch",
      "eventHash",
      "metadataDocumentId",
      "organizationId",
      "parentContainerId",
      "parentManifestHash",
      "previousManifestHash",
      "referencedPrincipalHeads",
      "version",
    ],
    "container access manifest state",
  );
  const structural = normalizeContainerAccessStructural({
    parentContainerId: record.parentContainerId,
    parentManifestHash: record.parentManifestHash,
  } as ContainerAccessStructural);
  const keyState = normalizeContainerAccessKeyState({
    containerKeyEpochId: record.containerKeyEpochId,
  } as ContainerAccessKeyState);
  const metadata = normalizeContainerAccessMetadata({
    metadataDocumentId: record.metadataDocumentId,
  } as ContainerAccessMetadata);
  const grants = normalizeContainerAccessGrantState({
    directGrants: record.directGrants,
    referencedPrincipalHeads: record.referencedPrincipalHeads,
    label: "container access manifest state",
  });

  return {
    version: readVersion(record, "container access manifest state"),
    containerId: readString(
      record,
      "containerId",
      "container access manifest state",
    ),
    organizationId: readString(
      record,
      "organizationId",
      "container access manifest state",
    ),
    epoch: readPositiveInteger(
      record,
      "epoch",
      "container access manifest state",
    ),
    previousManifestHash: readNullableHashString(
      record,
      "previousManifestHash",
      "container access manifest state",
    ),
    eventHash: readHashString(
      record,
      "eventHash",
      "container access manifest state",
    ),
    ...structural,
    ...keyState,
    ...metadata,
    ...grants,
  };
}

export async function computeContainerAccessStructuralHash(
  structural: ContainerAccessStructural & ContainerAccessMetadata,
): Promise<string> {
  const payload: KeyingCanonicalPayload<
    ContainerAccessStructural & ContainerAccessMetadata
  > = normalizeContainerAccessStructuralState(structural);

  return computeKeyingDomainHash(
    "tearleads.keying.container-access-structural",
    payload,
  );
}

export async function computeContainerDirectGrantRoot(
  grants: readonly ContainerDirectGrant[],
): Promise<string> {
  const payload: KeyingCanonicalPayload<readonly ContainerDirectGrant[]> =
    normalizeContainerDirectGrants(grants);

  return computeKeyingDomainHash(
    "tearleads.keying.container-access-direct-grants",
    payload,
  );
}

export async function computeContainerAccessKeyTargetHash(
  keyState: ContainerAccessKeyState,
): Promise<string> {
  const payload: KeyingCanonicalPayload<ContainerAccessKeyState> =
    normalizeContainerAccessKeyState(keyState);

  return computeKeyingDomainHash(
    "tearleads.keying.container-access-key-target",
    payload,
  );
}

export async function deriveContainerAccessManifest(
  state: ContainerAccessManifestState,
): Promise<AccessManifest> {
  const normalizedState = normalizeContainerAccessManifestState(state);

  return {
    version: 1,
    objectKind: "container",
    objectId: normalizedState.containerId,
    organizationId: normalizedState.organizationId,
    epoch: normalizedState.epoch,
    previousManifestHash: normalizedState.previousManifestHash,
    eventHash: normalizedState.eventHash,
    structuralHash: await computeContainerAccessStructuralHash({
      metadataDocumentId: normalizedState.metadataDocumentId,
      parentContainerId: normalizedState.parentContainerId,
      parentManifestHash: normalizedState.parentManifestHash,
    }),
    grantRoot: await computeContainerDirectGrantRoot(
      normalizedState.directGrants,
    ),
    referencedPrincipalHeads: normalizedState.referencedPrincipalHeads,
    keyTargetHash: await computeContainerAccessKeyTargetHash({
      containerKeyEpochId: normalizedState.containerKeyEpochId,
    }),
  };
}

function normalizeContainerCreateAccessEventBody(
  value: KeyingCanonicalJson,
): ContainerCreateAccessEventBody {
  const record = assertExactKeys(
    value,
    [
      "containerKeyEpochId",
      "directGrants",
      "eventType",
      "metadataDocumentId",
      "parentContainerId",
      "parentManifestHash",
      "referencedPrincipalHeads",
    ],
    "container.create event body",
  );
  const directGrants = record.directGrants;
  const referencedPrincipalHeads = record.referencedPrincipalHeads;

  if (!Array.isArray(directGrants)) {
    throwVerification(
      "invalid_shape",
      "container.create event body.directGrants must be an array",
    );
  }

  if (!Array.isArray(referencedPrincipalHeads)) {
    throwVerification(
      "invalid_shape",
      "container.create event body.referencedPrincipalHeads must be an array",
    );
  }

  const structural = normalizeContainerAccessStructural({
    parentContainerId: record.parentContainerId,
    parentManifestHash: record.parentManifestHash,
  } as ContainerAccessStructural);
  const keyState = normalizeContainerAccessKeyState({
    containerKeyEpochId: record.containerKeyEpochId,
  } as ContainerAccessKeyState);
  const metadata = normalizeContainerAccessMetadata({
    metadataDocumentId: record.metadataDocumentId,
  } as ContainerAccessMetadata);
  const normalizedDirectGrants = normalizeContainerDirectGrants(
    directGrants as ContainerDirectGrant[],
  );
  const normalizedReferencedPrincipalHeads = normalizeReferencedPrincipalHeads(
    referencedPrincipalHeads as ReferencedPrincipalHead[],
  );

  assertReferencedPrincipalHeadsMatchDirectGrants({
    directGrants: normalizedDirectGrants,
    referencedPrincipalHeads: normalizedReferencedPrincipalHeads,
  });

  return {
    eventType: "container.create",
    ...structural,
    ...keyState,
    ...metadata,
    directGrants: normalizedDirectGrants,
    referencedPrincipalHeads: normalizedReferencedPrincipalHeads,
  };
}

function normalizeContainerGrantAccessEventBody(
  value: KeyingCanonicalJson,
): ContainerGrantAccessEventBody {
  const record = assertExactKeys(
    value,
    ["containerKeyEpochId", "eventType", "grant", "referencedPrincipalHead"],
    "container.grant event body",
  );
  const grant = normalizeContainerDirectGrant(
    record.grant as ContainerDirectGrant,
  );
  const referencedPrincipalHead =
    record.referencedPrincipalHead === null
      ? null
      : normalizeReferencedPrincipalHead(
          record.referencedPrincipalHead as ReferencedPrincipalHead,
        );
  const managedGrantKey = managedGrantReferenceKey(grant);

  if (managedGrantKey === null && referencedPrincipalHead !== null) {
    throwVerification(
      "missing_dependency",
      "container.grant user grants must not include a referenced principal head",
    );
  }

  if (
    managedGrantKey !== null &&
    (!referencedPrincipalHead ||
      referencedPrincipalKey(referencedPrincipalHead) !== managedGrantKey)
  ) {
    throwVerification(
      "missing_dependency",
      "container.grant managed-principal grants must include the matching referenced principal head",
    );
  }

  return {
    eventType: "container.grant",
    ...normalizeContainerAccessKeyState({
      containerKeyEpochId: record.containerKeyEpochId,
    } as ContainerAccessKeyState),
    grant,
    referencedPrincipalHead,
  };
}

function normalizeContainerRevokeAccessEventBody(
  value: KeyingCanonicalJson,
): ContainerRevokeAccessEventBody {
  const record = assertExactKeys(
    value,
    ["containerKeyEpochId", "eventType", "subjectId", "subjectType"],
    "container.revoke event body",
  );

  return {
    eventType: "container.revoke",
    ...normalizeContainerAccessKeyState({
      containerKeyEpochId: record.containerKeyEpochId,
    } as ContainerAccessKeyState),
    subjectId: readString(record, "subjectId", "container.revoke event body"),
    subjectType: normalizeContainerGrantSubjectType(
      record.subjectType,
      "container.revoke event body",
    ),
  };
}

function normalizeContainerRekeyAccessEventBody(
  value: KeyingCanonicalJson,
): ContainerRekeyAccessEventBody {
  const record = assertExactKeys(
    value,
    ["containerKeyEpochId", "eventType"],
    "container.rekey event body",
  );

  return {
    eventType: "container.rekey",
    containerKeyEpochId: readString(
      record,
      "containerKeyEpochId",
      "container.rekey event body",
    ),
  };
}

function normalizeContainerMoveAccessEventBody(
  value: KeyingCanonicalJson,
): ContainerMoveAccessEventBody {
  const record = assertExactKeys(
    value,
    [
      "containerKeyEpochId",
      "eventType",
      "parentContainerId",
      "parentManifestHash",
    ],
    "container.move event body",
  );

  return {
    eventType: "container.move",
    ...normalizeContainerAccessStructural({
      parentContainerId: record.parentContainerId,
      parentManifestHash: record.parentManifestHash,
    } as ContainerAccessStructural),
    ...normalizeContainerAccessKeyState({
      containerKeyEpochId: record.containerKeyEpochId,
    } as ContainerAccessKeyState),
  };
}

export function normalizeContainerAccessEventBody(
  value: KeyingCanonicalJson,
): ContainerAccessEventBody {
  if (!isPlainObject(value)) {
    throwVerification(
      "invalid_shape",
      "container access event body must be a plain object",
    );
  }

  const eventType = readString(value, "eventType", "container access body");

  if (eventType === "container.create") {
    return normalizeContainerCreateAccessEventBody(value);
  }

  if (eventType === "container.grant") {
    return normalizeContainerGrantAccessEventBody(value);
  }

  if (eventType === "container.revoke") {
    return normalizeContainerRevokeAccessEventBody(value);
  }

  if (eventType === "container.rekey") {
    return normalizeContainerRekeyAccessEventBody(value);
  }

  if (eventType === "container.move") {
    return normalizeContainerMoveAccessEventBody(value);
  }

  throwVerification(
    "invalid_domain",
    "container access event body eventType is unsupported",
  );
}

function upsertContainerDirectGrant(
  grants: readonly ContainerDirectGrant[],
  grant: ContainerDirectGrant,
): ContainerDirectGrant[] {
  const nextGrants = grants.filter(
    (existingGrant) =>
      containerDirectGrantKey(existingGrant) !== containerDirectGrantKey(grant),
  );
  nextGrants.push(grant);
  return normalizeContainerDirectGrants(nextGrants);
}

function removeContainerDirectGrant(
  grants: readonly ContainerDirectGrant[],
  revokedGrant: Pick<ContainerDirectGrant, "subjectId" | "subjectType">,
): ContainerDirectGrant[] {
  const revokedGrantKey = `${revokedGrant.subjectType}:${revokedGrant.subjectId}`;
  return normalizeContainerDirectGrants(
    grants.filter(
      (existingGrant) =>
        containerDirectGrantKey(existingGrant) !== revokedGrantKey,
    ),
  );
}

function upsertReferencedPrincipalHead(
  principalHeads: readonly ReferencedPrincipalHead[],
  principalHead: ReferencedPrincipalHead,
): ReferencedPrincipalHead[] {
  const nextPrincipalHeads = principalHeads.filter(
    (existingHead) =>
      referencedPrincipalKey(existingHead) !==
      referencedPrincipalKey(principalHead),
  );
  nextPrincipalHeads.push(principalHead);
  return normalizeReferencedPrincipalHeads(nextPrincipalHeads);
}

function removeReferencedPrincipalHead(
  principalHeads: readonly ReferencedPrincipalHead[],
  revokedGrant: Pick<ContainerDirectGrant, "subjectId" | "subjectType">,
): ReferencedPrincipalHead[] {
  if (revokedGrant.subjectType === "user") {
    return normalizeReferencedPrincipalHeads(principalHeads);
  }

  const revokedReferenceKey = `${revokedGrant.subjectType}:${revokedGrant.subjectId}`;
  return normalizeReferencedPrincipalHeads(
    principalHeads.filter(
      (principalHead) =>
        referencedPrincipalKey(principalHead) !== revokedReferenceKey,
    ),
  );
}

function requireContainerPathLast(
  path: readonly VerifiedContainerAccessManifest[] | undefined,
  label: string,
): VerifiedContainerAccessManifest {
  const lastManifest = path?.at(-1);
  if (!lastManifest) {
    throwVerification("missing_dependency", `${label} path is required`);
  }

  return lastManifest;
}

function requirePathLastMatchesManifest(input: {
  readonly path: readonly VerifiedContainerAccessManifest[] | undefined;
  readonly manifest: VerifiedContainerAccessManifest;
  readonly label: string;
}): void {
  const lastManifest = requireContainerPathLast(input.path, input.label);

  if (lastManifest.manifestHash !== input.manifest.manifestHash) {
    throwVerification(
      "missing_dependency",
      `${input.label} path does not end at the expected manifest`,
    );
  }
}

function principalPolicyMatchesReference(input: {
  readonly policy: VerifiedPrincipalPolicy;
  readonly reference: ReferencedPrincipalHead;
}): boolean {
  return (
    input.policy.principalType === input.reference.principalType &&
    input.policy.principalId === input.reference.principalId &&
    input.policy.version === input.reference.version &&
    input.policy.keyEpoch === input.reference.keyEpoch &&
    input.policy.stateHash === input.reference.stateHash &&
    input.policy.state.keyFingerprint === input.reference.keyFingerprint
  );
}

function grantAccessLevelForUser(input: {
  readonly grant: ContainerDirectGrant;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
  readonly state: ContainerAccessManifestState;
  readonly userId: string;
}): ContainerAccessLevel | null {
  if (input.grant.subjectType === "user") {
    return input.grant.subjectId === input.userId
      ? input.grant.accessLevel
      : null;
  }

  const referencedHead = input.state.referencedPrincipalHeads.find(
    (principalHead) =>
      principalHead.principalType === input.grant.subjectType &&
      principalHead.principalId === input.grant.subjectId,
  );

  if (!referencedHead) {
    return null;
  }

  const verifiedPolicy = input.principalPolicies.find((policy) =>
    principalPolicyMatchesReference({ policy, reference: referencedHead }),
  );

  if (!verifiedPolicy) {
    return null;
  }

  return verifiedPolicy.projection.some(
    (member) =>
      member.memberPrincipalType === "user" &&
      member.memberPrincipalId === input.userId,
  )
    ? input.grant.accessLevel
    : null;
}

export function resolveContainerPathUserAccessLevel(input: {
  readonly path: readonly VerifiedContainerAccessManifest[];
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
  readonly userId: string;
}): ContainerAccessLevel | null {
  let accessLevel: ContainerAccessLevel | null = null;

  for (const containerManifest of input.path) {
    for (const grant of containerManifest.state.directGrants) {
      const grantAccessLevel = grantAccessLevelForUser({
        grant,
        principalPolicies: input.principalPolicies ?? [],
        state: containerManifest.state,
        userId: input.userId,
      });

      if (grantAccessLevel) {
        accessLevel = mergeContainerAccessLevel(accessLevel, grantAccessLevel);
      }
    }
  }

  return accessLevel;
}

function requireContainerPathUserAccess(input: {
  readonly label: string;
  readonly minimumAccessLevel: ContainerAccessLevel;
  readonly path: readonly VerifiedContainerAccessManifest[] | undefined;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
  readonly userId: string;
}): void {
  const path = input.path;
  if (!path || path.length === 0) {
    throwVerification("missing_dependency", `${input.label} path is required`);
  }

  const accessLevel = resolveContainerPathUserAccessLevel({
    path,
    principalPolicies: input.principalPolicies,
    userId: input.userId,
  });

  if (
    accessLevel === null ||
    containerAccessLevelRank(accessLevel) <
      containerAccessLevelRank(input.minimumAccessLevel)
  ) {
    throwVerification(
      "unauthorized",
      `${input.label} signer lacks ${input.minimumAccessLevel} access`,
    );
  }
}

function requireContainerPathCurrentParent(input: {
  readonly parentContainerId: string | null;
  readonly parentManifestHash: string | null;
  readonly path: readonly VerifiedContainerAccessManifest[] | undefined;
  readonly label: string;
}): void {
  if (!input.parentContainerId || !input.parentManifestHash) {
    throwVerification(
      "missing_dependency",
      `${input.label} parent manifest is required`,
    );
  }

  const parentManifest = requireContainerPathLast(input.path, input.label);
  if (
    parentManifest.state.containerId !== input.parentContainerId ||
    parentManifest.manifestHash !== input.parentManifestHash
  ) {
    throwVerification(
      "missing_dependency",
      `${input.label} parent manifest hash mismatch`,
    );
  }
}

function requireRootCreateSignerAdmin(input: {
  readonly body: ContainerCreateAccessEventBody;
  readonly event: VerifiedAccessEvent;
  readonly parentContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
}): void {
  if (input.parentContainerPath && input.parentContainerPath.length > 0) {
    throwVerification(
      "invalid_shape",
      "root container.create must not include a parent path",
    );
  }

  const signerGrant = input.body.directGrants.find(
    (grant) =>
      grant.subjectType === "user" &&
      grant.subjectId === input.event.event.signerUserId,
  );

  if (
    !signerGrant ||
    containerAccessLevelRank(signerGrant.accessLevel) <
      containerAccessLevelRank("admin")
  ) {
    throwVerification(
      "unauthorized",
      "root container.create signer must grant themselves admin access",
    );
  }
}

type ContainerAccessManifestDerivationInput = {
  readonly body: ContainerAccessEventBody;
  readonly event: VerifiedAccessEvent;
  readonly previousManifest: VerifiedContainerAccessManifest | null;
  readonly previousContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly parentContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly destinationParentContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
};

type ContainerAccessManifestTransitionBase = Omit<
  ContainerAccessManifestState,
  "containerKeyEpochId" | "directGrants" | "referencedPrincipalHeads"
>;

interface PreviousContainerAccessTransition {
  readonly nextBase: ContainerAccessManifestTransitionBase;
  readonly previousState: ContainerAccessManifestState;
}

function assertContainerAccessEventDomain(
  input: ContainerAccessManifestDerivationInput,
): void {
  const { body, event } = input;

  if (event.event.objectKind !== "container") {
    throwVerification(
      "object_mismatch",
      "container access event must target a container",
    );
  }

  if (body.eventType !== event.event.eventType) {
    throwVerification(
      "invalid_domain",
      "container access event body type does not match event type",
    );
  }
}

function deriveContainerCreateManifestState(
  input: ContainerAccessManifestDerivationInput,
  body: ContainerCreateAccessEventBody,
): ContainerAccessManifestState {
  const { event, previousManifest } = input;

  if (previousManifest !== null || event.event.previousManifestHash !== null) {
    throwVerification(
      "stale_predecessor",
      "container.create must not have a previous manifest",
    );
  }

  if (body.parentContainerId === null && body.parentManifestHash === null) {
    requireRootCreateSignerAdmin({
      body,
      event,
      parentContainerPath: input.parentContainerPath,
    });
  } else {
    requireContainerPathCurrentParent({
      label: "container.create",
      parentContainerId: body.parentContainerId,
      parentManifestHash: body.parentManifestHash,
      path: input.parentContainerPath,
    });
    requireContainerPathUserAccess({
      label: "container.create",
      minimumAccessLevel: "write",
      path: input.parentContainerPath,
      principalPolicies: input.principalPolicies,
      userId: event.event.signerUserId,
    });
  }

  return normalizeContainerAccessManifestState({
    version: 1,
    containerId: event.event.objectId,
    organizationId: event.event.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: event.eventHash,
    parentContainerId: body.parentContainerId,
    parentManifestHash: body.parentManifestHash,
    metadataDocumentId: body.metadataDocumentId,
    containerKeyEpochId: body.containerKeyEpochId,
    directGrants: body.directGrants,
    referencedPrincipalHeads: body.referencedPrincipalHeads,
  });
}

function preparePreviousContainerAccessTransition(
  input: ContainerAccessManifestDerivationInput,
): PreviousContainerAccessTransition {
  const { body, event, previousManifest } = input;

  if (!previousManifest) {
    throwVerification(
      "missing_dependency",
      `${body.eventType} requires the previous container manifest`,
    );
  }

  if (event.event.previousManifestHash !== previousManifest.manifestHash) {
    throwVerification(
      "stale_predecessor",
      "container access event previous manifest does not match supplied previous manifest",
    );
  }

  requirePathLastMatchesManifest({
    label: "previous container",
    manifest: previousManifest,
    path: input.previousContainerPath,
  });

  const previousState = previousManifest.state;

  return {
    previousState,
    nextBase: {
      version: 1,
      containerId: previousState.containerId,
      organizationId: previousState.organizationId,
      epoch: previousState.epoch + 1,
      previousManifestHash: previousManifest.manifestHash,
      eventHash: event.eventHash,
      parentContainerId: previousState.parentContainerId,
      parentManifestHash: previousState.parentManifestHash,
      metadataDocumentId: previousState.metadataDocumentId,
    },
  };
}

function deriveContainerGrantManifestState(
  input: ContainerAccessManifestDerivationInput,
  body: ContainerGrantAccessEventBody,
  previous: PreviousContainerAccessTransition,
): ContainerAccessManifestState {
  requireContainerPathUserAccess({
    label: "container.grant",
    minimumAccessLevel: "admin",
    path: input.previousContainerPath,
    principalPolicies: input.principalPolicies,
    userId: input.event.event.signerUserId,
  });

  if (body.containerKeyEpochId !== previous.previousState.containerKeyEpochId) {
    throwVerification(
      "key_epoch_reuse",
      "container.grant must keep the current container KEK epoch",
    );
  }

  return normalizeContainerAccessManifestState({
    ...previous.nextBase,
    containerKeyEpochId: body.containerKeyEpochId,
    directGrants: upsertContainerDirectGrant(
      previous.previousState.directGrants,
      body.grant,
    ),
    referencedPrincipalHeads: body.referencedPrincipalHead
      ? upsertReferencedPrincipalHead(
          previous.previousState.referencedPrincipalHeads,
          body.referencedPrincipalHead,
        )
      : previous.previousState.referencedPrincipalHeads,
  });
}

function deriveContainerRevokeManifestState(
  input: ContainerAccessManifestDerivationInput,
  body: ContainerRevokeAccessEventBody,
  previous: PreviousContainerAccessTransition,
): ContainerAccessManifestState {
  requireContainerPathUserAccess({
    label: "container.revoke",
    minimumAccessLevel: "admin",
    path: input.previousContainerPath,
    principalPolicies: input.principalPolicies,
    userId: input.event.event.signerUserId,
  });

  if (
    body.containerKeyEpochId === null ||
    body.containerKeyEpochId === previous.previousState.containerKeyEpochId
  ) {
    throwVerification(
      "key_epoch_reuse",
      "container.revoke must create a new container KEK epoch",
    );
  }

  return normalizeContainerAccessManifestState({
    ...previous.nextBase,
    containerKeyEpochId: body.containerKeyEpochId,
    directGrants: removeContainerDirectGrant(
      previous.previousState.directGrants,
      body,
    ),
    referencedPrincipalHeads: removeReferencedPrincipalHead(
      previous.previousState.referencedPrincipalHeads,
      body,
    ),
  });
}

function deriveContainerRekeyManifestState(
  input: ContainerAccessManifestDerivationInput,
  body: ContainerRekeyAccessEventBody,
  previous: PreviousContainerAccessTransition,
): ContainerAccessManifestState {
  requireContainerPathUserAccess({
    label: "container.rekey",
    minimumAccessLevel: "write",
    path: input.previousContainerPath,
    principalPolicies: input.principalPolicies,
    userId: input.event.event.signerUserId,
  });

  if (body.containerKeyEpochId === previous.previousState.containerKeyEpochId) {
    throwVerification(
      "key_epoch_reuse",
      "container.rekey must create a new container KEK epoch",
    );
  }

  return normalizeContainerAccessManifestState({
    ...previous.nextBase,
    containerKeyEpochId: body.containerKeyEpochId,
    directGrants: previous.previousState.directGrants,
    referencedPrincipalHeads: previous.previousState.referencedPrincipalHeads,
  });
}

function deriveContainerMoveManifestState(
  input: ContainerAccessManifestDerivationInput,
  body: ContainerMoveAccessEventBody,
  previous: PreviousContainerAccessTransition,
): ContainerAccessManifestState {
  requireContainerPathUserAccess({
    label: "container.move source",
    minimumAccessLevel: "admin",
    path: input.previousContainerPath,
    principalPolicies: input.principalPolicies,
    userId: input.event.event.signerUserId,
  });
  requireContainerPathCurrentParent({
    label: "container.move destination",
    parentContainerId: body.parentContainerId,
    parentManifestHash: body.parentManifestHash,
    path: input.destinationParentContainerPath,
  });
  requireContainerPathUserAccess({
    label: "container.move destination",
    minimumAccessLevel: "write",
    path: input.destinationParentContainerPath,
    principalPolicies: input.principalPolicies,
    userId: input.event.event.signerUserId,
  });

  if (
    input.destinationParentContainerPath?.some(
      (containerManifest) =>
        containerManifest.state.containerId ===
        previous.previousState.containerId,
    )
  ) {
    throwVerification(
      "object_mismatch",
      "container.move destination parent cannot be the moved container or its descendant",
    );
  }

  return normalizeContainerAccessManifestState({
    ...previous.nextBase,
    parentContainerId: body.parentContainerId,
    parentManifestHash: body.parentManifestHash,
    containerKeyEpochId: body.containerKeyEpochId,
    directGrants: previous.previousState.directGrants,
    referencedPrincipalHeads: previous.previousState.referencedPrincipalHeads,
  });
}

function deriveContainerAccessManifestStateFromEvent(
  input: ContainerAccessManifestDerivationInput,
): ContainerAccessManifestState {
  assertContainerAccessEventDomain(input);

  if (input.body.eventType === "container.create") {
    return deriveContainerCreateManifestState(input, input.body);
  }

  const previous = preparePreviousContainerAccessTransition(input);

  if (input.body.eventType === "container.grant") {
    return deriveContainerGrantManifestState(input, input.body, previous);
  }

  if (input.body.eventType === "container.revoke") {
    return deriveContainerRevokeManifestState(input, input.body, previous);
  }

  if (input.body.eventType === "container.rekey") {
    return deriveContainerRekeyManifestState(input, input.body, previous);
  }

  return deriveContainerMoveManifestState(input, input.body, previous);
}

export async function verifyContainerAccessManifest({
  checkpointPredecessors,
  destinationParentContainerPath,
  event,
  expectedManifestHash,
  localCheckpoint,
  manifest,
  parentContainerPath,
  previousContainerPath,
  previousManifest = null,
  principalPolicies = [],
}: VerifyContainerAccessManifestInput): Promise<
  KeyingVerificationResult<VerifiedContainerAccessManifest>
> {
  return runVerifier(async () => {
    const body = normalizeContainerAccessEventBody(event.body);
    const state = deriveContainerAccessManifestStateFromEvent({
      body,
      destinationParentContainerPath,
      event,
      parentContainerPath,
      previousContainerPath,
      previousManifest,
      principalPolicies,
    });
    const derivedManifest = await deriveContainerAccessManifest(state);
    const derivedManifestHash =
      await computeAccessManifestHash(derivedManifest);

    if (derivedManifestHash !== expectedManifestHash) {
      throwVerification(
        "hash_mismatch",
        "container access manifest hash does not match derived state",
      );
    }

    const verifiedManifest = await verifyAccessManifest({
      manifest,
      expectedManifestHash,
      event,
      expectedObject: {
        objectKind: "container",
        objectId: state.containerId,
      },
      expectedPreviousManifestHash: state.previousManifestHash,
      localCheckpoint,
      checkpointPredecessors,
    });

    if (!verifiedManifest.ok) {
      throw verifiedManifest.error;
    }

    return {
      manifest: verifiedManifest.value.manifest,
      manifestHash: verifiedManifest.value.manifestHash,
      event,
      state,
      checkpoint: verifiedManifest.value.checkpoint,
    } as VerifiedContainerAccessManifest;
  });
}

function normalizeDocumentLinkSetStructural(
  value: DocumentLinkSetStructural,
): DocumentLinkSetStructural {
  const record = assertExactKeys(
    value,
    ["linkedContainerIds"],
    "document link-set structural state",
  );
  const linkedContainerIds = normalizeUniqueSortedStrings(
    readStringArray(
      record,
      "linkedContainerIds",
      "document link-set structural state",
    ),
    "document link-set linkedContainerIds",
  );

  if (linkedContainerIds.length === 0) {
    throwVerification(
      "missing_dependency",
      "document link-set must include at least one linked container",
    );
  }

  return { linkedContainerIds };
}

function normalizeDocumentLinkSetManifestState(
  value: DocumentLinkSetManifestState,
): DocumentLinkSetManifestState {
  const record = assertExactKeys(
    value,
    [
      "documentId",
      "epoch",
      "eventHash",
      "linkedContainerIds",
      "organizationId",
      "previousManifestHash",
      "version",
    ],
    "document link-set manifest state",
  );
  const structural = normalizeDocumentLinkSetStructural({
    linkedContainerIds: record.linkedContainerIds,
  } as DocumentLinkSetStructural);

  return {
    version: readVersion(record, "document link-set manifest state"),
    documentId: readString(
      record,
      "documentId",
      "document link-set manifest state",
    ),
    organizationId: readString(
      record,
      "organizationId",
      "document link-set manifest state",
    ),
    epoch: readPositiveInteger(
      record,
      "epoch",
      "document link-set manifest state",
    ),
    previousManifestHash: readNullableHashString(
      record,
      "previousManifestHash",
      "document link-set manifest state",
    ),
    eventHash: readHashString(
      record,
      "eventHash",
      "document link-set manifest state",
    ),
    linkedContainerIds: structural.linkedContainerIds,
  };
}

export async function computeDocumentLinkSetStructuralHash(
  structural: DocumentLinkSetStructural,
): Promise<string> {
  const payload: KeyingCanonicalPayload<DocumentLinkSetStructural> =
    normalizeDocumentLinkSetStructural(structural);

  return computeKeyingDomainHash(
    "tearleads.keying.document-link-set-structural",
    payload,
  );
}

export async function computeDocumentLinkSetGrantRoot(): Promise<string> {
  return computeKeyingDomainHash("tearleads.keying.document-link-set-grants", {
    grants: [],
  });
}

export async function computeDocumentLinkSetKeyTargetHash(): Promise<string> {
  return computeKeyingDomainHash(
    "tearleads.keying.document-link-set-key-target",
    { targetMode: "current-linked-container-keks" },
  );
}

export async function deriveDocumentLinkSetManifest(
  state: DocumentLinkSetManifestState,
): Promise<AccessManifest> {
  const normalizedState = normalizeDocumentLinkSetManifestState(state);

  return {
    version: 1,
    objectKind: "document",
    objectId: normalizedState.documentId,
    organizationId: normalizedState.organizationId,
    epoch: normalizedState.epoch,
    previousManifestHash: normalizedState.previousManifestHash,
    eventHash: normalizedState.eventHash,
    structuralHash: await computeDocumentLinkSetStructuralHash({
      linkedContainerIds: normalizedState.linkedContainerIds,
    }),
    grantRoot: await computeDocumentLinkSetGrantRoot(),
    referencedPrincipalHeads: [],
    keyTargetHash: await computeDocumentLinkSetKeyTargetHash(),
  };
}

function normalizeDocumentLinkAccessEventBody(
  value: KeyingCanonicalJson,
): DocumentLinkAccessEventBody {
  const record = assertExactKeys(
    value,
    ["containerId", "containerManifestHash", "eventType"],
    "document.link event body",
  );

  return {
    eventType: "document.link",
    containerId: readString(record, "containerId", "document.link event body"),
    containerManifestHash: readHashString(
      record,
      "containerManifestHash",
      "document.link event body",
    ),
  };
}

function normalizeDocumentUnlinkAccessEventBody(
  value: KeyingCanonicalJson,
): DocumentUnlinkAccessEventBody {
  const record = assertExactKeys(
    value,
    ["containerId", "containerManifestHash", "eventType"],
    "document.unlink event body",
  );

  return {
    eventType: "document.unlink",
    containerId: readString(
      record,
      "containerId",
      "document.unlink event body",
    ),
    containerManifestHash: readHashString(
      record,
      "containerManifestHash",
      "document.unlink event body",
    ),
  };
}

export function normalizeDocumentAccessEventBody(
  value: KeyingCanonicalJson,
): DocumentAccessEventBody {
  if (!isPlainObject(value)) {
    throwVerification(
      "invalid_shape",
      "document access event body must be a plain object",
    );
  }

  const eventType = readString(value, "eventType", "document access body");

  if (eventType === "document.link") {
    return normalizeDocumentLinkAccessEventBody(value);
  }

  if (eventType === "document.unlink") {
    return normalizeDocumentUnlinkAccessEventBody(value);
  }

  throwVerification(
    "invalid_domain",
    "document access event body eventType is unsupported",
  );
}

function normalizeAttachmentBindAccessEventBody(
  value: KeyingCanonicalJson,
): AttachmentBindAccessEventBody {
  const record = assertExactKeys(
    value,
    [
      "bindingId",
      "blobId",
      "documentId",
      "documentManifestHash",
      "eventType",
      "expectedBindingId",
      "slotId",
    ],
    "attachment.bind event body",
  );

  return {
    eventType: "attachment.bind",
    bindingId: readString(record, "bindingId", "attachment.bind event body"),
    blobId: readString(record, "blobId", "attachment.bind event body"),
    documentId: readString(record, "documentId", "attachment.bind event body"),
    slotId: readString(record, "slotId", "attachment.bind event body"),
    expectedBindingId: readNullableString(
      record,
      "expectedBindingId",
      "attachment.bind event body",
    ),
    documentManifestHash: readHashString(
      record,
      "documentManifestHash",
      "attachment.bind event body",
    ),
  };
}

function normalizeAttachmentDetachAccessEventBody(
  value: KeyingCanonicalJson,
): AttachmentDetachAccessEventBody {
  const record = assertExactKeys(
    value,
    [
      "bindingId",
      "blobId",
      "documentId",
      "documentManifestHash",
      "eventType",
      "slotId",
    ],
    "attachment.detach event body",
  );

  return {
    eventType: "attachment.detach",
    bindingId: readString(record, "bindingId", "attachment.detach event body"),
    blobId: readString(record, "blobId", "attachment.detach event body"),
    documentId: readString(
      record,
      "documentId",
      "attachment.detach event body",
    ),
    slotId: readString(record, "slotId", "attachment.detach event body"),
    documentManifestHash: readHashString(
      record,
      "documentManifestHash",
      "attachment.detach event body",
    ),
  };
}

export function normalizeAttachmentAccessEventBody(
  value: KeyingCanonicalJson,
): AttachmentAccessEventBody {
  if (!isPlainObject(value)) {
    throwVerification(
      "invalid_shape",
      "attachment access event body must be a plain object",
    );
  }

  const eventType = readString(value, "eventType", "attachment access body");

  if (eventType === "attachment.bind") {
    return normalizeAttachmentBindAccessEventBody(value);
  }

  if (eventType === "attachment.detach") {
    return normalizeAttachmentDetachAccessEventBody(value);
  }

  throwVerification(
    "invalid_domain",
    "attachment access event body eventType is unsupported",
  );
}

function assertAttachmentAccessEventDomain(input: {
  readonly body: AttachmentAccessEventBody;
  readonly event: VerifiedAccessEvent;
}): void {
  const { body, event } = input;

  if (event.event.objectKind !== "blob") {
    throwVerification(
      "object_mismatch",
      "attachment access event must target a blob",
    );
  }

  if (event.event.objectId !== body.blobId) {
    throwVerification(
      "object_mismatch",
      "attachment access event blob id does not match body",
    );
  }

  if (event.event.eventType !== body.eventType) {
    throwVerification(
      "invalid_domain",
      "attachment access event body type does not match event type",
    );
  }

  requireEventDependency({
    event,
    manifestHash: body.documentManifestHash,
    label: "attachment access event document link-set",
  });
}

function assertExpectedAttachmentEventFields(input: {
  readonly body: AttachmentAccessEventBody;
  readonly expectedBindingId?: string | undefined;
  readonly expectedBlobId?: string | undefined;
  readonly expectedDocumentId?: string | undefined;
  readonly expectedDocumentManifestHash?: string | undefined;
}): void {
  if (
    input.expectedBindingId !== undefined &&
    input.body.bindingId !== input.expectedBindingId
  ) {
    throwVerification(
      "object_mismatch",
      "attachment event binding id does not match expected binding id",
    );
  }

  if (
    input.expectedBlobId !== undefined &&
    input.body.blobId !== input.expectedBlobId
  ) {
    throwVerification(
      "object_mismatch",
      "attachment event blob id does not match expected blob id",
    );
  }

  if (
    input.expectedDocumentId !== undefined &&
    input.body.documentId !== input.expectedDocumentId
  ) {
    throwVerification(
      "object_mismatch",
      "attachment event document id does not match expected document id",
    );
  }

  if (
    input.expectedDocumentManifestHash !== undefined &&
    input.body.documentManifestHash !== input.expectedDocumentManifestHash
  ) {
    throwVerification(
      "stale_predecessor",
      "attachment event document manifest hash does not match expected manifest",
    );
  }
}

function assertAttachmentDocumentAuthority(input: {
  readonly authorizingContainerPaths:
    | readonly (readonly VerifiedContainerAccessManifest[])[]
    | undefined;
  readonly body: AttachmentAccessEventBody;
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly event: VerifiedAccessEvent;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
}): void {
  if (
    input.body.documentId !== input.documentManifest.state.documentId ||
    input.body.documentManifestHash !== input.documentManifest.manifestHash
  ) {
    throwVerification(
      "stale_predecessor",
      "attachment event document manifest does not match body",
    );
  }

  if (
    input.event.event.organizationId !==
    input.documentManifest.state.organizationId
  ) {
    throwVerification(
      "object_mismatch",
      "attachment event organization does not match document manifest",
    );
  }

  requireAnyLinkedContainerWriteAccess({
    event: input.event,
    label: input.body.eventType,
    linkedContainerIds: input.documentManifest.state.linkedContainerIds,
    organizationId: input.documentManifest.state.organizationId,
    paths: input.authorizingContainerPaths,
    principalPolicies: input.principalPolicies,
  });
}

async function verifyAttachmentAccessEvent(
  input: VerifyAccessEventInput,
): Promise<{
  readonly body: AttachmentAccessEventBody;
  readonly event: VerifiedAccessEvent;
}> {
  const body = normalizeAttachmentAccessEventBody(input.body);
  const canonicalBody: KeyingCanonicalPayload<AttachmentAccessEventBody> = body;
  const event = await verifySignedAccessEvent({
    body: canonicalBody,
    event: input.event,
    signerPublicKey: input.signerPublicKey,
  });

  if (!event.ok) {
    throw event.error;
  }

  assertAttachmentAccessEventDomain({ body, event: event.value });
  return { body, event: event.value };
}

export async function verifyAttachmentBindingEvent({
  authorizingContainerPaths,
  documentManifest,
  expectedBindingId,
  expectedBlobId,
  expectedDocumentId,
  expectedDocumentManifestHash,
  expectedPreviousBindingId,
  principalPolicies = [],
  ...input
}: VerifyAttachmentBindingEventInput): Promise<
  KeyingVerificationResult<VerifiedAttachmentBinding>
> {
  return runVerifier(async () => {
    const { body, event } = await verifyAttachmentAccessEvent(input);

    if (body.eventType !== "attachment.bind") {
      throwVerification(
        "invalid_domain",
        "attachment binding verifier requires an attachment.bind event",
      );
    }

    assertExpectedAttachmentEventFields({
      body,
      expectedBindingId,
      expectedBlobId,
      expectedDocumentId,
      expectedDocumentManifestHash,
    });
    if (
      expectedPreviousBindingId !== undefined &&
      body.expectedBindingId !== expectedPreviousBindingId
    ) {
      throwVerification(
        "stale_predecessor",
        "attachment binding previous binding id does not match expected binding id",
      );
    }
    assertAttachmentDocumentAuthority({
      authorizingContainerPaths,
      body,
      documentManifest,
      event,
      principalPolicies,
    });

    return {
      bindingId: body.bindingId,
      blobId: body.blobId,
      documentId: body.documentId,
      slotId: body.slotId,
      documentManifestHash: body.documentManifestHash,
      event,
      body,
    } as VerifiedAttachmentBinding;
  });
}

export async function verifyAttachmentDetachEvent({
  authorizingContainerPaths,
  documentManifest,
  expectedBindingId,
  expectedBlobId,
  expectedDocumentId,
  expectedDocumentManifestHash,
  principalPolicies = [],
  ...input
}: VerifyAttachmentDetachEventInput): Promise<
  KeyingVerificationResult<VerifiedAttachmentDetach>
> {
  return runVerifier(async () => {
    const { body, event } = await verifyAttachmentAccessEvent(input);

    if (body.eventType !== "attachment.detach") {
      throwVerification(
        "invalid_domain",
        "attachment detach verifier requires an attachment.detach event",
      );
    }

    assertExpectedAttachmentEventFields({
      body,
      expectedBindingId,
      expectedBlobId,
      expectedDocumentId,
      expectedDocumentManifestHash,
    });
    assertAttachmentDocumentAuthority({
      authorizingContainerPaths,
      body,
      documentManifest,
      event,
      principalPolicies,
    });

    return {
      bindingId: body.bindingId,
      blobId: body.blobId,
      documentId: body.documentId,
      slotId: body.slotId,
      documentManifestHash: body.documentManifestHash,
      event,
      body,
    } as VerifiedAttachmentDetach;
  });
}

function requireEventDependency(input: {
  readonly event: VerifiedAccessEvent;
  readonly manifestHash: string;
  readonly label: string;
}): void {
  if (
    !input.event.event.dependencyManifestHashes.includes(input.manifestHash)
  ) {
    throwVerification(
      "missing_dependency",
      `${input.label} manifest hash is not signed as an event dependency`,
    );
  }
}

function requireContainerPathCurrentManifest(input: {
  readonly containerId: string;
  readonly event: VerifiedAccessEvent;
  readonly label: string;
  readonly manifestHash: string;
  readonly organizationId: string;
  readonly path: readonly VerifiedContainerAccessManifest[] | undefined;
}): VerifiedContainerAccessManifest {
  const manifest = requireContainerPathLast(input.path, input.label);

  if (
    manifest.state.containerId !== input.containerId ||
    manifest.manifestHash !== input.manifestHash
  ) {
    throwVerification(
      "missing_dependency",
      `${input.label} path does not end at the signed container manifest`,
    );
  }

  if (manifest.state.organizationId !== input.organizationId) {
    throwVerification(
      "object_mismatch",
      `${input.label} container belongs to the wrong organization`,
    );
  }

  requireEventDependency({
    event: input.event,
    manifestHash: input.manifestHash,
    label: input.label,
  });

  return manifest;
}

function requireContainerPathCurrentWriteAccess(input: {
  readonly containerId: string;
  readonly event: VerifiedAccessEvent;
  readonly label: string;
  readonly manifestHash: string;
  readonly organizationId: string;
  readonly path: readonly VerifiedContainerAccessManifest[] | undefined;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
}): void {
  requireContainerPathCurrentManifest(input);
  requireContainerPathUserAccess({
    label: input.label,
    minimumAccessLevel: "write",
    path: input.path,
    principalPolicies: input.principalPolicies,
    userId: input.event.event.signerUserId,
  });
}

function requireAnyLinkedContainerWriteAccess(input: {
  readonly event: VerifiedAccessEvent;
  readonly label: string;
  readonly linkedContainerIds: readonly string[];
  readonly organizationId: string;
  readonly paths:
    | readonly (readonly VerifiedContainerAccessManifest[])[]
    | undefined;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
}): void {
  const dependencyManifestHashes = new Set(
    input.event.event.dependencyManifestHashes,
  );
  const linkedContainerIds = new Set(input.linkedContainerIds);

  for (const path of input.paths ?? []) {
    const manifest = path.at(-1);
    if (
      !manifest ||
      !linkedContainerIds.has(manifest.state.containerId) ||
      manifest.state.organizationId !== input.organizationId ||
      !dependencyManifestHashes.has(manifest.manifestHash)
    ) {
      continue;
    }

    const accessLevel = resolveContainerPathUserAccessLevel({
      path,
      principalPolicies: input.principalPolicies,
      userId: input.event.event.signerUserId,
    });

    if (
      accessLevel !== null &&
      containerAccessLevelRank(accessLevel) >= containerAccessLevelRank("write")
    ) {
      return;
    }
  }

  throwVerification(
    "unauthorized",
    `${input.label} signer lacks write access through a signed linked container dependency`,
  );
}

function requireWriteAccessThroughCommittedDocumentTarget(input: {
  readonly documentKekTargets: VerifiedDocumentKekTargets;
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly label: string;
  readonly paths: readonly (readonly VerifiedContainerAccessManifest[])[];
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
  readonly userId: string;
}): void {
  const targetHashByContainerId = new Map(
    input.documentKekTargets.targets.map((target) => [
      target.containerId,
      target.containerManifestHash,
    ]),
  );
  const linkedContainerIds = new Set(
    input.documentManifest.state.linkedContainerIds,
  );

  for (const path of input.paths) {
    const manifest = path.at(-1);
    if (
      !manifest ||
      !linkedContainerIds.has(manifest.state.containerId) ||
      manifest.state.organizationId !==
        input.documentManifest.state.organizationId ||
      targetHashByContainerId.get(manifest.state.containerId) !==
        manifest.manifestHash
    ) {
      continue;
    }

    const accessLevel = resolveContainerPathUserAccessLevel({
      path,
      principalPolicies: input.principalPolicies,
      userId: input.userId,
    });

    if (
      accessLevel !== null &&
      containerAccessLevelRank(accessLevel) >= containerAccessLevelRank("write")
    ) {
      return;
    }
  }

  throwVerification(
    "unauthorized",
    `${input.label} signer lacks write access through a committed linked container target`,
  );
}

function requireWriteAccessThroughCommittedBlobTarget(input: {
  readonly blobKekTargets: VerifiedBlobKekTargets;
  readonly header: WriteHeader;
  readonly label: string;
  readonly paths: readonly (readonly VerifiedContainerAccessManifest[])[];
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
}): void {
  const targetManifestHashesByContainerId = new Map<string, Set<string>>();

  for (const target of input.blobKekTargets.targets) {
    const manifestHashes =
      targetManifestHashesByContainerId.get(target.containerId) ?? new Set();
    manifestHashes.add(target.containerManifestHash);
    targetManifestHashesByContainerId.set(target.containerId, manifestHashes);
  }

  for (const path of input.paths) {
    const manifest = path.at(-1);
    if (
      !manifest ||
      manifest.state.organizationId !== input.header.organizationId ||
      !targetManifestHashesByContainerId
        .get(manifest.state.containerId)
        ?.has(manifest.manifestHash)
    ) {
      continue;
    }

    const accessLevel = resolveContainerPathUserAccessLevel({
      path,
      principalPolicies: input.principalPolicies,
      userId: input.header.writerUserId,
    });

    if (
      accessLevel !== null &&
      containerAccessLevelRank(accessLevel) >= containerAccessLevelRank("write")
    ) {
      return;
    }
  }

  throwVerification(
    "unauthorized",
    `${input.label} signer lacks write access through a committed blob target`,
  );
}

type DocumentLinkSetManifestDerivationInput = {
  readonly body: DocumentAccessEventBody;
  readonly event: VerifiedAccessEvent;
  readonly previousManifest: VerifiedDocumentLinkSetManifest | null;
  readonly targetContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly authorizingContainerPaths:
    | readonly (readonly VerifiedContainerAccessManifest[])[]
    | undefined;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
};

interface PreviousDocumentLinkSetTransition {
  readonly nextBase: Omit<DocumentLinkSetManifestState, "linkedContainerIds">;
  readonly previousState: DocumentLinkSetManifestState;
}

function assertDocumentAccessEventDomain(
  input: DocumentLinkSetManifestDerivationInput,
): void {
  const { body, event } = input;

  if (event.event.objectKind !== "document") {
    throwVerification(
      "object_mismatch",
      "document access event must target a document",
    );
  }

  if (body.eventType !== event.event.eventType) {
    throwVerification(
      "invalid_domain",
      "document access event body type does not match event type",
    );
  }
}

function preparePreviousDocumentLinkSetTransition(
  input: DocumentLinkSetManifestDerivationInput,
): PreviousDocumentLinkSetTransition {
  const { event, previousManifest } = input;

  if (!previousManifest) {
    throwVerification(
      "missing_dependency",
      `${input.body.eventType} requires the previous document link-set manifest`,
    );
  }

  if (event.event.previousManifestHash !== previousManifest.manifestHash) {
    throwVerification(
      "stale_predecessor",
      "document access event previous manifest does not match supplied previous manifest",
    );
  }

  if (
    previousManifest.state.documentId !== event.event.objectId ||
    previousManifest.state.organizationId !== event.event.organizationId
  ) {
    throwVerification(
      "object_mismatch",
      "document access previous manifest targets the wrong document",
    );
  }

  return {
    previousState: previousManifest.state,
    nextBase: {
      version: 1,
      documentId: previousManifest.state.documentId,
      organizationId: previousManifest.state.organizationId,
      epoch: previousManifest.state.epoch + 1,
      previousManifestHash: previousManifest.manifestHash,
      eventHash: event.eventHash,
    },
  };
}

function deriveInitialDocumentLinkSetManifestState(
  input: DocumentLinkSetManifestDerivationInput,
  body: DocumentLinkAccessEventBody,
): DocumentLinkSetManifestState {
  if (input.event.event.previousManifestHash !== null) {
    throwVerification(
      "stale_predecessor",
      "initial document.link must not have a previous manifest",
    );
  }

  requireContainerPathCurrentWriteAccess({
    containerId: body.containerId,
    event: input.event,
    label: "document.link target",
    manifestHash: body.containerManifestHash,
    organizationId: input.event.event.organizationId,
    path: input.targetContainerPath,
    principalPolicies: input.principalPolicies,
  });

  return normalizeDocumentLinkSetManifestState({
    version: 1,
    documentId: input.event.event.objectId,
    organizationId: input.event.event.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: input.event.eventHash,
    linkedContainerIds: [body.containerId],
  });
}

function deriveDocumentLinkManifestState(
  input: DocumentLinkSetManifestDerivationInput,
  body: DocumentLinkAccessEventBody,
  previous: PreviousDocumentLinkSetTransition,
): DocumentLinkSetManifestState {
  if (previous.previousState.linkedContainerIds.includes(body.containerId)) {
    throwVerification(
      "duplicate_entry",
      "document.link target container is already linked",
    );
  }

  requireAnyLinkedContainerWriteAccess({
    event: input.event,
    label: "document.link existing access",
    linkedContainerIds: previous.previousState.linkedContainerIds,
    organizationId: previous.previousState.organizationId,
    paths: input.authorizingContainerPaths,
    principalPolicies: input.principalPolicies,
  });
  requireContainerPathCurrentWriteAccess({
    containerId: body.containerId,
    event: input.event,
    label: "document.link target",
    manifestHash: body.containerManifestHash,
    organizationId: previous.previousState.organizationId,
    path: input.targetContainerPath,
    principalPolicies: input.principalPolicies,
  });

  return normalizeDocumentLinkSetManifestState({
    ...previous.nextBase,
    linkedContainerIds: [
      ...previous.previousState.linkedContainerIds,
      body.containerId,
    ],
  });
}

function deriveDocumentUnlinkManifestState(
  input: DocumentLinkSetManifestDerivationInput,
  body: DocumentUnlinkAccessEventBody,
  previous: PreviousDocumentLinkSetTransition,
): DocumentLinkSetManifestState {
  if (!previous.previousState.linkedContainerIds.includes(body.containerId)) {
    throwVerification(
      "missing_dependency",
      "document.unlink target container is not linked",
    );
  }

  const remainingLinkedContainerIds =
    previous.previousState.linkedContainerIds.filter(
      (containerId) => containerId !== body.containerId,
    );

  if (remainingLinkedContainerIds.length === 0) {
    throwVerification(
      "missing_dependency",
      "document.unlink must leave at least one linked container",
    );
  }

  requireContainerPathCurrentWriteAccess({
    containerId: body.containerId,
    event: input.event,
    label: "document.unlink target",
    manifestHash: body.containerManifestHash,
    organizationId: previous.previousState.organizationId,
    path: input.targetContainerPath,
    principalPolicies: input.principalPolicies,
  });
  requireAnyLinkedContainerWriteAccess({
    event: input.event,
    label: "document.unlink remaining access",
    linkedContainerIds: remainingLinkedContainerIds,
    organizationId: previous.previousState.organizationId,
    paths: input.authorizingContainerPaths,
    principalPolicies: input.principalPolicies,
  });

  return normalizeDocumentLinkSetManifestState({
    ...previous.nextBase,
    linkedContainerIds: remainingLinkedContainerIds,
  });
}

function deriveDocumentLinkSetManifestStateFromEvent(
  input: DocumentLinkSetManifestDerivationInput,
): DocumentLinkSetManifestState {
  assertDocumentAccessEventDomain(input);

  if (input.body.eventType === "document.link" && !input.previousManifest) {
    return deriveInitialDocumentLinkSetManifestState(input, input.body);
  }

  const previous = preparePreviousDocumentLinkSetTransition(input);

  if (input.body.eventType === "document.link") {
    return deriveDocumentLinkManifestState(input, input.body, previous);
  }

  return deriveDocumentUnlinkManifestState(input, input.body, previous);
}

export async function verifyDocumentLinkSetManifest({
  authorizingContainerPaths,
  checkpointPredecessors,
  event,
  expectedManifestHash,
  localCheckpoint,
  manifest,
  previousManifest = null,
  principalPolicies = [],
  targetContainerPath,
}: VerifyDocumentLinkSetManifestInput): Promise<
  KeyingVerificationResult<VerifiedDocumentLinkSetManifest>
> {
  return runVerifier(async () => {
    const body = normalizeDocumentAccessEventBody(event.body);
    const state = deriveDocumentLinkSetManifestStateFromEvent({
      authorizingContainerPaths,
      body,
      event,
      previousManifest,
      principalPolicies,
      targetContainerPath,
    });
    const derivedManifest = await deriveDocumentLinkSetManifest(state);
    const derivedManifestHash =
      await computeAccessManifestHash(derivedManifest);

    if (derivedManifestHash !== expectedManifestHash) {
      throwVerification(
        "hash_mismatch",
        "document link-set manifest hash does not match derived state",
      );
    }

    const verifiedManifest = await verifyAccessManifest({
      manifest,
      expectedManifestHash,
      event,
      expectedObject: {
        objectKind: "document",
        objectId: state.documentId,
      },
      expectedPreviousManifestHash: state.previousManifestHash,
      localCheckpoint,
      checkpointPredecessors,
    });

    if (!verifiedManifest.ok) {
      throw verifiedManifest.error;
    }

    return {
      manifest: verifiedManifest.value.manifest,
      manifestHash: verifiedManifest.value.manifestHash,
      event,
      state,
      checkpoint: verifiedManifest.value.checkpoint,
    } as VerifiedDocumentLinkSetManifest;
  });
}

export function verifyContainerParentEdge({
  child,
  parentHistory,
}: VerifyContainerParentEdgeInput): KeyingVerificationResult<VerifiedContainerParentEdge> {
  try {
    if (!child.state.parentContainerId || !child.state.parentManifestHash) {
      throwVerification(
        "missing_dependency",
        "container parent edge requires a parent manifest hash",
      );
    }

    if (parentHistory.length === 0) {
      throwVerification(
        "missing_dependency",
        "container parent edge requires parent manifest history",
      );
    }

    for (const parentManifest of parentHistory) {
      if (parentManifest.state.containerId !== child.state.parentContainerId) {
        throwVerification(
          "object_mismatch",
          "container parent edge history contains the wrong parent container",
        );
      }
    }

    if (
      !parentHistory.some(
        (parentManifest) =>
          parentManifest.manifestHash === child.state.parentManifestHash,
      )
    ) {
      throwVerification(
        "missing_dependency",
        "container parent manifest hash is not present in parent history",
      );
    }

    return ok({
      childContainerId: child.state.containerId,
      childManifestHash: child.manifestHash,
      parentContainerId: child.state.parentContainerId,
      parentManifestHash: child.state.parentManifestHash,
    } as VerifiedContainerParentEdge);
  } catch (error) {
    return toVerificationResult(error);
  }
}

function normalizeContainerKeyEpoch(
  value: ContainerKeyEpoch,
): ContainerKeyEpoch {
  const record = assertExactKeys(
    value,
    [
      "accessManifestHash",
      "containerId",
      "createdByEventHash",
      "createdByManifestHash",
      "id",
      "keyEpoch",
      "parentContainerKeyEpochId",
    ],
    "container key epoch",
  );

  return {
    id: readString(record, "id", "container key epoch"),
    containerId: readString(record, "containerId", "container key epoch"),
    keyEpoch: readPositiveInteger(record, "keyEpoch", "container key epoch"),
    accessManifestHash: readHashString(
      record,
      "accessManifestHash",
      "container key epoch",
    ),
    parentContainerKeyEpochId: readNullableString(
      record,
      "parentContainerKeyEpochId",
      "container key epoch",
    ),
    createdByEventHash: readHashString(
      record,
      "createdByEventHash",
      "container key epoch",
    ),
    createdByManifestHash: readHashString(
      record,
      "createdByManifestHash",
      "container key epoch",
    ),
  };
}

function normalizeContainerKeyWrap(value: ContainerKeyWrap): ContainerKeyWrap {
  const record = assertExactKeys(
    value,
    [
      "containerKeyEpochId",
      "kemCipherText",
      "recipientId",
      "recipientKeyEpochId",
      "recipientKeyFingerprint",
      "recipientKind",
      "wrapManifestHash",
      "wrappedKey",
    ],
    "container key wrap",
  );

  return {
    containerKeyEpochId: readString(
      record,
      "containerKeyEpochId",
      "container key wrap",
    ),
    recipientKind: normalizeKekRecipientKind(
      record.recipientKind,
      "container key wrap",
    ),
    recipientId: readString(record, "recipientId", "container key wrap"),
    recipientKeyEpochId: readString(
      record,
      "recipientKeyEpochId",
      "container key wrap",
    ),
    recipientKeyFingerprint: readHashString(
      record,
      "recipientKeyFingerprint",
      "container key wrap",
    ),
    kemCipherText: readString(record, "kemCipherText", "container key wrap"),
    wrappedKey: readString(record, "wrappedKey", "container key wrap"),
    wrapManifestHash: readHashString(
      record,
      "wrapManifestHash",
      "container key wrap",
    ),
  };
}

function normalizeContainerUserRecipientKey(
  value: ContainerUserRecipientKey,
): ContainerUserRecipientKey {
  const record = assertExactKeys(
    value,
    ["recipientKeyEpochId", "recipientKeyFingerprint", "userId"],
    "container user recipient key",
  );

  return {
    userId: readString(record, "userId", "container user recipient key"),
    recipientKeyEpochId: readString(
      record,
      "recipientKeyEpochId",
      "container user recipient key",
    ),
    recipientKeyFingerprint: readHashString(
      record,
      "recipientKeyFingerprint",
      "container user recipient key",
    ),
  };
}

function containerKeyWrapTarget(
  wrap: ContainerKeyWrap,
): ContainerKekRecipientTarget {
  return {
    recipientKind: wrap.recipientKind,
    recipientId: wrap.recipientId,
    recipientKeyEpochId: wrap.recipientKeyEpochId,
    recipientKeyFingerprint: wrap.recipientKeyFingerprint,
  };
}

function containerKeyWrapKey(wrap: ContainerKeyWrap): string {
  return `${wrap.containerKeyEpochId}:${containerKekRecipientTargetKey(containerKeyWrapTarget(wrap))}`;
}

export function derivePrincipalRecipientKeyEpochId(
  reference: ReferencedPrincipalHead,
): string {
  const normalizedReference = normalizeReferencedPrincipalHead(reference);

  return [
    normalizedReference.principalType,
    normalizedReference.principalId,
    normalizedReference.keyEpoch,
    normalizedReference.stateHash,
  ].join(":");
}

export async function computeContainerKeyEpochHash(
  keyEpoch: ContainerKeyEpoch,
): Promise<string> {
  const payload: KeyingCanonicalPayload<ContainerKeyEpoch> =
    normalizeContainerKeyEpoch(keyEpoch);

  return computeKeyingDomainHash(
    "tearleads.keying.container-key-epoch",
    payload,
  );
}

export async function computeContainerKekMaterialId(input: {
  readonly containerId: string;
  readonly keyEpoch: number;
  readonly keyMaterial: Uint8Array;
}): Promise<`${typeof CONTAINER_KEK_MATERIAL_ID_PREFIX}${string}`> {
  if (input.keyMaterial.byteLength !== 32) {
    throw new Error("Container KEK material must be 32 bytes");
  }

  const materialHash = await computeKeyingDomainHash(
    "tearleads.keying.container-kek-material-id",
    {
      version: 1,
      containerId: input.containerId,
      keyEpoch: input.keyEpoch,
      keyMaterial: bytesToBase64(input.keyMaterial),
    },
  );
  return `${CONTAINER_KEK_MATERIAL_ID_PREFIX}${materialHash}`;
}

export function isContainerKekMaterialId(value: string): boolean {
  return (
    value.startsWith(CONTAINER_KEK_MATERIAL_ID_PREFIX) &&
    value.length === CONTAINER_KEK_MATERIAL_ID_PREFIX.length + 64
  );
}

function buildContainerUserRecipientKeyMap(
  userRecipientKeys: readonly ContainerUserRecipientKey[],
): Map<string, ContainerUserRecipientKey> {
  const userKeyByUserId = new Map<string, ContainerUserRecipientKey>();

  for (const userKey of userRecipientKeys.map(
    normalizeContainerUserRecipientKey,
  )) {
    if (userKeyByUserId.has(userKey.userId)) {
      throwVerification(
        "duplicate_entry",
        "container user recipient keys contain a duplicate user",
      );
    }

    userKeyByUserId.set(userKey.userId, userKey);
  }

  return userKeyByUserId;
}

function requirePrincipalRecipientTarget(input: {
  readonly grant: ContainerDirectGrant;
  readonly state: ContainerAccessManifestState;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
}): ContainerKekRecipientTarget {
  if (input.grant.subjectType === "user") {
    throwVerification(
      "invalid_domain",
      "user grants do not have principal recipient targets",
    );
  }

  const referencedHead = input.state.referencedPrincipalHeads.find(
    (principalHead) =>
      principalHead.principalType === input.grant.subjectType &&
      principalHead.principalId === input.grant.subjectId,
  );

  if (!referencedHead) {
    throwVerification(
      "missing_dependency",
      "container KEK target derivation requires a referenced principal head",
    );
  }

  const verifiedPolicy = input.principalPolicies.find((policy) =>
    principalPolicyMatchesReference({ policy, reference: referencedHead }),
  );

  if (!verifiedPolicy) {
    throwVerification(
      "missing_dependency",
      "container KEK target derivation requires the verified principal policy",
    );
  }

  return {
    recipientKind: referencedHead.principalType,
    recipientId: referencedHead.principalId,
    recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(referencedHead),
    recipientKeyFingerprint: referencedHead.keyFingerprint,
  };
}

function deriveContainerKekRecipientTargetsOrThrow({
  containerManifest,
  parentKekState = null,
  principalPolicies = [],
  userRecipientKeys = [],
}: DeriveContainerKekRecipientTargetsInput): ContainerKekRecipientTarget[] {
  const targets: ContainerKekRecipientTarget[] = [];
  const userKeyByUserId = buildContainerUserRecipientKeyMap(userRecipientKeys);

  for (const grant of containerManifest.state.directGrants) {
    if (grant.subjectType === "user") {
      const userKey = userKeyByUserId.get(grant.subjectId);

      if (!userKey) {
        throwVerification(
          "missing_dependency",
          "container KEK target derivation requires a user recipient key",
        );
      }

      targets.push({
        recipientKind: "user",
        recipientId: grant.subjectId,
        recipientKeyEpochId: userKey.recipientKeyEpochId,
        recipientKeyFingerprint: userKey.recipientKeyFingerprint,
      });
      continue;
    }

    targets.push(
      requirePrincipalRecipientTarget({
        grant,
        state: containerManifest.state,
        principalPolicies,
      }),
    );
  }

  if (containerManifest.state.parentContainerId) {
    if (!parentKekState) {
      throwVerification(
        "missing_dependency",
        "container KEK target derivation requires verified parent KEK state",
      );
    }

    if (
      parentKekState.containerId !== containerManifest.state.parentContainerId
    ) {
      throwVerification(
        "object_mismatch",
        "container KEK parent target points at the wrong parent container",
      );
    }

    targets.push({
      recipientKind: "container",
      recipientId: parentKekState.containerId,
      recipientKeyEpochId: parentKekState.containerKeyEpochId,
      recipientKeyFingerprint: parentKekState.keyEpochHash,
    });
  }

  return normalizeSortedUniqueArray(
    targets,
    normalizeContainerKekRecipientTarget,
    containerKekRecipientTargetKey,
    "container KEK recipient targets",
  );
}

export function deriveContainerKekRecipientTargets(
  input: DeriveContainerKekRecipientTargetsInput,
): KeyingVerificationResult<readonly ContainerKekRecipientTarget[]> {
  try {
    return ok(deriveContainerKekRecipientTargetsOrThrow(input));
  } catch (error) {
    return toVerificationResult(error);
  }
}

function buildAuthorizedContainerManifestMap(input: {
  readonly current: VerifiedContainerAccessManifest;
  readonly history: readonly VerifiedContainerAccessManifest[];
  readonly keyEpochId: string;
}): Map<string, VerifiedContainerAccessManifest> {
  const manifestByHash = new Map<string, VerifiedContainerAccessManifest>();

  for (const manifest of [...input.history, input.current]) {
    if (manifest.state.containerId !== input.current.state.containerId) {
      throwVerification(
        "object_mismatch",
        "container KEK history contains the wrong container",
      );
    }

    if (manifestByHash.has(manifest.manifestHash)) {
      throwVerification(
        "duplicate_entry",
        "container KEK history contains a duplicate manifest",
      );
    }

    if (manifest.state.containerKeyEpochId === input.keyEpochId) {
      manifestByHash.set(manifest.manifestHash, manifest);
    }
  }

  return manifestByHash;
}

function assertContainerKeyEpochManifestBinding(input: {
  readonly keyEpoch: ContainerKeyEpoch;
  readonly manifestByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}): void {
  const accessManifest = input.manifestByHash.get(
    input.keyEpoch.accessManifestHash,
  );
  const createdByManifest = input.manifestByHash.get(
    input.keyEpoch.createdByManifestHash,
  );

  if (!accessManifest || !createdByManifest) {
    throwVerification(
      "missing_dependency",
      "container key epoch requires verified creation manifest history",
    );
  }

  if (createdByManifest.event.eventHash !== input.keyEpoch.createdByEventHash) {
    throwVerification(
      "hash_mismatch",
      "container key epoch created-by event hash does not match manifest",
    );
  }
}

function assertContainerKeyEpochParentBinding(input: {
  readonly containerManifest: VerifiedContainerAccessManifest;
  readonly keyEpoch: ContainerKeyEpoch;
  readonly parentKekState: VerifiedContainerKekState | null | undefined;
}): void {
  if (!input.containerManifest.state.parentContainerId) {
    if (input.keyEpoch.parentContainerKeyEpochId !== null) {
      throwVerification(
        "object_mismatch",
        "root container key epoch must not name a parent key epoch",
      );
    }

    return;
  }

  if (!input.parentKekState) {
    throwVerification(
      "missing_dependency",
      "container key epoch requires verified parent KEK state",
    );
  }

  if (
    input.parentKekState.containerId !==
    input.containerManifest.state.parentContainerId
  ) {
    throwVerification(
      "object_mismatch",
      "container key epoch parent state is for the wrong container",
    );
  }

  if (
    input.keyEpoch.parentContainerKeyEpochId !==
    input.parentKekState.containerKeyEpochId
  ) {
    throwVerification(
      "key_epoch_reuse",
      "container key epoch parent edge points at the wrong parent key epoch",
    );
  }
}

function deriveTargetsForWrapManifest(input: {
  readonly manifest: VerifiedContainerAccessManifest;
  readonly parentKekState: VerifiedContainerKekState | null;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
  readonly targetsByManifestHash: Map<string, ContainerKekRecipientTarget[]>;
  readonly userRecipientKeys: readonly ContainerUserRecipientKey[];
}): ContainerKekRecipientTarget[] {
  const cachedTargets = input.targetsByManifestHash.get(
    input.manifest.manifestHash,
  );

  if (cachedTargets) {
    return cachedTargets;
  }

  const targets = deriveContainerKekRecipientTargetsOrThrow({
    containerManifest: input.manifest,
    parentKekState: input.parentKekState,
    principalPolicies: input.principalPolicies,
    userRecipientKeys: input.userRecipientKeys,
  });
  input.targetsByManifestHash.set(input.manifest.manifestHash, targets);

  return targets;
}

function assertWrapJustifiedByTargets(input: {
  readonly wrap: ContainerKeyWrap;
  readonly targets: readonly ContainerKekRecipientTarget[];
}): void {
  const wrapTarget = containerKeyWrapTarget(input.wrap);
  const matchingTarget = input.targets.find(
    (target) =>
      containerKekRecipientTargetKey(target) ===
      containerKekRecipientTargetKey(wrapTarget),
  );

  if (!matchingTarget) {
    throwVerification(
      "missing_dependency",
      "container key wrap is not justified by its manifest",
    );
  }

  if (
    matchingTarget.recipientKeyFingerprint !==
    wrapTarget.recipientKeyFingerprint
  ) {
    throwVerification(
      "hash_mismatch",
      "container key wrap recipient fingerprint does not match justified target",
    );
  }
}

function assertContainerKeyEpochMatchesManifest(input: {
  readonly containerManifest: VerifiedContainerAccessManifest;
  readonly keyEpoch: ContainerKeyEpoch;
}): void {
  const containerKeyEpochId = input.containerManifest.state.containerKeyEpochId;

  if (containerKeyEpochId === null) {
    throwVerification(
      "missing_dependency",
      "container KEK state requires a container key epoch id",
    );
  }

  if (input.keyEpoch.id !== containerKeyEpochId) {
    throwVerification(
      "key_epoch_reuse",
      "container KEK state does not match the current access manifest",
    );
  }

  if (
    input.keyEpoch.containerId !== input.containerManifest.state.containerId
  ) {
    throwVerification(
      "object_mismatch",
      "container key epoch belongs to the wrong container",
    );
  }
}

function verifyContainerKeyWraps(input: {
  readonly keyEpoch: ContainerKeyEpoch;
  readonly manifestByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
  readonly parentKekState: VerifiedContainerKekState | null;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
  readonly targetsByManifestHash: Map<string, ContainerKekRecipientTarget[]>;
  readonly userRecipientKeys: readonly ContainerUserRecipientKey[];
  readonly wraps: readonly ContainerKeyWrap[];
}): {
  readonly normalizedWraps: ContainerKeyWrap[];
  readonly wrapByTargetKey: Map<string, ContainerKeyWrap>;
} {
  const normalizedWraps = normalizeSortedUniqueArray(
    input.wraps,
    normalizeContainerKeyWrap,
    containerKeyWrapKey,
    "container key wraps",
  );
  const wrapByTargetKey = new Map<string, ContainerKeyWrap>();

  for (const wrap of normalizedWraps) {
    if (wrap.containerKeyEpochId !== input.keyEpoch.id) {
      throwVerification(
        "object_mismatch",
        "container key wrap belongs to the wrong key epoch",
      );
    }

    const wrapManifest = input.manifestByHash.get(wrap.wrapManifestHash);
    if (!wrapManifest) {
      throwVerification(
        "missing_dependency",
        "container key wrap manifest is not in verified history",
      );
    }

    const targets = deriveTargetsForWrapManifest({
      manifest: wrapManifest,
      parentKekState: input.parentKekState,
      principalPolicies: input.principalPolicies,
      targetsByManifestHash: input.targetsByManifestHash,
      userRecipientKeys: input.userRecipientKeys,
    });
    assertWrapJustifiedByTargets({ wrap, targets });

    wrapByTargetKey.set(
      containerKekRecipientTargetKey(containerKeyWrapTarget(wrap)),
      wrap,
    );
  }

  return { normalizedWraps, wrapByTargetKey };
}

function assertContainerKeyWrapsMatchTargets(input: {
  readonly recipientTargets: readonly ContainerKekRecipientTarget[];
  readonly wrapByTargetKey: ReadonlyMap<string, ContainerKeyWrap>;
}): void {
  for (const target of input.recipientTargets) {
    const wrap = input.wrapByTargetKey.get(
      containerKekRecipientTargetKey(target),
    );

    if (!wrap) {
      throwVerification(
        "missing_dependency",
        "container KEK state is missing a required key wrap",
      );
    }

    if (wrap.recipientKeyFingerprint !== target.recipientKeyFingerprint) {
      throwVerification(
        "hash_mismatch",
        "container key wrap recipient fingerprint does not match verified target",
      );
    }
  }

  if (input.wrapByTargetKey.size !== input.recipientTargets.length) {
    throwVerification(
      "missing_dependency",
      "container KEK state contains an extra key wrap",
    );
  }
}

async function buildVerifiedContainerKekState(input: {
  readonly containerManifest: VerifiedContainerAccessManifest;
  readonly keyEpoch: ContainerKeyEpoch;
  readonly normalizedWraps: readonly ContainerKeyWrap[];
  readonly recipientTargets: readonly ContainerKekRecipientTarget[];
}): Promise<VerifiedContainerKekState> {
  const state = {
    containerId: input.containerManifest.state.containerId,
    accessManifestHash: input.containerManifest.manifestHash,
    containerKeyEpochId: input.keyEpoch.id,
    containerKeyEpoch: input.keyEpoch.keyEpoch,
    keyEpoch: input.keyEpoch,
    keyEpochHash: await computeContainerKeyEpochHash(input.keyEpoch),
    parentContainerKeyEpochId: input.keyEpoch.parentContainerKeyEpochId,
    keyTargetHash: await computeContainerKekRecipientTargetHash(
      input.recipientTargets,
    ),
    recipientTargets: input.recipientTargets,
    wraps: input.normalizedWraps,
  };

  return state as typeof state & VerifiedContainerKekState;
}

export async function verifyContainerKekState({
  containerManifest,
  containerManifestHistory = [],
  keyEpoch,
  parentKekState = null,
  principalPolicies = [],
  userRecipientKeys = [],
  wraps,
}: VerifyContainerKekStateInput): Promise<
  KeyingVerificationResult<VerifiedContainerKekState>
> {
  return runVerifier(async () => {
    const normalizedKeyEpoch = normalizeContainerKeyEpoch(keyEpoch);
    assertContainerKeyEpochMatchesManifest({
      containerManifest,
      keyEpoch: normalizedKeyEpoch,
    });

    assertContainerKeyEpochParentBinding({
      containerManifest,
      keyEpoch: normalizedKeyEpoch,
      parentKekState,
    });

    const manifestByHash = buildAuthorizedContainerManifestMap({
      current: containerManifest,
      history: containerManifestHistory,
      keyEpochId: normalizedKeyEpoch.id,
    });
    assertContainerKeyEpochManifestBinding({
      keyEpoch: normalizedKeyEpoch,
      manifestByHash,
    });

    const recipientTargets = deriveContainerKekRecipientTargetsOrThrow({
      containerManifest,
      parentKekState,
      principalPolicies,
      userRecipientKeys,
    });
    const targetsByManifestHash = new Map<
      string,
      ContainerKekRecipientTarget[]
    >([[containerManifest.manifestHash, recipientTargets]]);
    const { normalizedWraps, wrapByTargetKey } = verifyContainerKeyWraps({
      keyEpoch: normalizedKeyEpoch,
      manifestByHash,
      parentKekState,
      principalPolicies,
      targetsByManifestHash,
      userRecipientKeys,
      wraps,
    });
    assertContainerKeyWrapsMatchTargets({
      recipientTargets,
      wrapByTargetKey,
    });

    return buildVerifiedContainerKekState({
      containerManifest,
      keyEpoch: normalizedKeyEpoch,
      normalizedWraps,
      recipientTargets,
    });
  });
}

function normalizeContainerKekRecipientTarget(
  value: ContainerKekRecipientTarget,
): ContainerKekRecipientTarget {
  const record = assertExactKeys(
    value,
    [
      "recipientId",
      "recipientKeyEpochId",
      "recipientKeyFingerprint",
      "recipientKind",
    ],
    "container KEK recipient target",
  );

  return {
    recipientKind: normalizeKekRecipientKind(
      record.recipientKind,
      "container KEK recipient target",
    ),
    recipientId: readString(
      record,
      "recipientId",
      "container KEK recipient target",
    ),
    recipientKeyEpochId: readString(
      record,
      "recipientKeyEpochId",
      "container KEK recipient target",
    ),
    recipientKeyFingerprint: readHashString(
      record,
      "recipientKeyFingerprint",
      "container KEK recipient target",
    ),
  };
}

function containerKekRecipientTargetKey(
  target: ContainerKekRecipientTarget,
): string {
  return `${target.recipientKind}:${target.recipientId}:${target.recipientKeyEpochId}`;
}

function normalizeContainerKekTarget(
  value: ContainerKekTarget,
  label: string,
): ContainerKekTarget {
  const record = assertExactKeys(
    value,
    [
      "containerId",
      "containerKeyEpoch",
      "containerKeyEpochId",
      "containerManifestHash",
    ],
    label,
  );

  return {
    containerId: readString(record, "containerId", label),
    containerManifestHash: readHashString(
      record,
      "containerManifestHash",
      label,
    ),
    containerKeyEpochId: readString(record, "containerKeyEpochId", label),
    containerKeyEpoch: readPositiveInteger(record, "containerKeyEpoch", label),
  };
}

function containerKekTargetKey(target: ContainerKekTarget): string {
  return `${target.containerId}:${target.containerKeyEpochId}`;
}

function normalizeBlobContentKeyTarget(
  value: BlobContentKeyTarget,
): BlobContentKeyTarget {
  const record = assertExactKeys(
    value,
    [
      "bindingId",
      "containerId",
      "containerKeyEpoch",
      "containerKeyEpochId",
      "containerManifestHash",
      "documentId",
    ],
    "blob content-key target",
  );

  return {
    containerId: readString(record, "containerId", "blob content-key target"),
    containerManifestHash: readHashString(
      record,
      "containerManifestHash",
      "blob content-key target",
    ),
    containerKeyEpochId: readString(
      record,
      "containerKeyEpochId",
      "blob content-key target",
    ),
    containerKeyEpoch: readPositiveInteger(
      record,
      "containerKeyEpoch",
      "blob content-key target",
    ),
    bindingId: readString(record, "bindingId", "blob content-key target"),
    documentId: readString(record, "documentId", "blob content-key target"),
  };
}

function blobContentKeyTargetKey(target: BlobContentKeyTarget): string {
  return `${target.bindingId}:${target.documentId}:${containerKekTargetKey(target)}`;
}

function normalizeSortedUniqueArray<T>(
  values: readonly T[],
  normalize: (value: T) => T,
  key: (value: T) => string,
  label: string,
): T[] {
  const normalizedValues = values
    .map(normalize)
    .sort((left, right) => compareCanonicalStrings(key(left), key(right)));

  for (let index = 1; index < normalizedValues.length; index += 1) {
    if (
      key(normalizedValues[index - 1] as T) ===
      key(normalizedValues[index] as T)
    ) {
      throwVerification("duplicate_entry", `${label} contains a duplicate`);
    }
  }

  return normalizedValues;
}

export async function computeContainerKekRecipientTargetHash(
  targets: readonly ContainerKekRecipientTarget[],
): Promise<string> {
  const normalizedTargets = normalizeSortedUniqueArray(
    targets,
    normalizeContainerKekRecipientTarget,
    containerKekRecipientTargetKey,
    "container KEK recipient targets",
  );
  const payload: KeyingCanonicalPayload<
    readonly ContainerKekRecipientTarget[]
  > = normalizedTargets;

  return computeKeyingDomainHash(
    "tearleads.keying.container-kek-recipient-targets",
    payload,
  );
}

export async function computeDocumentContentKeyTargetHash(
  targets: readonly DocumentContentKeyTarget[],
): Promise<string> {
  const normalizedTargets = normalizeSortedUniqueArray(
    targets,
    (target) =>
      normalizeContainerKekTarget(target, "document content-key target"),
    containerKekTargetKey,
    "document content-key targets",
  );
  const payload: KeyingCanonicalPayload<readonly DocumentContentKeyTarget[]> =
    normalizedTargets;

  return computeKeyingDomainHash(
    "tearleads.keying.document-content-key-targets",
    payload,
  );
}

function uniqueContainerManifestMap(
  manifests: readonly VerifiedContainerAccessManifest[],
): Map<string, VerifiedContainerAccessManifest> {
  const manifestByContainerId = new Map<
    string,
    VerifiedContainerAccessManifest
  >();

  for (const containerManifest of manifests) {
    if (manifestByContainerId.has(containerManifest.state.containerId)) {
      throwVerification(
        "duplicate_entry",
        "document KEK target derivation contains a duplicate container manifest",
      );
    }
    manifestByContainerId.set(
      containerManifest.state.containerId,
      containerManifest,
    );
  }

  return manifestByContainerId;
}

function uniqueContainerKekStateMap(
  states: readonly VerifiedContainerKekState[],
): Map<string, VerifiedContainerKekState> {
  const kekStateByContainerId = new Map<string, VerifiedContainerKekState>();

  for (const kekState of states) {
    if (kekStateByContainerId.has(kekState.containerId)) {
      throwVerification(
        "duplicate_entry",
        "document KEK target derivation contains a duplicate container KEK state",
      );
    }
    kekStateByContainerId.set(kekState.containerId, kekState);
  }

  return kekStateByContainerId;
}

function deriveLinkedDocumentKekTarget(input: {
  readonly containerId: string;
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly manifestByContainerId: ReadonlyMap<
    string,
    VerifiedContainerAccessManifest
  >;
  readonly kekStateByContainerId: ReadonlyMap<
    string,
    VerifiedContainerKekState
  >;
}): DocumentContentKeyTarget {
  const containerManifest = input.manifestByContainerId.get(input.containerId);
  const kekState = input.kekStateByContainerId.get(input.containerId);

  if (!containerManifest || !kekState) {
    throwVerification(
      "missing_dependency",
      "document KEK target derivation is missing a linked container target",
    );
  }

  if (
    containerManifest.state.organizationId !==
      input.documentManifest.state.organizationId ||
    kekState.containerId !== input.containerId
  ) {
    throwVerification(
      "object_mismatch",
      "document KEK target belongs to the wrong document organization or container",
    );
  }

  if (kekState.accessManifestHash !== containerManifest.manifestHash) {
    throwVerification(
      "stale_predecessor",
      "document KEK target container manifest is stale",
    );
  }

  if (
    containerManifest.state.containerKeyEpochId === null ||
    kekState.containerKeyEpochId !== containerManifest.state.containerKeyEpochId
  ) {
    throwVerification(
      "key_epoch_reuse",
      "document KEK target container key epoch does not match the manifest",
    );
  }

  return {
    containerId: input.containerId,
    containerManifestHash: containerManifest.manifestHash,
    containerKeyEpochId: kekState.containerKeyEpochId,
    containerKeyEpoch: kekState.containerKeyEpoch,
  };
}

async function buildVerifiedDocumentKekTargets(input: {
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly targets: readonly DocumentContentKeyTarget[];
}): Promise<VerifiedDocumentKekTargets> {
  const targets = {
    documentId: input.documentManifest.state.documentId,
    linkSetManifestHash: input.documentManifest.manifestHash,
    linkedContainerManifestHashes: input.targets.map(
      (target) => target.containerManifestHash,
    ),
    linkedContainerKeyEpochIds: input.targets.map(
      (target) => target.containerKeyEpochId,
    ),
    targets: input.targets,
    documentKeyTargetHash: await computeDocumentContentKeyTargetHash(
      input.targets,
    ),
  };

  return targets as typeof targets & VerifiedDocumentKekTargets;
}

export async function deriveDocumentKekTargets({
  containerKekStates,
  documentManifest,
  linkedContainerManifests,
}: DeriveDocumentKekTargetsInput): Promise<
  KeyingVerificationResult<VerifiedDocumentKekTargets>
> {
  return runVerifier(async () => {
    const manifestByContainerId = uniqueContainerManifestMap(
      linkedContainerManifests,
    );
    const kekStateByContainerId =
      uniqueContainerKekStateMap(containerKekStates);

    const normalizedTargets = normalizeSortedUniqueArray(
      documentManifest.state.linkedContainerIds.map((containerId) =>
        deriveLinkedDocumentKekTarget({
          containerId,
          documentManifest,
          manifestByContainerId,
          kekStateByContainerId,
        }),
      ),
      (target) =>
        normalizeContainerKekTarget(target, "document content-key target"),
      containerKekTargetKey,
      "document content-key targets",
    );

    return buildVerifiedDocumentKekTargets({
      documentManifest,
      targets: normalizedTargets,
    });
  });
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCanonicalStrings);
}

function uniqueDocumentManifestMap(
  manifests: readonly VerifiedDocumentLinkSetManifest[],
): Map<string, VerifiedDocumentLinkSetManifest> {
  const manifestByDocumentId = new Map<
    string,
    VerifiedDocumentLinkSetManifest
  >();

  for (const documentManifest of manifests) {
    if (manifestByDocumentId.has(documentManifest.state.documentId)) {
      throwVerification(
        "duplicate_entry",
        "blob KEK target derivation contains a duplicate document manifest",
      );
    }
    manifestByDocumentId.set(
      documentManifest.state.documentId,
      documentManifest,
    );
  }

  return manifestByDocumentId;
}

function normalizeActiveAttachmentBindings(input: {
  readonly activeBindings: readonly VerifiedAttachmentBinding[];
  readonly blobId: string;
}): VerifiedAttachmentBinding[] {
  if (input.activeBindings.length === 0) {
    throwVerification(
      "missing_dependency",
      "blob KEK target derivation requires an active attachment binding",
    );
  }

  const normalizedBindings = [...input.activeBindings].sort((left, right) =>
    compareCanonicalStrings(left.bindingId, right.bindingId),
  );

  for (let index = 0; index < normalizedBindings.length; index += 1) {
    const binding = normalizedBindings[index] as VerifiedAttachmentBinding;

    if (binding.blobId !== input.blobId) {
      throwVerification(
        "object_mismatch",
        "blob KEK target derivation binding targets the wrong blob",
      );
    }

    if (
      binding.body.bindingId !== binding.bindingId ||
      binding.body.blobId !== binding.blobId ||
      binding.body.documentId !== binding.documentId ||
      binding.body.slotId !== binding.slotId ||
      binding.body.documentManifestHash !== binding.documentManifestHash
    ) {
      throwVerification(
        "object_mismatch",
        "blob KEK target derivation binding body does not match projection",
      );
    }

    if (binding.event.event.objectKind !== "blob") {
      throwVerification(
        "object_mismatch",
        "blob KEK target derivation binding event must target a blob",
      );
    }

    if (
      binding.event.event.eventType !== "attachment.bind" ||
      binding.event.event.objectId !== input.blobId
    ) {
      throwVerification(
        "object_mismatch",
        "blob KEK target derivation binding event does not match blob",
      );
    }

    if (
      index > 0 &&
      (normalizedBindings[index - 1] as VerifiedAttachmentBinding).bindingId ===
        binding.bindingId
    ) {
      throwVerification(
        "duplicate_entry",
        "blob KEK target derivation contains a duplicate attachment binding",
      );
    }
  }

  return normalizedBindings;
}

function requireDocumentManifestForBinding(input: {
  readonly binding: VerifiedAttachmentBinding;
  readonly documentManifestById: ReadonlyMap<
    string,
    VerifiedDocumentLinkSetManifest
  >;
}): VerifiedDocumentLinkSetManifest {
  const documentManifest = input.documentManifestById.get(
    input.binding.documentId,
  );

  if (!documentManifest) {
    throwVerification(
      "missing_dependency",
      "blob KEK target derivation is missing a binding document manifest",
    );
  }

  if (
    documentManifest.state.organizationId !==
    input.binding.event.event.organizationId
  ) {
    throwVerification(
      "object_mismatch",
      "blob KEK target derivation document manifest belongs to the wrong organization",
    );
  }

  requireEventDependency({
    event: input.binding.event,
    manifestHash: input.binding.documentManifestHash,
    label: "blob KEK target derivation attachment binding",
  });

  return documentManifest;
}

async function deriveBlobKekTargetsForBinding(input: {
  readonly binding: VerifiedAttachmentBinding;
  readonly containerKekStates: readonly VerifiedContainerKekState[];
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly linkedContainerManifests: readonly VerifiedContainerAccessManifest[];
}): Promise<BlobContentKeyTarget[]> {
  const documentTargets = await deriveDocumentKekTargets({
    documentManifest: input.documentManifest,
    linkedContainerManifests: input.linkedContainerManifests,
    containerKekStates: input.containerKekStates,
  });

  if (!documentTargets.ok) {
    throw documentTargets.error;
  }

  return documentTargets.value.targets.map((target) => ({
    ...target,
    bindingId: input.binding.bindingId,
    documentId: input.binding.documentId,
  }));
}

async function buildVerifiedBlobKekTargets(input: {
  readonly activeBindings: readonly VerifiedAttachmentBinding[];
  readonly blobId: string;
  readonly documentManifests: readonly VerifiedDocumentLinkSetManifest[];
  readonly targets: readonly BlobContentKeyTarget[];
}): Promise<VerifiedBlobKekTargets> {
  const organizationIds = uniqueSortedStrings(
    input.documentManifests.map((manifest) => manifest.state.organizationId),
  );
  const organizationId = organizationIds[0];
  if (!organizationId || organizationIds.length !== 1) {
    throwVerification(
      "object_mismatch",
      "blob KEK target derivation must stay within one organization",
    );
  }
  const blobKeyTargetHash = await computeBlobContentKeyTargetHash(
    input.targets,
  );
  const blobAccessManifestHash = await computeBlobAccessManifestHash({
    version: 1,
    blobId: input.blobId,
    organizationId,
    activeBindingIds: input.activeBindings.map((binding) => binding.bindingId),
    documentManifestHashes: uniqueSortedStrings(
      input.documentManifests.map((manifest) => manifest.manifestHash),
    ),
    linkedContainerManifestHashes: uniqueSortedStrings(
      input.targets.map((target) => target.containerManifestHash),
    ),
    linkedContainerKeyEpochIds: uniqueSortedStrings(
      input.targets.map((target) => target.containerKeyEpochId),
    ),
    blobKeyTargetHash,
  });

  const targets = {
    blobId: input.blobId,
    organizationId,
    activeBindingIds: input.activeBindings.map((binding) => binding.bindingId),
    documentManifestHashes: uniqueSortedStrings(
      input.documentManifests.map((manifest) => manifest.manifestHash),
    ),
    linkedContainerManifestHashes: uniqueSortedStrings(
      input.targets.map((target) => target.containerManifestHash),
    ),
    linkedContainerKeyEpochIds: uniqueSortedStrings(
      input.targets.map((target) => target.containerKeyEpochId),
    ),
    targets: input.targets,
    blobKeyTargetHash,
    blobAccessManifestHash,
  };

  return targets as typeof targets & VerifiedBlobKekTargets;
}

export async function deriveBlobKekTargets({
  activeBindings,
  blobId,
  containerKekStates,
  documentManifests,
  linkedContainerManifests,
}: DeriveBlobKekTargetsInput): Promise<
  KeyingVerificationResult<VerifiedBlobKekTargets>
> {
  return runVerifier(async () => {
    const normalizedBindings = normalizeActiveAttachmentBindings({
      activeBindings,
      blobId,
    });
    const documentManifestById = uniqueDocumentManifestMap(documentManifests);
    const targets: BlobContentKeyTarget[] = [];

    for (const binding of normalizedBindings) {
      const documentManifest = requireDocumentManifestForBinding({
        binding,
        documentManifestById,
      });
      targets.push(
        ...(await deriveBlobKekTargetsForBinding({
          binding,
          documentManifest,
          linkedContainerManifests,
          containerKekStates,
        })),
      );
    }

    const normalizedTargets = normalizeSortedUniqueArray(
      targets,
      normalizeBlobContentKeyTarget,
      blobContentKeyTargetKey,
      "blob content-key targets",
    );

    return buildVerifiedBlobKekTargets({
      activeBindings: normalizedBindings,
      blobId,
      documentManifests: normalizedBindings.map((binding) =>
        requireDocumentManifestForBinding({ binding, documentManifestById }),
      ),
      targets: normalizedTargets,
    });
  });
}

export async function computeBlobContentKeyTargetHash(
  targets: readonly BlobContentKeyTarget[],
): Promise<string> {
  const normalizedTargets = normalizeSortedUniqueArray(
    targets,
    normalizeBlobContentKeyTarget,
    blobContentKeyTargetKey,
    "blob content-key targets",
  );
  const payload: KeyingCanonicalPayload<readonly BlobContentKeyTarget[]> =
    normalizedTargets;

  return computeKeyingDomainHash(
    "tearleads.keying.blob-content-key-targets",
    payload,
  );
}

function normalizeHashStringArray(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string[] {
  const values = normalizeUniqueSortedStrings(
    readStringArray(record, key, label),
    `${label}.${key}`,
  );

  for (const [index, value] of values.entries()) {
    if (!/^[0-9a-f]{64}$/.test(value)) {
      throwVerification(
        "hash_mismatch",
        `${label}.${key}[${index}] must be a 64-character lowercase hex hash`,
      );
    }
  }

  return values;
}

function normalizeBlobAccessManifest(
  value: BlobAccessManifest,
): BlobAccessManifest {
  const record = assertExactKeys(
    value,
    [
      "activeBindingIds",
      "blobId",
      "blobKeyTargetHash",
      "documentManifestHashes",
      "linkedContainerKeyEpochIds",
      "linkedContainerManifestHashes",
      "organizationId",
      "version",
    ],
    "blob access manifest",
  );

  return {
    version: readVersion(record, "blob access manifest"),
    blobId: readString(record, "blobId", "blob access manifest"),
    organizationId: readString(
      record,
      "organizationId",
      "blob access manifest",
    ),
    activeBindingIds: normalizeUniqueSortedStrings(
      readStringArray(record, "activeBindingIds", "blob access manifest"),
      "blob access manifest.activeBindingIds",
    ),
    documentManifestHashes: normalizeHashStringArray(
      record,
      "documentManifestHashes",
      "blob access manifest",
    ),
    linkedContainerManifestHashes: normalizeHashStringArray(
      record,
      "linkedContainerManifestHashes",
      "blob access manifest",
    ),
    linkedContainerKeyEpochIds: normalizeUniqueSortedStrings(
      readStringArray(
        record,
        "linkedContainerKeyEpochIds",
        "blob access manifest",
      ),
      "blob access manifest.linkedContainerKeyEpochIds",
    ),
    blobKeyTargetHash: readHashString(
      record,
      "blobKeyTargetHash",
      "blob access manifest",
    ),
  };
}

export async function computeBlobAccessManifestHash(
  manifest: BlobAccessManifest,
): Promise<string> {
  const payload: KeyingCanonicalPayload<BlobAccessManifest> =
    normalizeBlobAccessManifest(manifest);

  return computeKeyingDomainHash(
    "tearleads.keying.blob-access-manifest",
    payload,
  );
}

function normalizeUnsignedWriteHeader(
  value: UnsignedWriteHeader,
): UnsignedWriteHeader {
  const record = assertExactKeys(
    value,
    [
      "accessManifestHash",
      "ciphertextHash",
      "contentRecordId",
      "contentKeyEpoch",
      "encryptionSuite",
      "metadataHash",
      "nonceDomainHash",
      "objectId",
      "objectKind",
      "organizationId",
      "signedAt",
      "targetHash",
      "version",
      "writerDeviceId",
      "writerKeyFingerprint",
      "writerUserId",
    ],
    "write header",
  );

  return {
    version: readVersion(record, "write header"),
    organizationId: readString(record, "organizationId", "write header"),
    objectKind: normalizeContentObjectKind(record.objectKind, "write header"),
    objectId: readString(record, "objectId", "write header"),
    accessManifestHash: readHashString(
      record,
      "accessManifestHash",
      "write header",
    ),
    contentKeyEpoch: readPositiveInteger(
      record,
      "contentKeyEpoch",
      "write header",
    ),
    targetHash: readHashString(record, "targetHash", "write header"),
    encryptionSuite: normalizeContentRecordEncryptionSuite(
      record.encryptionSuite,
      "write header",
    ),
    contentRecordId: readContentRecordId(
      record,
      "contentRecordId",
      "write header",
    ),
    nonceDomainHash: readHashString(record, "nonceDomainHash", "write header"),
    metadataHash: readHashString(record, "metadataHash", "write header"),
    ciphertextHash: readHashString(record, "ciphertextHash", "write header"),
    writerUserId: readString(record, "writerUserId", "write header"),
    writerDeviceId: readString(record, "writerDeviceId", "write header"),
    writerKeyFingerprint: readHashString(
      record,
      "writerKeyFingerprint",
      "write header",
    ),
    signedAt: readSignedAt(record, "signedAt", "write header"),
  };
}

function normalizeWriteHeader(value: WriteHeader): WriteHeader {
  const record = assertExactKeys(
    value,
    [
      "accessManifestHash",
      "ciphertextHash",
      "contentRecordId",
      "contentKeyEpoch",
      "encryptionSuite",
      "metadataHash",
      "nonceDomainHash",
      "objectId",
      "objectKind",
      "organizationId",
      "signature",
      "signedAt",
      "targetHash",
      "version",
      "writerDeviceId",
      "writerKeyFingerprint",
      "writerUserId",
    ],
    "write header",
  );
  const unsignedHeader = normalizeUnsignedWriteHeader({
    version: record.version,
    organizationId: record.organizationId,
    objectKind: record.objectKind,
    objectId: record.objectId,
    accessManifestHash: record.accessManifestHash,
    contentKeyEpoch: record.contentKeyEpoch,
    targetHash: record.targetHash,
    encryptionSuite: record.encryptionSuite,
    contentRecordId: record.contentRecordId,
    nonceDomainHash: record.nonceDomainHash,
    metadataHash: record.metadataHash,
    ciphertextHash: record.ciphertextHash,
    writerUserId: record.writerUserId,
    writerDeviceId: record.writerDeviceId,
    writerKeyFingerprint: record.writerKeyFingerprint,
    signedAt: record.signedAt,
  } as UnsignedWriteHeader);

  return {
    ...unsignedHeader,
    signature: readString(record, "signature", "write header"),
  };
}

function unsignedWriteHeaderPayload(
  header: UnsignedWriteHeader,
): KeyingCanonicalPayload<UnsignedWriteHeader> {
  return normalizeUnsignedWriteHeader(header);
}

function contentRecordNonceDomainFromHeader(
  header: UnsignedWriteHeader,
): ContentRecordNonceDomain {
  const normalizedHeader = normalizeUnsignedWriteHeader(header);

  return {
    version: 1,
    organizationId: normalizedHeader.organizationId,
    objectKind: normalizedHeader.objectKind,
    objectId: normalizedHeader.objectId,
    contentKeyEpoch: normalizedHeader.contentKeyEpoch,
    encryptionSuite: normalizedHeader.encryptionSuite,
    contentRecordId: normalizedHeader.contentRecordId,
  };
}

function normalizeContentRecordNonceDomain(
  value: ContentRecordNonceDomain,
): ContentRecordNonceDomain {
  const record = assertExactKeys(
    value,
    [
      "contentKeyEpoch",
      "contentRecordId",
      "encryptionSuite",
      "objectId",
      "objectKind",
      "organizationId",
      "version",
    ],
    "content record nonce domain",
  );

  return {
    version: readVersion(record, "content record nonce domain"),
    organizationId: readString(
      record,
      "organizationId",
      "content record nonce domain",
    ),
    objectKind: normalizeContentObjectKind(
      record.objectKind,
      "content record nonce domain",
    ),
    objectId: readString(record, "objectId", "content record nonce domain"),
    contentKeyEpoch: readPositiveInteger(
      record,
      "contentKeyEpoch",
      "content record nonce domain",
    ),
    encryptionSuite: normalizeContentRecordEncryptionSuite(
      record.encryptionSuite,
      "content record nonce domain",
    ),
    contentRecordId: readContentRecordId(
      record,
      "contentRecordId",
      "content record nonce domain",
    ),
  };
}

export async function computeContentRecordNonceDomainHash(
  domain: ContentRecordNonceDomain,
): Promise<string> {
  const payload: KeyingCanonicalPayload<ContentRecordNonceDomain> =
    normalizeContentRecordNonceDomain(domain);

  return computeKeyingDomainHash(
    "tearleads.keying.content-record-nonce-domain",
    payload,
  );
}

async function assertWriteHeaderNonceDomainHash(
  header: UnsignedWriteHeader,
): Promise<ContentRecordNonceDomain> {
  const nonceDomain = contentRecordNonceDomainFromHeader(header);
  const nonceDomainHash =
    await computeContentRecordNonceDomainHash(nonceDomain);

  if (nonceDomainHash !== header.nonceDomainHash) {
    throwVerification(
      "hash_mismatch",
      "write header nonce domain hash does not match derived content record domain",
    );
  }

  return nonceDomain;
}

function writeHeaderSigningBytes(header: UnsignedWriteHeader): Uint8Array {
  return encodeDomainPayload(
    "tearleads.keying.write-header-signing",
    unsignedWriteHeaderPayload(header),
  );
}

function toUnsignedWriteHeader(header: WriteHeader): UnsignedWriteHeader {
  return {
    version: header.version,
    organizationId: header.organizationId,
    objectKind: header.objectKind,
    objectId: header.objectId,
    accessManifestHash: header.accessManifestHash,
    contentKeyEpoch: header.contentKeyEpoch,
    targetHash: header.targetHash,
    encryptionSuite: header.encryptionSuite,
    contentRecordId: header.contentRecordId,
    nonceDomainHash: header.nonceDomainHash,
    metadataHash: header.metadataHash,
    ciphertextHash: header.ciphertextHash,
    writerUserId: header.writerUserId,
    writerDeviceId: header.writerDeviceId,
    writerKeyFingerprint: header.writerKeyFingerprint,
    signedAt: header.signedAt,
  };
}

export async function signWriteHeader(
  header: UnsignedWriteHeader,
  signingPrivateKey: Uint8Array,
): Promise<WriteHeader> {
  const normalizedHeader = normalizeUnsignedWriteHeader(header);
  await assertWriteHeaderNonceDomainHash(normalizedHeader);
  const signature = sign(
    writeHeaderSigningBytes(normalizedHeader),
    signingPrivateKey,
  );

  return {
    ...normalizedHeader,
    signature: bytesToBase64(signature),
  };
}

export async function computeWriteHeaderHash(
  header: WriteHeader,
): Promise<string> {
  const payload: KeyingCanonicalPayload<WriteHeader> =
    normalizeWriteHeader(header);

  return computeKeyingDomainHash("tearleads.keying.write-header", payload);
}

function assertDocumentWriteHeaderAuthorization(input: {
  readonly authorization: NonNullable<
    VerifyWriteHeaderInput["documentAuthorization"]
  >;
  readonly header: WriteHeader;
}): void {
  const { authorization, header } = input;
  const { documentKekTargets, documentManifest } = authorization;

  if (header.objectKind !== "document") {
    throwVerification(
      "object_mismatch",
      "document write authorization requires a document write header",
    );
  }

  if (
    documentManifest.state.documentId !== header.objectId ||
    documentManifest.state.organizationId !== header.organizationId ||
    documentManifest.manifestHash !== header.accessManifestHash
  ) {
    throwVerification(
      "object_mismatch",
      "write header does not match the committed document access manifest",
    );
  }

  if (
    documentKekTargets.documentId !== header.objectId ||
    documentKekTargets.linkSetManifestHash !== documentManifest.manifestHash ||
    documentKekTargets.documentKeyTargetHash !== header.targetHash
  ) {
    throwVerification(
      "hash_mismatch",
      "write header target hash does not match the verified document KEK targets",
    );
  }

  const linkedContainerIds = new Set(documentManifest.state.linkedContainerIds);
  if (
    documentKekTargets.targets.length !== linkedContainerIds.size ||
    documentKekTargets.targets.some(
      (target) => !linkedContainerIds.has(target.containerId),
    )
  ) {
    throwVerification(
      "hash_mismatch",
      "verified document KEK targets do not cover the committed linked containers",
    );
  }

  requireWriteAccessThroughCommittedDocumentTarget({
    documentKekTargets,
    documentManifest,
    label: "write header",
    paths: authorization.authorizingContainerPaths,
    principalPolicies: authorization.principalPolicies ?? [],
    userId: header.writerUserId,
  });
}

function assertBlobWriteHeaderAuthorization(input: {
  readonly authorization: NonNullable<
    VerifyWriteHeaderInput["blobAuthorization"]
  >;
  readonly header: WriteHeader;
}): void {
  const { authorization, header } = input;
  const { blobKekTargets } = authorization;

  if (header.objectKind !== "blob") {
    throwVerification(
      "object_mismatch",
      "blob write authorization requires a blob write header",
    );
  }

  if (
    blobKekTargets.blobId !== header.objectId ||
    blobKekTargets.organizationId !== header.organizationId ||
    blobKekTargets.blobAccessManifestHash !== header.accessManifestHash
  ) {
    throwVerification(
      "object_mismatch",
      "write header does not match the committed blob access manifest",
    );
  }

  if (blobKekTargets.blobKeyTargetHash !== header.targetHash) {
    throwVerification(
      "hash_mismatch",
      "write header target hash does not match the verified blob KEK targets",
    );
  }

  if (
    blobKekTargets.activeBindingIds.length === 0 ||
    blobKekTargets.targets.length === 0
  ) {
    throwVerification(
      "missing_dependency",
      "verified blob KEK targets do not cover an active attachment binding",
    );
  }

  requireWriteAccessThroughCommittedBlobTarget({
    blobKekTargets,
    header,
    label: "write header",
    paths: authorization.authorizingContainerPaths,
    principalPolicies: authorization.principalPolicies ?? [],
  });
}

function assertWriteHeaderAuthorizations(input: {
  readonly blobAuthorization: VerifyWriteHeaderInput["blobAuthorization"];
  readonly documentAuthorization: VerifyWriteHeaderInput["documentAuthorization"];
  readonly header: WriteHeader;
}): void {
  if (input.documentAuthorization) {
    assertDocumentWriteHeaderAuthorization({
      authorization: input.documentAuthorization,
      header: input.header,
    });
  }

  if (input.blobAuthorization) {
    assertBlobWriteHeaderAuthorization({
      authorization: input.blobAuthorization,
      header: input.header,
    });
  }
}

export async function verifyWriteHeader({
  blobAuthorization,
  documentAuthorization,
  expectedAccessManifestHash,
  expectedObject,
  expectedTargetHash,
  header,
  writerPublicKey,
}: VerifyWriteHeaderInput): Promise<
  KeyingVerificationResult<VerifiedWriteHeader>
> {
  return runVerifier(async () => {
    const normalizedHeader = normalizeWriteHeader(header);
    const nonceDomain = await assertWriteHeaderNonceDomainHash(
      toUnsignedWriteHeader(normalizedHeader),
    );
    const writerKeyFingerprint = await toFingerprint(writerPublicKey);

    if (writerKeyFingerprint !== normalizedHeader.writerKeyFingerprint) {
      throwVerification(
        "signer_mismatch",
        "write header writer fingerprint does not match writer public key",
      );
    }

    if (
      expectedAccessManifestHash !== undefined &&
      expectedAccessManifestHash !== normalizedHeader.accessManifestHash
    ) {
      throwVerification(
        "hash_mismatch",
        "write header access manifest hash does not match expected hash",
      );
    }

    if (
      expectedTargetHash !== undefined &&
      expectedTargetHash !== normalizedHeader.targetHash
    ) {
      throwVerification(
        "hash_mismatch",
        "write header target hash does not match expected hash",
      );
    }

    if (
      expectedObject &&
      (expectedObject.objectKind !== normalizedHeader.objectKind ||
        expectedObject.objectId !== normalizedHeader.objectId ||
        (expectedObject.organizationId !== undefined &&
          expectedObject.organizationId !== normalizedHeader.organizationId))
    ) {
      throwVerification(
        "object_mismatch",
        "write header object does not match expected object",
      );
    }

    assertWriteHeaderAuthorizations({
      blobAuthorization,
      documentAuthorization,
      header: normalizedHeader,
    });

    let signature: Uint8Array;
    try {
      signature = base64ToBytes(normalizedHeader.signature);
    } catch {
      throwVerification("signature_mismatch", "write header signature invalid");
    }

    if (
      !verify(
        signature,
        writeHeaderSigningBytes(toUnsignedWriteHeader(normalizedHeader)),
        writerPublicKey,
      )
    ) {
      throwVerification(
        "signature_mismatch",
        "write header signature verification failed",
      );
    }

    return {
      header: normalizedHeader,
      headerHash: await computeWriteHeaderHash(normalizedHeader),
      nonceDomain,
      nonceDomainHash: normalizedHeader.nonceDomainHash,
    } as VerifiedWriteHeader;
  });
}
