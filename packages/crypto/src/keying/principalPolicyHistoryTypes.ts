import type {
  PrincipalProjectionMember,
  PrincipalStateExternalAuthority,
} from "../principalState";
import type { PrincipalPolicyExternalAuthority } from "./principalPolicyExternalAuthorityTypes";
import type { PrincipalHistoryIndexNode } from "./principalPolicyHistoryIndex";
import type { PrincipalHistorySigner } from "./principalPolicyHistorySigners";
import type {
  PrincipalPolicyCheckpoint,
  PrincipalPolicySignerPublicKey,
  PrincipalPolicyStateChainEntry,
  ReferencedPrincipalHead,
} from "./principalPolicyTypes";
import { throwVerification } from "./shared";
import type { KeyingVerificationResult } from "./verificationError";

export const PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT = 128;

/** A crypto verification batch, not a wire-response DTO. */
export interface PrincipalPolicyHistoryPage {
  readonly entries: readonly PrincipalPolicyStateChainEntry[];
  /** Keys resolved through the caller's trusted user-identity mechanism. */
  readonly signerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
  /** Already authenticated authority; never trust a server page directly. */
  readonly externalAuthority?: PrincipalPolicyExternalAuthority;
}

export interface PrincipalPolicyHistoryInput {
  readonly principalId: string;
  readonly principalType: ReferencedPrincipalHead["principalType"];
  readonly localCheckpoint?: PrincipalPolicyCheckpoint | null;
  readonly retainedReferences?: readonly ReferencedPrincipalHead[];
}

/** Local verifier protection; never obtain this key from a remote API. */
export interface PrincipalPolicyHistoryProgressOptions {
  readonly localKey: Uint8Array;
  /** Stable local operation identity, bound into authenticated progress. */
  readonly context: string;
}

const verifiedHistoryBrand: unique symbol = Symbol(
  "verifiedPrincipalPolicyHistory",
);

/** A verified prefix with explicitly retained references, not a full snapshot. */
export interface VerifiedPrincipalPolicyHistory {
  readonly [verifiedHistoryBrand]: true;
  readonly currentEntry: PrincipalPolicyStateChainEntry;
  readonly retainedEntries: readonly PrincipalPolicyStateChainEntry[];
  readonly checkpoint: PrincipalPolicyCheckpoint;
  /** Computed only from locally accepted entries; never supplied by a peer. */
  readonly indexRootHash: string;
  /** Every accepted state's signer, bound to its committed bundle. */
  readonly signers: readonly PrincipalHistorySigner[];
}

type HistorySnapshot = Omit<
  VerifiedPrincipalPolicyHistory,
  typeof verifiedHistoryBrand
> & { readonly latestAuthority: PrincipalStateExternalAuthority | null };

// Public copies are useful for inspection, but their fields are not authority.
// A later verifier consumes the privately held snapshot issued by finish().
const issuedHistories = new WeakMap<
  VerifiedPrincipalPolicyHistory,
  HistorySnapshot
>();

export function makeVerifiedPrincipalPolicyHistory(
  value: Omit<VerifiedPrincipalPolicyHistory, typeof verifiedHistoryBrand>,
  latestAuthority: PrincipalStateExternalAuthority | null,
): VerifiedPrincipalPolicyHistory {
  const result: VerifiedPrincipalPolicyHistory = {
    currentEntry: value.currentEntry,
    retainedEntries: value.retainedEntries,
    checkpoint: value.checkpoint,
    indexRootHash: value.indexRootHash,
    signers: value.signers,
    [verifiedHistoryBrand]: true,
  };
  issuedHistories.set(result, structuredClone({ ...value, latestAuthority }));
  return result;
}

export function ownVerifiedPrincipalPolicyHistory(
  history: VerifiedPrincipalPolicyHistory,
): HistorySnapshot {
  const snapshot = issuedHistories.get(history);
  if (!snapshot)
    throwVerification(
      "invalid_shape",
      "principal history must come from a local verifier",
    );
  return structuredClone(snapshot);
}

export interface PrincipalPolicyHistoryVerifier {
  /** Owned copy of the latest accepted citation, including across uncited pages. */
  getExternalAuthorityReference(): ReferencedPrincipalHead | null;
  /**
   * Owned copy of the last accepted state's version and signed projection,
   * the authority the next page's first signer is checked against.
   */
  getLatestAcceptedProjection(): {
    readonly version: number;
    readonly stateHash: string;
    readonly projection: PrincipalProjectionMember[];
  } | null;
  append(page: PrincipalPolicyHistoryPage): Promise<
    KeyingVerificationResult<{
      readonly throughVersion: number;
      /** Retention hint computed from this accepted prefix, not verification authority. */
      readonly indexRootHash: string;
      readonly indexNodes: readonly PrincipalHistoryIndexNode[];
    }>
  >;
  finish(
    expectedHead: ReferencedPrincipalHead,
  ): KeyingVerificationResult<VerifiedPrincipalPolicyHistory>;
  exportProgress(
    options: PrincipalPolicyHistoryProgressOptions,
  ): Promise<KeyingVerificationResult<string>>;
}
