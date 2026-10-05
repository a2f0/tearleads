import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "../encapsulation/generateKeyPair";
import {
  type VerifiedPrincipalPolicyCurrent,
  verifyPrincipalPolicyCurrent,
} from "./principalPolicyCurrent";
import { createPrincipalPolicyHistoryVerifier } from "./principalPolicyHistory";
import { historyHead } from "./principalPolicyHistoryTestFixtures";
import {
  createPolicySigner,
  signPolicyState,
} from "./principalPolicyTestFixtures";
import type {
  AnyVerifiedPrincipalPolicy,
  KeyingVerificationResult,
} from "./types";

// A compile-time regression without suppressing the expected type error.
const assignableToFullPolicy: VerifiedPrincipalPolicyCurrent extends AnyVerifiedPrincipalPolicy
  ? true
  : false = false;

function accepted<T>(result: KeyingVerificationResult<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

async function fixture() {
  const signer = await createPolicySigner();
  const shared = {
    signer,
    principalId: "reserved-admins",
    principalKeyPair: generateKemSeedAndKeyPair(),
    members: [{ userId: signer.userId }, { userId: "ordinary-member" }],
  };
  const first = await signPolicyState({
    ...shared,
    version: 1,
    prevStateHash: null,
  });
  const second = await signPolicyState({
    ...shared,
    version: 2,
    prevStateHash: first.state.stateHash,
    projection: shared.members.map(({ userId }) => ({
      userId,
      role: "admin" as const,
    })),
  });
  const verifier = createPrincipalPolicyHistoryVerifier({
    principalType: "group",
    principalId: shared.principalId,
  });
  accepted(
    await verifier.append({
      entries: [first.entry, second.entry],
      signerPublicKeys: [signer],
    }),
  );
  return {
    first,
    history: accepted(verifier.finish(historyHead(second.state))),
    current: {
      currentState: second.state,
      currentProjection: second.entry.projection,
      currentGrants: second.entry.grants,
      currentPayload: second.payload,
      currentMemberEnvelopes: {
        principalType: "group" as const,
        principalId: shared.principalId,
        stateHash: second.state.stateHash,
        epoch: second.state.keyEpoch,
        envelopes: second.memberEnvelopes,
      },
    },
  };
}

test("a current-only all-admin projection is not exposed as complete history", async () => {
  expect(assignableToFullPolicy).toBe(false);
  const input = await fixture();
  const policy = accepted(await verifyPrincipalPolicyCurrent(input));
  expect(
    input.first.entry.projection.some((member) => member.role === "member"),
  ).toBe(true);
  expect(input.history.retainedEntries).toHaveLength(1);
  expect(policy.projection.every((member) => member.role === "admin")).toBe(
    true,
  );
  // Full-history consumers inspect `history` for an all-admin invariant.
  // Publishing the retained subset there would hide the genesis member.
  expect("history" in policy).toBe(false);
});

test("a serialized history result is not a local verification capability", async () => {
  const input = await fixture();
  const result = await verifyPrincipalPolicyCurrent({
    ...input,
    history: structuredClone(input.history),
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("invalid_shape");
});

test("changing a returned history cannot substitute another current policy", async () => {
  const input = await fixture();
  const other = await fixture();
  Object.assign(input.history, structuredClone(other.history));
  const result = await verifyPrincipalPolicyCurrent({
    current: other.current,
    history: input.history,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("hash_mismatch");
});
