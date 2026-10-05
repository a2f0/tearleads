import { expect, test } from "bun:test";
import {
  grantAccessLevelForUser,
  principalPolicyMatchesReference,
} from "./containerPathAccess";
import { verifyPrincipalPolicyCurrent } from "./principalPolicyCurrent";
import { createPrincipalPolicyHistoryVerifier } from "./principalPolicyHistory";
import { historyHead } from "./principalPolicyHistoryTestFixtures";
import {
  createPolicySigner,
  signPolicyState,
} from "./principalPolicyTestFixtures";
import type { KeyingVerificationResult } from "./types";

function accepted<T>(result: KeyingVerificationResult<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

test("retained citations authorize exact historical membership while current access honors revocation", async () => {
  const signer = await createPolicySigner();
  const shared = { signer, principalId: "retained-authorization" };
  const first = await signPolicyState({
    ...shared,
    version: 1,
    prevStateHash: null,
    members: [{ userId: signer.userId }, { userId: "removed-user" }],
  });
  const second = await signPolicyState({
    ...shared,
    version: 2,
    keyEpoch: 2,
    prevStateHash: first.state.stateHash,
    members: [{ userId: signer.userId }, { userId: "removed-user" }],
  });
  const third = await signPolicyState({
    ...shared,
    version: 3,
    prevStateHash: second.state.stateHash,
    keyEpoch: 3,
    members: [{ userId: signer.userId }],
  });
  const reference = {
    ...historyHead(second.state),
    principalType: "group" as const,
  };
  const verifier = createPrincipalPolicyHistoryVerifier({
    principalType: "group",
    principalId: shared.principalId,
    retainedReferences: [reference],
  });
  accepted(
    await verifier.append({
      entries: [first.entry, second.entry, third.entry],
      signerPublicKeys: [signer],
    }),
  );
  const policy = accepted(
    await verifyPrincipalPolicyCurrent({
      history: accepted(verifier.finish(historyHead(third.state))),
      current: {
        currentState: third.state,
        currentProjection: third.entry.projection,
        currentGrants: third.entry.grants,
        currentPayload: third.payload,
        currentMemberEnvelopes: {
          principalType: "group",
          principalId: shared.principalId,
          stateHash: third.state.stateHash,
          epoch: third.state.keyEpoch,
          envelopes: third.memberEnvelopes,
        },
      },
    }),
  );
  const input = {
    grant: {
      subjectType: "group" as const,
      subjectId: shared.principalId,
      accessLevel: "read" as const,
    },
    principalPolicies: [policy],
    userId: "removed-user",
    state: { referencedPrincipalHeads: [reference] },
  };
  expect(policy.retainedHistory.map(({ state }) => state.version)).toEqual([
    2, 3,
  ]);
  expect(
    grantAccessLevelForUser({ ...input, membershipAt: "referenced" }),
  ).toBe("read");
  expect(
    grantAccessLevelForUser({ ...input, membershipAt: "current" }),
  ).toBeNull();
  for (const missing of [
    historyHead(first.state),
    { ...reference, stateHash: first.state.stateHash },
    { ...reference, keyEpoch: reference.keyEpoch + 1 },
    { ...reference, keyFingerprint: "unrelated" },
    { ...reference, principalId: "another-principal" },
    { ...reference, principalType: "organization" as const },
  ]) {
    expect(
      principalPolicyMatchesReference({ policy, reference: missing }),
    ).toBe(false);
  }
});
