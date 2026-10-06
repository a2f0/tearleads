import type {
  PrincipalContainerGrant,
  PrincipalProjectionMember,
  PrincipalStateMemberEnvelope,
  PrincipalStatePayloadCipherSuite,
  SignedPrincipalState,
} from "../principalState";
import type { PrincipalPolicyExternalAuthority } from "./principalPolicyExternalAuthorityTypes";

export type ManagedPrincipalKind = "group" | "organization";

export interface ReferencedPrincipalHead {
  principalType: ManagedPrincipalKind;
  principalId: string;
  version: number;
  keyEpoch: number;
  stateHash: string;
  keyFingerprint: string;
}

export interface PrincipalPolicyCheckpoint {
  readonly principalType: ManagedPrincipalKind;
  readonly principalId: string;
  readonly version: number;
  readonly stateHash: string;
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

const verifiedPrincipalPolicyBrand: unique symbol = Symbol(
  "verifiedPrincipalPolicy",
);
const verifiedPrincipalPolicySnapshotBrand: unique symbol = Symbol();

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

/** Current artifacts whose authorization history is delivered separately. */
export type PrincipalPolicyCurrent = Omit<
  PrincipalPolicyBundle,
  "previousStates"
>;

const verifiedCurrentBrand: unique symbol = Symbol(
  "verifiedPrincipalPolicyCurrent",
);

/** Verified current artifacts and selected history, never a full-chain policy. */
export interface VerifiedPrincipalPolicyCurrent
  extends Pick<
    VerifiedPrincipalPolicy,
    | "principalType"
    | "principalId"
    | "version"
    | "keyEpoch"
    | "stateHash"
    | "state"
    | "projection"
    | "grants"
    | "checkpoint"
  > {
  readonly [verifiedCurrentBrand]: true;
  readonly retainedHistory: NonNullable<VerifiedPrincipalPolicy["history"]>;
}

const verifiedSelectionBrand: unique symbol = Symbol(
  "verifiedPrincipalPolicySelection",
);

/** Public authorization only; neither full history nor current key material. */
export interface VerifiedPrincipalPolicySelection
  extends Pick<
    VerifiedPrincipalPolicyCurrent,
    | "principalType"
    | "principalId"
    | "version"
    | "keyEpoch"
    | "stateHash"
    | "state"
    | "projection"
    | "grants"
    | "checkpoint"
    | "retainedHistory"
  > {
  readonly [verifiedSelectionBrand]: true;
}

/** Exact membership and explicitly retained citations for authorization. */
export type PrincipalPolicyAuthorization =
  | AnyVerifiedPrincipalPolicy
  | VerifiedPrincipalPolicyCurrent
  | VerifiedPrincipalPolicySelection;

export function makeVerifiedPrincipalPolicy(
  value: Omit<VerifiedPrincipalPolicy, typeof verifiedPrincipalPolicyBrand>,
): VerifiedPrincipalPolicy {
  return {
    ...value,
    [verifiedPrincipalPolicyBrand]: true,
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
    [verifiedPrincipalPolicySnapshotBrand]: true,
  };
}

export function makeVerifiedPrincipalPolicyCurrent(
  value: Omit<VerifiedPrincipalPolicyCurrent, typeof verifiedCurrentBrand>,
): VerifiedPrincipalPolicyCurrent {
  return { ...value, [verifiedCurrentBrand]: true };
}

export function makeVerifiedPrincipalPolicySelection(
  value: Omit<VerifiedPrincipalPolicySelection, typeof verifiedSelectionBrand>,
): VerifiedPrincipalPolicySelection {
  return { ...value, [verifiedSelectionBrand]: true };
}
