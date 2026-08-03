import { computePrincipalMemberEnvelopesRoot } from "../principalMemberEnvelopes";
import { throwVerification } from "./shared";
import type { PrincipalPolicyBundle } from "./types";

function memberKey(input: { readonly userId: string }): string {
  return input.userId;
}

export async function verifyPrincipalPolicyMemberEnvelopes(input: {
  readonly bundle: PrincipalPolicyBundle;
}): Promise<void> {
  const { currentMemberEnvelopes, currentProjection, currentState } =
    input.bundle;

  if (
    currentMemberEnvelopes.principalType !== currentState.principalType ||
    currentMemberEnvelopes.principalId !== currentState.principalId
  ) {
    throwVerification(
      "object_mismatch",
      "principal policy member envelopes do not match current state principal",
    );
  }

  if (
    currentMemberEnvelopes.stateHash !== currentState.stateHash ||
    currentMemberEnvelopes.epoch !== currentState.keyEpoch
  ) {
    throwVerification(
      "hash_mismatch",
      "principal policy member envelopes do not match current state",
    );
  }

  const computedRoot = await computePrincipalMemberEnvelopesRoot(
    currentMemberEnvelopes.envelopes,
  );
  if (computedRoot !== currentState.memberEnvelopesRoot) {
    throwVerification(
      "hash_mismatch",
      "principal policy member envelope root does not match current state",
    );
  }

  const projectionMembers = new Set(currentProjection.map(memberKey));
  const envelopeMembers = new Set(
    currentMemberEnvelopes.envelopes.map(memberKey),
  );
  if (
    projectionMembers.size !== envelopeMembers.size ||
    [...projectionMembers].some((member) => !envelopeMembers.has(member))
  ) {
    throwVerification(
      "hash_mismatch",
      "principal policy member envelopes do not match current projection",
    );
  }
}
