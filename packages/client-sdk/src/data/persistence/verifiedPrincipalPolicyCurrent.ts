import type { PrincipalPolicyPageCurrent } from "@tearleads/api-client";
import {
  computePrincipalMemberEnvelopesRoot,
  computePrincipalStatePayloadCiphertextHash,
  KeyingVerificationError,
  normalizePrincipalContainerGrants,
  normalizePrincipalProjectionMembers,
  PrincipalMemberEnvelopeValidationError,
  type VerifiedPrincipalPolicy,
  type VerifiedPrincipalPolicyCurrent,
} from "@tearleads/crypto";
import { canonicalKeyingJsonString } from "../keyingCanonicalJson";

type VerifiedCurrentPolicy =
  | VerifiedPrincipalPolicy
  | VerifiedPrincipalPolicyCurrent;

function currentMismatch(message: string): never {
  throw new KeyingVerificationError("equivocation", message);
}

async function memberEnvelopesRoot(
  current: PrincipalPolicyPageCurrent,
): Promise<string> {
  try {
    return await computePrincipalMemberEnvelopesRoot(
      current.currentMemberEnvelopes.envelopes,
    );
  } catch (error) {
    if (error instanceof PrincipalMemberEnvelopeValidationError) {
      throw new KeyingVerificationError("invalid_shape", error.message);
    }
    throw error;
  }
}

async function assertCurrentPayloadMatches(input: {
  current: PrincipalPolicyPageCurrent;
  policy: VerifiedCurrentPolicy;
}): Promise<void> {
  const { current, policy } = input;
  const payloadHash = await computePrincipalStatePayloadCiphertextHash(
    current.currentPayload.ciphertext,
  );
  const envelopesRoot = await memberEnvelopesRoot(current);
  if (
    current.currentPayload.principalType !== policy.principalType ||
    current.currentPayload.principalId !== policy.principalId ||
    current.currentPayload.stateHash !== policy.stateHash ||
    current.currentPayload.ciphertextHash !== payloadHash ||
    policy.state.payloadCiphertextHash !== payloadHash ||
    current.currentMemberEnvelopes.principalType !== policy.principalType ||
    current.currentMemberEnvelopes.principalId !== policy.principalId ||
    current.currentMemberEnvelopes.stateHash !== policy.stateHash ||
    current.currentMemberEnvelopes.epoch !== policy.keyEpoch ||
    envelopesRoot !== policy.state.memberEnvelopesRoot
  ) {
    currentMismatch("Verified principal policy current payload mismatch");
  }
}

/** Bind current wire artifacts to already verified policy evidence; never authenticate history. */
export async function assertCurrentMatchesVerifiedPolicy(input: {
  current: PrincipalPolicyPageCurrent;
  policy: VerifiedCurrentPolicy;
}): Promise<void> {
  const { current, policy } = input;
  if (
    current.currentState.principalType !== policy.principalType ||
    current.currentState.principalId !== policy.principalId ||
    current.currentState.version !== policy.version ||
    current.currentState.keyEpoch !== policy.keyEpoch ||
    current.currentState.stateHash !== policy.stateHash ||
    policy.checkpoint.version !== policy.version ||
    policy.checkpoint.stateHash !== policy.stateHash
  ) {
    currentMismatch("Verified principal policy current head mismatch");
  }
  if (
    canonicalKeyingJsonString(
      current.currentState,
      "principal policy current state",
    ) !==
      canonicalKeyingJsonString(
        policy.state,
        "verified principal policy state",
      ) ||
    canonicalKeyingJsonString(
      normalizePrincipalProjectionMembers(current.currentProjection),
      "principal policy current projection",
    ) !==
      canonicalKeyingJsonString(
        normalizePrincipalProjectionMembers(policy.projection),
        "verified principal policy projection",
      ) ||
    canonicalKeyingJsonString(
      normalizePrincipalContainerGrants(current.currentGrants),
      "principal policy current grants",
    ) !==
      canonicalKeyingJsonString(
        normalizePrincipalContainerGrants(policy.grants),
        "verified principal policy grants",
      )
  ) {
    currentMismatch("Verified principal policy current content mismatch");
  }

  await assertCurrentPayloadMatches(input);
}
