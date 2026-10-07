import {
  issueVerifiedPrincipalPolicyCurrent,
  ownVerifiedPrincipalPolicyCurrent,
} from "./principalPolicyCurrentEvidence";
import { normalizePrincipalHistoryInput } from "./principalPolicyHistoryChecks";
import { principalPolicyStateMatchesReference } from "./principalPolicyReference";
import type { VerifiedPrincipalPolicyCurrent } from "./principalPolicyTypes";
import { ok, throwVerification, toVerificationResult } from "./shared";
import type {
  KeyingVerificationResult,
  NormalizedPrincipalPolicyStateChainEntry,
  ReferencedPrincipalHead,
} from "./types";

/** Carry selected authenticated citations across one privately verified successor. */
export function selectPrincipalPolicyCurrentPredecessorReferences(input: {
  readonly current: VerifiedPrincipalPolicyCurrent;
  readonly predecessor: VerifiedPrincipalPolicyCurrent;
  readonly references: readonly ReferencedPrincipalHead[];
}): KeyingVerificationResult<VerifiedPrincipalPolicyCurrent> {
  try {
    const current = ownVerifiedPrincipalPolicyCurrent(input.current);
    const predecessor = ownVerifiedPrincipalPolicyCurrent(input.predecessor);
    const { references } = normalizePrincipalHistoryInput({
      principalId: current.policy.principalId,
      principalType: current.policy.principalType,
      retainedReferences: input.references,
    });
    if (
      predecessor.policy.principalType !== current.policy.principalType ||
      predecessor.policy.principalId !== current.policy.principalId ||
      predecessor.policy.version + 1 !== current.policy.version ||
      predecessor.policy.stateHash !== current.policy.state.prevStateHash
    )
      throwVerification(
        "stale_predecessor",
        "Selected history must belong to the exact verified predecessor",
      );
    const retained = new Map<
      number,
      NormalizedPrincipalPolicyStateChainEntry
    >();
    for (const policy of [predecessor.policy, current.policy])
      retained.set(policy.version, {
        state: policy.state,
        projection: policy.projection,
        grants: policy.grants,
      });
    for (const reference of references) {
      const entry = [
        ...current.policy.retainedHistory,
        ...predecessor.policy.retainedHistory,
      ].find(({ state }) =>
        principalPolicyStateMatchesReference(state, reference),
      );
      if (!entry)
        throwVerification(
          "missing_dependency",
          "Requested predecessor citation was not privately verified",
        );
      retained.set(entry.state.version, entry);
    }
    // At most the history reference budget plus the predecessor/successor pair.
    return ok(
      issueVerifiedPrincipalPolicyCurrent(
        {
          ...current.policy,
          retainedHistory: [...retained.values()].sort(
            (left, right) => left.state.version - right.state.version,
          ),
        },
        current.latestAuthority,
      ),
    );
  } catch (error) {
    return toVerificationResult(error);
  }
}
