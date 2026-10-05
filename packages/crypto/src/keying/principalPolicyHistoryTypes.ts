import type { PrincipalPolicyExternalAuthority } from "./principalPolicyExternalAuthorityTypes";
import type {
  KeyingVerificationResult,
  PrincipalPolicyCheckpoint,
  PrincipalPolicySignerPublicKey,
  PrincipalPolicyStateChainEntry,
  ReferencedPrincipalHead,
} from "./types";

export const PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT = 128;

export interface PrincipalPolicyHistoryPage {
  readonly entries: readonly PrincipalPolicyStateChainEntry[];
  readonly signerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
  readonly externalAuthority?: PrincipalPolicyExternalAuthority;
}

export interface PrincipalPolicyHistoryInput {
  readonly principalId: string;
  readonly principalType: ReferencedPrincipalHead["principalType"];
  readonly localCheckpoint?: PrincipalPolicyCheckpoint | null;
  readonly retainedReferences?: readonly ReferencedPrincipalHead[];
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

export function makeVerifiedPrincipalPolicyHistory(
  value: Omit<VerifiedPrincipalPolicyHistory, typeof verifiedHistoryBrand>,
): VerifiedPrincipalPolicyHistory {
  return { ...value, [verifiedHistoryBrand]: true };
}

export interface PrincipalPolicyHistoryVerifier {
  append(
    page: PrincipalPolicyHistoryPage,
  ): Promise<KeyingVerificationResult<{ readonly throughVersion: number }>>;
  finish(
    expectedHead: ReferencedPrincipalHead,
  ): KeyingVerificationResult<VerifiedPrincipalPolicyHistory>;
}
