import { expect, test } from "bun:test";
import {
  createPrincipalPolicyHistoryVerifier,
  restorePrincipalPolicyHistoryVerifier,
} from "./principalPolicyHistory";
import {
  createPolicySigner,
  policyMember,
  signPolicyState,
} from "./principalPolicyTestFixtures";
import type { KeyingVerificationResult } from "./verificationError";

function accepted<T>(result: KeyingVerificationResult<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

test("the last accepted projection is an owned copy that survives sealed progress", async () => {
  const signer = await createPolicySigner();
  const first = await signPolicyState({
    signer,
    principalId: "boundary-policy",
    members: [{ userId: signer.userId }, { userId: "member" }],
    projection: [
      policyMember(signer, "admin"),
      policyMember(await createPolicySigner("member")),
    ],
    version: 1,
    prevStateHash: null,
  });
  const input = {
    principalType: "group" as const,
    principalId: first.state.principalId,
  };
  const verifier = createPrincipalPolicyHistoryVerifier(input);
  expect(verifier.getLatestAcceptedProjection()).toBeNull();
  accepted(
    await verifier.append({
      entries: [first.entry],
      signerPublicKeys: [signer],
    }),
  );
  // The verifier keeps its normalized, canonically ordered projection.
  const byUser = (
    left: { readonly userId: string },
    right: { readonly userId: string },
  ) => (left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0);
  const expected = {
    version: 1,
    stateHash: first.state.stateHash,
    projection: [...first.entry.projection].sort(byUser),
  };
  const latest = verifier.getLatestAcceptedProjection();
  expect(latest).toEqual(expected);
  latest?.projection.splice(0);
  expect(verifier.getLatestAcceptedProjection()).toEqual(expected);
  const protection = {
    localKey: crypto.getRandomValues(new Uint8Array(32)),
    context: "boundary-projection",
  };
  const restored = accepted(
    await restorePrincipalPolicyHistoryVerifier(
      input,
      accepted(await verifier.exportProgress(protection)),
      protection,
    ),
  );
  expect(restored.getLatestAcceptedProjection()).toEqual(expected);
});
