import {
  KeyingVerificationError,
  normalizePrincipalContainerGrants,
  normalizePrincipalProjectionMembers,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { canonicalKeyingJsonString } from "../keyingCanonicalJson";
import { assertCurrentMatchesVerifiedPolicy } from "./verifiedPrincipalPolicyCurrent";

export async function assertBundleMatchesVerifiedPolicy(input: {
  bundle: PrincipalPolicyBundleResponse;
  policy: VerifiedPrincipalPolicy;
}): Promise<void> {
  const { bundle, policy } = input;
  const history = policy.history ?? [];
  const expectedChain = [
    ...bundle.previousStates,
    {
      state: bundle.currentState,
      projection: bundle.currentProjection,
      grants: bundle.currentGrants,
    },
  ].map((entry) => ({
    ...entry,
    projection: normalizePrincipalProjectionMembers(entry.projection),
    grants: normalizePrincipalContainerGrants(entry.grants),
  }));
  const verifiedHistory = history.map((entry) => ({
    ...entry,
    projection: normalizePrincipalProjectionMembers(entry.projection),
    grants: normalizePrincipalContainerGrants(entry.grants),
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
    throw new KeyingVerificationError(
      "equivocation",
      "Verified principal policy bundle history mismatch",
    );
  }
  await assertCurrentMatchesVerifiedPolicy({
    current: input.bundle,
    policy: input.policy,
  });
}
