import type { PrincipalPolicyExternalAuthority } from "./principalPolicyExternalAuthorityTypes";
import { throwVerification } from "./shared";
import type {
  KeyingVerificationResult,
  PrincipalPolicyCheckpoint,
  PrincipalPolicySignerPublicKey,
  PrincipalPolicyStateChainEntry,
  ReferencedPrincipalHead,
} from "./types";

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
}

type HistorySnapshot = Omit<
  VerifiedPrincipalPolicyHistory,
  typeof verifiedHistoryBrand
>;

// Public copies are useful for inspection, but their fields are not authority.
// A later verifier consumes the privately held snapshot issued by finish().
const issuedHistories = new WeakMap<
  VerifiedPrincipalPolicyHistory,
  HistorySnapshot
>();

export function makeVerifiedPrincipalPolicyHistory(
  value: Omit<VerifiedPrincipalPolicyHistory, typeof verifiedHistoryBrand>,
): VerifiedPrincipalPolicyHistory {
  const result: VerifiedPrincipalPolicyHistory = {
    ...value,
    [verifiedHistoryBrand]: true,
  };
  issuedHistories.set(result, structuredClone(value));
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
  append(
    page: PrincipalPolicyHistoryPage,
  ): Promise<KeyingVerificationResult<{ readonly throughVersion: number }>>;
  finish(
    expectedHead: ReferencedPrincipalHead,
  ): KeyingVerificationResult<VerifiedPrincipalPolicyHistory>;
  exportProgress(
    options: PrincipalPolicyHistoryProgressOptions,
  ): Promise<KeyingVerificationResult<string>>;
}
