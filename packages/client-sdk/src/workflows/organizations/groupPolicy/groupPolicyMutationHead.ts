import {
  computePrincipalStateHash,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";

export async function groupPolicyMutationHead(
  request: PutPrincipalPolicyRequest,
): Promise<ReferencedPrincipalHead> {
  const state = request.state;
  return {
    principalType: state.principalType,
    principalId: state.principalId,
    version: state.version,
    keyEpoch: state.keyEpoch,
    stateHash: await computePrincipalStateHash(state),
    keyFingerprint: state.keyFingerprint,
  };
}

function principalPolicyCurrentStateMatchesHead(
  state: ReferencedPrincipalHead,
  head: ReferencedPrincipalHead,
): boolean {
  return (
    state.principalType === head.principalType &&
    state.principalId === head.principalId &&
    state.version === head.version &&
    state.keyEpoch === head.keyEpoch &&
    state.stateHash === head.stateHash &&
    state.keyFingerprint === head.keyFingerprint
  );
}

export function assertPrincipalPolicyCurrentStateMatchesHead(
  state: ReferencedPrincipalHead,
  head: ReferencedPrincipalHead,
): void {
  if (!principalPolicyCurrentStateMatchesHead(state, head)) {
    throw new Error("Updated group policy advanced during root re-wrap");
  }
}
