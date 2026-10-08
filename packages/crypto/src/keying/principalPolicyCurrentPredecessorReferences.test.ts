import { expect, test } from "bun:test";
import { grantAccessLevelForUser } from "./containerPathAccess";
import { verifyPrincipalPolicyCurrent } from "./principalPolicyCurrent";
import { selectPrincipalPolicyCurrentPredecessorReferences } from "./principalPolicyCurrentPredecessorReferences";
import { verifyPrincipalPolicyCurrentSuccessor } from "./principalPolicyCurrentSuccessor";
import { createPrincipalPolicyHistoryVerifier } from "./principalPolicyHistory";
import { historyHead } from "./principalPolicyHistoryTestFixtures";
import {
  createBundle,
  createPolicySigner,
  expectVerificationError,
  signPolicyState,
} from "./principalPolicyTestFixtures";
import type { KeyingVerificationResult } from "./types";

function accepted<T>(result: KeyingVerificationResult<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

async function fixture() {
  const signer = await createPolicySigner();
  const shared = { signer, principalId: "selected-predecessor" };
  const members = [{ userId: signer.userId }, { userId: "removed-user" }];
  const first = await signPolicyState({
    ...shared,
    members,
    version: 1,
    prevStateHash: null,
  });
  const second = await signPolicyState({
    ...shared,
    members,
    version: 2,
    keyEpoch: 2,
    prevStateHash: first.state.stateHash,
  });
  const third = await signPolicyState({
    ...shared,
    members: [{ userId: signer.userId }],
    version: 3,
    keyEpoch: 3,
    prevStateHash: second.state.stateHash,
  });
  const reference = {
    ...historyHead(first.state),
    principalType: "group" as const,
  };
  const verifier = createPrincipalPolicyHistoryVerifier({
    principalId: shared.principalId,
    principalType: "group",
    retainedReferences: [reference],
  });
  accepted(
    await verifier.append({
      entries: [first.entry, second.entry],
      signerPublicKeys: [signer],
    }),
  );
  const predecessor = accepted(
    await verifyPrincipalPolicyCurrent({
      history: accepted(verifier.finish(historyHead(second.state))),
      current: createBundle({ current: second }),
    }),
  );
  const current = accepted(
    await verifyPrincipalPolicyCurrentSuccessor({
      previous: predecessor,
      current: createBundle({ current: third }),
      signerPublicKeys: [signer],
    }),
  );
  return {
    shared,
    signer,
    first,
    second,
    third,
    reference,
    predecessor,
    current,
  };
}

test("selected old citations preserve successor membership and bounded selection", async () => {
  const f = await fixture();
  const selected = accepted(
    selectPrincipalPolicyCurrentPredecessorReferences({
      ...f,
      references: [f.reference],
    }),
  );
  expect(selected.retainedHistory.map(({ state }) => state.version)).toEqual([
    1, 2, 3,
  ]);
  const access = {
    grant: {
      subjectType: "group" as const,
      subjectId: f.shared.principalId,
      accessLevel: "read" as const,
    },
    principalPolicies: [selected],
    userId: "removed-user",
    state: { referencedPrincipalHeads: [f.reference] },
  };
  expect(
    grantAccessLevelForUser({ ...access, membershipAt: "referenced" }),
  ).toBe("read");
  expect(
    grantAccessLevelForUser({ ...access, membershipAt: "current" }),
  ).toBeNull();
  expect(selected.checkpoint).toEqual(f.current.checkpoint);
  const cleared = accepted(
    selectPrincipalPolicyCurrentPredecessorReferences({
      ...f,
      current: selected,
      references: [],
    }),
  );
  expect(cleared.retainedHistory.map(({ state }) => state.version)).toEqual([
    2, 3,
  ]);
  const fourth = await signPolicyState({
    ...f.shared,
    members: [{ userId: f.signer.userId }],
    version: 4,
    keyEpoch: 4,
    prevStateHash: selected.stateHash,
  });
  expect(
    accepted(
      await verifyPrincipalPolicyCurrentSuccessor({
        previous: selected,
        current: createBundle({ current: fourth }),
        signerPublicKeys: [f.signer],
      }),
    ).version,
  ).toBe(4);
});

test("selection requires private evidence and ignores mutated public artifacts", async () => {
  const f = await fixture();
  for (const field of ["current", "predecessor"] as const) {
    expectVerificationError(
      selectPrincipalPolicyCurrentPredecessorReferences({
        ...f,
        [field]: { ...f[field] },
        references: [f.reference],
      }),
      "invalid_shape",
    );
  }
  Reflect.set(
    f.predecessor.retainedHistory[0]?.state ?? {},
    "stateHash",
    "f".repeat(64),
  );
  Reflect.set(f.current, "projection", f.predecessor.projection);
  const selected = accepted(
    selectPrincipalPolicyCurrentPredecessorReferences({
      ...f,
      references: [f.reference],
    }),
  );
  expect(selected.retainedHistory[0]?.state.stateHash).toBe(
    f.reference.stateHash,
  );
  expect(
    selected.projection.some(({ userId }) => userId === "removed-user"),
  ).toBe(false);
  Reflect.set(
    selected.retainedHistory[0]?.state ?? {},
    "stateHash",
    "e".repeat(64),
  );
  expect(
    accepted(
      selectPrincipalPolicyCurrentPredecessorReferences({
        ...f,
        current: selected,
        references: [f.reference],
      }),
    ).retainedHistory[0]?.state.stateHash,
  ).toBe(f.reference.stateHash);
});

test("a privately verified fork is not the selected successor's predecessor", async () => {
  const f = await fixture();
  // Same principal and versions, but an independently signed chain.
  const fork = await fixture();
  expectVerificationError(
    selectPrincipalPolicyCurrentPredecessorReferences({
      current: f.current,
      predecessor: fork.predecessor,
      references: [fork.reference],
    }),
    "stale_predecessor",
  );
  expectVerificationError(
    selectPrincipalPolicyCurrentPredecessorReferences({
      current: f.current,
      predecessor: f.current,
      references: [],
    }),
    "stale_predecessor",
  );
});

test("selection rejects absent, substituted, foreign, duplicate and excessive references", async () => {
  const f = await fixture();
  for (const reference of [
    { ...f.reference, version: 4 },
    { ...f.reference, stateHash: "f".repeat(64) },
    { ...f.reference, keyEpoch: 9 },
    { ...f.reference, keyFingerprint: "e".repeat(64) },
  ])
    expectVerificationError(
      selectPrincipalPolicyCurrentPredecessorReferences({
        ...f,
        references: [reference],
      }),
      "missing_dependency",
    );
  for (const reference of [
    { ...f.reference, principalId: "another-group" },
    { ...f.reference, principalType: "organization" as const },
  ])
    expectVerificationError(
      selectPrincipalPolicyCurrentPredecessorReferences({
        ...f,
        references: [reference],
      }),
      "object_mismatch",
    );
  expectVerificationError(
    selectPrincipalPolicyCurrentPredecessorReferences({
      ...f,
      references: [f.reference, f.reference],
    }),
    "duplicate_entry",
  );
  expectVerificationError(
    selectPrincipalPolicyCurrentPredecessorReferences({
      ...f,
      references: Array.from({ length: 129 }, (_, index) => ({
        ...f.reference,
        version: index + 1,
      })),
    }),
    "invalid_shape",
  );
});
