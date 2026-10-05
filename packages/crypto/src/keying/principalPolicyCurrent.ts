import { normalizePrincipalPolicyStateChainEntry } from "./principalPolicyChainEntry";
import {
  ownVerifiedPrincipalPolicyHistory,
  type VerifiedPrincipalPolicyHistory,
} from "./principalPolicyHistoryTypes";
import { verifyPrincipalPolicyMemberEnvelopes } from "./principalPolicyMemberEnvelopes";
import { verifyPrincipalPolicyPayload } from "./principalPolicyPayload";
import { principalPolicyStateMatchesReference } from "./principalPolicyReference";
import { runVerifier, throwVerification } from "./shared";
import type {
  KeyingVerificationResult,
  PrincipalPolicyBundle,
  PrincipalPolicyStateChainEntry,
  VerifiedPrincipalPolicy,
} from "./types";

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
    return {
      [verifiedCurrentBrand]: true,
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
    };
  });
}
