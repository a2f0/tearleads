import { normalizePrincipalPolicyStateChainEntry } from "./principalPolicyChainEntry";
import {
  ownVerifiedPrincipalPolicyHistory,
  type VerifiedPrincipalPolicyHistory,
} from "./principalPolicyHistoryTypes";
import { verifyPrincipalPolicyMemberEnvelopes } from "./principalPolicyMemberEnvelopes";
import { verifyPrincipalPolicyPayload } from "./principalPolicyPayload";
import { principalPolicyStateMatchesReference } from "./principalPolicyReference";
import {
  makeVerifiedPrincipalPolicyCurrent,
  type PrincipalPolicyCurrent,
  type VerifiedPrincipalPolicyCurrent,
} from "./principalPolicyTypes";
import { runVerifier, throwVerification } from "./shared";
import type {
  KeyingVerificationResult,
  PrincipalPolicyStateChainEntry,
} from "./types";

export type {
  PrincipalPolicyCurrent,
  VerifiedPrincipalPolicyCurrent,
} from "./principalPolicyTypes";

// Adapt owned readonly evidence to the mutable arrays in policy result types.
function mutableEntry(entry: PrincipalPolicyStateChainEntry) {
  return {
    state: structuredClone(entry.state),
    projection: entry.projection.map((member) => ({ ...member })),
    grants: entry.grants.map((grant) => ({ ...grant })),
  };
}

/**
 * Authenticate current keying artifacts against a prefix already verified by
 * this runtime. The returned history contains only explicitly retained entries.
 */
export function verifyPrincipalPolicyCurrent(input: {
  readonly current: PrincipalPolicyCurrent;
  readonly history: VerifiedPrincipalPolicyHistory;
}): Promise<KeyingVerificationResult<VerifiedPrincipalPolicyCurrent>> {
  return runVerifier(async () => {
    const current = structuredClone(input.current);
    const history = ownVerifiedPrincipalPolicyHistory(input.history);
    const expected = history.currentEntry;
    const retained = history.retainedEntries.map(mutableEntry);
    const entry = await normalizePrincipalPolicyStateChainEntry({
      state: current.currentState,
      projection: current.currentProjection,
      grants: current.currentGrants,
    });
    // The state hash commits the signed header, not its signature bytes. Keep
    // both tied to the accepted entry when validating rows read from storage.
    if (
      !principalPolicyStateMatchesReference(entry.state, expected.state) ||
      entry.state.signature !== expected.state.signature
    )
      throwVerification(
        "hash_mismatch",
        "current principal policy does not match verified history",
      );
    await verifyPrincipalPolicyPayload({ bundle: current });
    await verifyPrincipalPolicyMemberEnvelopes({ bundle: current });
    return makeVerifiedPrincipalPolicyCurrent({
      principalType: entry.state.principalType,
      principalId: entry.state.principalId,
      version: entry.state.version,
      keyEpoch: entry.state.keyEpoch,
      stateHash: entry.state.stateHash,
      state: entry.state,
      projection: entry.projection,
      grants: entry.grants,
      retainedHistory: retained,
      checkpoint: {
        principalType: entry.state.principalType,
        principalId: entry.state.principalId,
        version: entry.state.version,
        stateHash: entry.state.stateHash,
      },
    });
  });
}
