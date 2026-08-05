import {
  computePrincipalMemberEnvelopesRoot,
  computePrincipalStatePayloadCiphertextHash,
  KeyingVerificationError,
  normalizePrincipalProjectionMembers,
  PrincipalMemberEnvelopeValidationError,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { canonicalKeyingJsonString } from "../keyingCanonicalJson";

function bundleMismatch(message: string): never {
  throw new KeyingVerificationError("equivocation", message);
}

async function memberEnvelopesRoot(
  bundle: PrincipalPolicyBundleResponse,
): Promise<string> {
  try {
    return await computePrincipalMemberEnvelopesRoot(
      bundle.currentMemberEnvelopes.envelopes,
    );
  } catch (error) {
    if (error instanceof PrincipalMemberEnvelopeValidationError) {
      throw new KeyingVerificationError("invalid_shape", error.message);
    }
    throw error;
  }
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
    bundleMismatch("Verified principal policy bundle head mismatch");
  }
  if (
    canonicalKeyingJsonString(
      bundle.currentState,
      "principal policy bundle state",
    ) !==
      canonicalKeyingJsonString(
        policy.state,
        "verified principal policy state",
      ) ||
    canonicalKeyingJsonString(
      normalizePrincipalProjectionMembers(bundle.currentProjection),
      "principal policy bundle projection",
    ) !==
      canonicalKeyingJsonString(
        normalizePrincipalProjectionMembers(policy.projection),
        "verified principal policy projection",
      )
  ) {
    bundleMismatch("Verified principal policy bundle content mismatch");
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
    canonicalKeyingJsonString(
      expectedChain,
      "principal policy bundle history",
    ) !==
    canonicalKeyingJsonString(
      verifiedHistory,
      "verified principal policy history",
    )
  ) {
    bundleMismatch("Verified principal policy bundle history mismatch");
  }
  const payloadHash = await computePrincipalStatePayloadCiphertextHash(
    bundle.currentPayload.ciphertext,
  );
  const envelopesRoot = await memberEnvelopesRoot(bundle);
  if (
    bundle.currentPayload.principalType !== policy.principalType ||
    bundle.currentPayload.principalId !== policy.principalId ||
    bundle.currentPayload.stateHash !== policy.stateHash ||
    bundle.currentPayload.ciphertextHash !== payloadHash ||
    policy.state.payloadCiphertextHash !== payloadHash ||
    bundle.currentMemberEnvelopes.principalType !== policy.principalType ||
    bundle.currentMemberEnvelopes.principalId !== policy.principalId ||
    bundle.currentMemberEnvelopes.stateHash !== policy.stateHash ||
    bundle.currentMemberEnvelopes.epoch !== policy.keyEpoch ||
    envelopesRoot !== policy.state.memberEnvelopesRoot
  ) {
    bundleMismatch("Verified principal policy bundle payload mismatch");
  }
}
