import type { PrincipalPolicyExternalAuthority } from "./principalPolicyExternalAuthorityTypes";
import type {
  NormalizedPrincipalPolicyStateChainEntry,
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

/** A verified prefix with explicitly retained references, not a full snapshot. */
export interface VerifiedPrincipalPolicyHistory {
  readonly currentEntry: NormalizedPrincipalPolicyStateChainEntry;
  readonly retainedEntries: readonly NormalizedPrincipalPolicyStateChainEntry[];
  readonly checkpoint: PrincipalPolicyCheckpoint;
}
