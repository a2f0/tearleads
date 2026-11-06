import type { AccessObjectKind } from "./accessEventTypes";
import { verifiedBrandValue } from "./keyingVerifiedBrand";
import type { ManagedPrincipalKind } from "./principalPolicyTypes";

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

const verifiedTransparencyTreeHeadBrand: unique symbol = Symbol("treeHead");
const verifiedTransparencyProofBrand: unique symbol = Symbol("proof");

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
