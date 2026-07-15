import {
  computePrincipalStatePayloadCiphertextHash,
  normalizePrincipalProjectionMembers,
  serializeKeyingCanonicalJson,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { readCanonicalJson } from "../keyingCanonicalJson";

function canonical(value: unknown, label: string): string {
  return serializeKeyingCanonicalJson(readCanonicalJson(value, label));
}

export async function assertBundleMatchesVerifiedPolicy(input: {
  bundle: PrincipalPolicyBundleResponse;
  policy: VerifiedPrincipalPolicy;
}): Promise<void> {
  const { bundle, policy } = input;
  if (
    bundle.currentState.principalType !== policy.principalType ||
    bundle.currentState.principalId !== policy.principalId ||
    bundle.currentState.version !== policy.version ||
    bundle.currentState.keyEpoch !== policy.keyEpoch ||
    bundle.currentState.stateHash !== policy.stateHash ||
    policy.checkpoint.version !== policy.version ||
    policy.checkpoint.stateHash !== policy.stateHash
  ) {
    throw new Error("Verified principal policy bundle head mismatch");
  }
  if (
    canonical(bundle.currentState, "principal policy bundle state") !==
      canonical(policy.state, "verified principal policy state") ||
    canonical(
      normalizePrincipalProjectionMembers(bundle.currentProjection),
      "principal policy bundle projection",
    ) !==
      canonical(
        normalizePrincipalProjectionMembers(policy.projection),
        "verified principal policy projection",
      )
  ) {
    throw new Error("Verified principal policy bundle content mismatch");
  }

  const history = policy.history ?? [];
  const expectedChain = [
    ...bundle.previousStates,
    { state: bundle.currentState, projection: bundle.currentProjection },
  ].map((entry) => ({
    ...entry,
    projection: normalizePrincipalProjectionMembers(entry.projection),
  }));
  const verifiedHistory = history.map((entry) => ({
    ...entry,
    projection: normalizePrincipalProjectionMembers(entry.projection),
  }));
  if (
    canonical(expectedChain, "principal policy bundle history") !==
    canonical(verifiedHistory, "verified principal policy history")
  ) {
    throw new Error("Verified principal policy bundle history mismatch");
  }
  const payloadHash = await computePrincipalStatePayloadCiphertextHash(
    bundle.currentPayload.ciphertext,
  );
  if (
    bundle.currentPayload.principalType !== policy.principalType ||
    bundle.currentPayload.principalId !== policy.principalId ||
    bundle.currentPayload.stateHash !== policy.stateHash ||
    bundle.currentPayload.ciphertextHash !== payloadHash ||
    policy.state.payloadCiphertextHash !== payloadHash ||
    bundle.currentMemberEnvelopes.principalType !== policy.principalType ||
    bundle.currentMemberEnvelopes.principalId !== policy.principalId ||
    bundle.currentMemberEnvelopes.stateHash !== policy.stateHash ||
    bundle.currentMemberEnvelopes.epoch !== policy.keyEpoch
  ) {
    throw new Error("Verified principal policy bundle payload mismatch");
  }
}
