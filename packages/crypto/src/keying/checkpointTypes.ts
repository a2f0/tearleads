import type { AccessObjectKind } from "./accessEventTypes";
import type { AccessManifestCheckpoint } from "./accessManifestTypes";
import { verifiedBrandValue } from "./keyingVerifiedBrand";
import type {
  ManagedPrincipalKind,
  PrincipalPolicyCheckpoint,
} from "./principalPolicyTypes";

export interface IdentityStateHead {
  identityId: string;
  version: number;
  stateHash: string;
  previousStateHash: string | null;
}

const verifiedIdentityStateBrand: unique symbol = Symbol(
  "verifiedIdentityState",
);

export interface VerifiedIdentityState {
  readonly identityId: string;
  readonly version: number;
  readonly stateHash: string;
  readonly head: IdentityStateHead;
  readonly checkpoint: IdentityStateCheckpoint;
  readonly [verifiedIdentityStateBrand]: true;
}

export function makeVerifiedIdentityState(
  value: Omit<VerifiedIdentityState, typeof verifiedIdentityStateBrand>,
): VerifiedIdentityState {
  return {
    ...value,
    [verifiedIdentityStateBrand]: verifiedBrandValue,
  };
}

export interface IdentityStateCheckpoint {
  readonly identityId: string;
  readonly version: number;
  readonly stateHash: string;
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
