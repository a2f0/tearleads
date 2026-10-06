import {
  ownVerifiedPrincipalPolicyHistory,
  type VerifiedPrincipalPolicyHistory,
} from "./principalPolicyHistoryTypes";
import {
  makeVerifiedPrincipalPolicySelection,
  type VerifiedPrincipalPolicySelection,
} from "./principalPolicyTypes";
import { runVerifier } from "./shared";
import type { KeyingVerificationResult } from "./types";

export type { VerifiedPrincipalPolicySelection } from "./principalPolicyTypes";

/**
 * Public authorization evidence from a locally verified prefix. No payload or
 * member envelopes are required, so a deleted principal remains verifiable.
 * The result carries only selected entries and cannot stand in for full history
 * or authenticated current keying artifacts.
 */
export function selectPrincipalPolicyAuthorization(
  verifiedHistory: VerifiedPrincipalPolicyHistory,
): Promise<KeyingVerificationResult<VerifiedPrincipalPolicySelection>> {
  return runVerifier(async () => {
    const history = ownVerifiedPrincipalPolicyHistory(verifiedHistory);
    const { state, projection, grants } = history.currentEntry;
    return makeVerifiedPrincipalPolicySelection({
      principalType: state.principalType,
      principalId: state.principalId,
      version: state.version,
      keyEpoch: state.keyEpoch,
      stateHash: state.stateHash,
      state,
      projection: projection.map((member) => ({ ...member })),
      grants: grants.map((grant) => ({ ...grant })),
      checkpoint: history.checkpoint,
      retainedHistory: history.retainedEntries.map((entry) => ({
        state: entry.state,
        projection: entry.projection.map((member) => ({ ...member })),
        grants: entry.grants.map((grant) => ({ ...grant })),
      })),
    });
  });
}
