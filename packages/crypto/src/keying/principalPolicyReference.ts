import type {
  NormalizedPrincipalPolicyStateChainEntry,
  PrincipalPolicyAuthorization,
  ReferencedPrincipalHead,
} from "./types";

export function principalPolicyEntryForReference(input: {
  readonly policy: PrincipalPolicyAuthorization;
  readonly reference: ReferencedPrincipalHead;
}): NormalizedPrincipalPolicyStateChainEntry | undefined {
  const currentMatches =
    input.policy.principalType === input.reference.principalType &&
    input.policy.principalId === input.reference.principalId &&
    input.policy.version === input.reference.version &&
    input.policy.keyEpoch === input.reference.keyEpoch &&
    input.policy.stateHash === input.reference.stateHash &&
    input.policy.state.keyFingerprint === input.reference.keyFingerprint;
  if (currentMatches) {
    return {
      state: input.policy.state,
      projection: input.policy.projection,
      grants: input.policy.grants,
    };
  }
  const history =
    "retainedHistory" in input.policy
      ? input.policy.retainedHistory
      : input.policy.history;
  return history?.find(
    (entry) =>
      entry.state.principalType === input.reference.principalType &&
      entry.state.principalId === input.reference.principalId &&
      entry.state.version === input.reference.version &&
      entry.state.keyEpoch === input.reference.keyEpoch &&
      entry.state.stateHash === input.reference.stateHash &&
      entry.state.keyFingerprint === input.reference.keyFingerprint,
  );
}

export function principalPolicyStateMatchesReference(
  state: ReferencedPrincipalHead,
  reference: ReferencedPrincipalHead,
): boolean {
  return (
    state.principalId === reference.principalId &&
    state.principalType === reference.principalType &&
    state.version === reference.version &&
    state.stateHash === reference.stateHash &&
    state.keyEpoch === reference.keyEpoch &&
    state.keyFingerprint === reference.keyFingerprint
  );
}
