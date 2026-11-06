import type { VerifiedContainerAccessManifest } from "./containerAccessTypes";
import { verifiedBrandValue } from "./keyingVerifiedBrand";
import type { PrincipalPolicyAuthorization } from "./principalPolicyTypes";

export type KekRecipientKind = "container" | "group" | "user";

export const CONTAINER_KEK_USER_WRAP_SUITE =
  "tearleads.container-kek-wrap.ml-kem-1024-aes-256-gcm" as const;
export const CONTAINER_KEK_PARENT_WRAP_SUITE =
  "tearleads.container-kek-wrap.ml-kem-1024-aes-256-gcm-parent-kek" as const;
export const CONTAINER_KEK_PREDECESSOR_WRAP_SUITE =
  "tearleads.container-kek-wrap.aes-256-gcm-predecessor-kek" as const;
export const CONTAINER_KEK_MATERIAL_ID_PREFIX =
  "tearleads.container-kek.v2.sha256:" as const;
export const CONTAINER_KEK_KEYRING_SEAL_SUITE =
  "tearleads.container-kek-keyring.aes-256-gcm-current-kek" as const;

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

const verifiedContainerKekStateBrand: unique symbol = Symbol("kek");

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

export function makeVerifiedContainerKekState(
  value: Omit<VerifiedContainerKekState, typeof verifiedContainerKekStateBrand>,
): VerifiedContainerKekState {
  return {
    ...value,
    [verifiedContainerKekStateBrand]: verifiedBrandValue,
  };
}

/**
 * The parent fields a child's key epoch and parent wrap bind. Writes cite only
 * these; reads that resolve a historical parent epoch pass the full verified
 * state, whose manifest hash anchors the lineage walk.
 */
export type ContainerKekParentBinding = Pick<
  VerifiedContainerKekState,
  "containerId" | "containerKeyEpochId" | "keyEpochHash"
>;

export interface DeriveContainerKekRecipientTargetsInput {
  readonly containerManifest: VerifiedContainerAccessManifest;
  readonly parentKekState?: ContainerKekParentBinding | null;
  readonly principalPolicies?: readonly PrincipalPolicyAuthorization[];
  readonly userRecipientKeys?: readonly ContainerUserRecipientKey[];
}

export interface VerifyContainerKekStateInput
  extends DeriveContainerKekRecipientTargetsInput {
  readonly keyEpoch: ContainerKeyEpoch;
  readonly wraps: readonly ContainerKeyWrap[];
  readonly containerManifestHistory?: readonly VerifiedContainerAccessManifest[];
  /** Read/recovery only; writes require the current parent epoch. */
  readonly allowHistoricalParentEpoch?: boolean;
  /** Verified signed parent citations, required for every non-root KEK. */
  readonly parentManifestHistory?: readonly VerifiedContainerAccessManifest[];
}
