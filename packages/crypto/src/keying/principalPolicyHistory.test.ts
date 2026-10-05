import { expect, test } from "bun:test";
import { createPrincipalPolicyHistoryVerifier } from "./principalPolicyHistory";
import {
  historyFixture,
  historyHead,
} from "./principalPolicyHistoryTestFixtures";
import { PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT } from "./principalPolicyHistoryTypes";
import {
  expectVerificationError,
  signPolicyState,
} from "./principalPolicyTestFixtures";

test("paged verification keeps only requested historical entries and the exact head", async () => {
  const { shared, signer, first, second, third } = await historyFixture();
  const verifier = createPrincipalPolicyHistoryVerifier({
    principalId: shared.principalId,
    principalType: "group",
    retainedReferences: [historyHead(first.state)],
    localCheckpoint: {
      principalId: shared.principalId,
      principalType: "group",
      version: 2,
      stateHash: second.state.stateHash,
    },
  });
  expect(
    (
      await verifier.append({
        entries: [first.entry, second.entry],
        signerPublicKeys: [signer],
      })
    ).ok,
  ).toBe(true);
  expectVerificationError(
    verifier.finish(historyHead(third.state)),
    "missing_dependency",
  );
  expect(
    (
      await verifier.append({
        entries: [third.entry],
        signerPublicKeys: [signer],
      })
    ).ok,
  ).toBe(true);
  const result = verifier.finish(historyHead(third.state));
  if (!result.ok) throw result.error;
  expect(
    result.value.retainedEntries.map((entry) => entry.state.version),
  ).toEqual([1, 3]);
  expect(result.value.currentEntry).toEqual({
    ...third.entry,
    projection: [...third.entry.projection],
    grants: [...third.entry.grants],
  });
  expect(result.value.checkpoint.stateHash).toBe(third.state.stateHash);
  expectVerificationError(
    verifier.finish({ ...historyHead(third.state), keyEpoch: 2 }),
    "missing_dependency",
  );
});

test("a forged final signature cannot publish any part of its page", async () => {
  const { create, signer, first, second, third } = await historyFixture();
  const verifier = create();
  expect(
    (
      await verifier.append({
        entries: [first.entry],
        signerPublicKeys: [signer],
      })
    ).ok,
  ).toBe(true);
  const forged = {
    ...third.entry,
    state: { ...third.state, signature: first.state.signature },
  };
  expectVerificationError(
    await verifier.append({
      entries: [second.entry, forged],
      signerPublicKeys: [signer],
    }),
    "signature_mismatch",
  );
  expect(verifier.finish(historyHead(first.state)).ok).toBe(true);
  expectVerificationError(
    verifier.finish(historyHead(second.state)),
    "missing_dependency",
  );
  expect(
    (
      await verifier.append({
        entries: [second.entry, third.entry],
        signerPublicKeys: [signer],
      })
    ).ok,
  ).toBe(true);
  expect(verifier.finish(historyHead(third.state)).ok).toBe(true);
});

test("page boundaries reject skipped, replayed, and forked predecessors", async () => {
  const { create, shared, signer, first, second, third } =
    await historyFixture();
  const verifier = create();
  expectVerificationError(
    await verifier.append({
      entries: [second.entry],
      signerPublicKeys: [signer],
    }),
    "stale_predecessor",
  );
  expect(
    (
      await verifier.append({
        entries: [first.entry],
        signerPublicKeys: [signer],
      })
    ).ok,
  ).toBe(true);
  for (const entry of [first.entry, third.entry])
    expectVerificationError(
      await verifier.append({ entries: [entry], signerPublicKeys: [signer] }),
      "stale_predecessor",
    );
  const forked = await signPolicyState({
    ...shared,
    version: 2,
    prevStateHash: "a".repeat(64),
  });
  expectVerificationError(
    await verifier.append({
      entries: [forked.entry],
      signerPublicKeys: [signer],
    }),
    "stale_predecessor",
  );
  expect(
    (
      await verifier.append({
        entries: [second.entry],
        signerPublicKeys: [signer],
      })
    ).ok,
  ).toBe(true);
});

test("owned page bytes and returned snapshots cannot alter verified progress", async () => {
  const { create, signer, first, second } = await historyFixture();
  const verifier = create();
  const entry = structuredClone({ ...first.entry, state: { ...first.state } });
  const key = structuredClone(signer);
  const appending = verifier.append({
    entries: [entry],
    signerPublicKeys: [key],
  });
  entry.state.stateHash = "a".repeat(64);
  key.signingPublicKey.fill(0);
  expectVerificationError(
    await verifier.append({
      entries: [first.entry],
      signerPublicKeys: [signer],
    }),
    "invalid_shape",
  );
  expectVerificationError(
    verifier.finish(historyHead(first.state)),
    "invalid_shape",
  );
  expect((await appending).ok).toBe(true);
  const result = verifier.finish(historyHead(first.state));
  if (!result.ok) throw result.error;
  // Mutate the returned projection array through a mutable copy of its type.
  const projection = result.value.currentEntry.projection as {
    userId: string;
    role: "admin" | "member";
  }[];
  projection.splice(0);
  expect(
    (
      await verifier.append({
        entries: [second.entry],
        signerPublicKeys: [signer],
      })
    ).ok,
  ).toBe(true);
});

test("per-page entry budgets reject overload without imposing a lifetime cutoff", async () => {
  const { create, signer, first } = await historyFixture();
  const verifier = create();
  for (const entries of [
    [],
    Array(PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT + 1).fill(first.entry),
  ])
    expectVerificationError(
      await verifier.append({ entries, signerPublicKeys: [signer] }),
      "invalid_shape",
    );
  expect(
    (
      await verifier.append({
        entries: [first.entry],
        signerPublicKeys: [signer],
      })
    ).ok,
  ).toBe(true);
});

test("paged verification preserves rollback checks against a newer checkpoint", async () => {
  const { shared, signer, first, second } = await historyFixture();
  const verifier = createPrincipalPolicyHistoryVerifier({
    principalId: shared.principalId,
    principalType: "group",
    localCheckpoint: {
      principalId: shared.principalId,
      principalType: "group",
      version: 3,
      stateHash: "a".repeat(64),
    },
  });
  expect(
    (
      await verifier.append({
        entries: [first.entry, second.entry],
        signerPublicKeys: [signer],
      })
    ).ok,
  ).toBe(true);
  expectVerificationError(
    verifier.finish(historyHead(second.state)),
    "rollback",
  );
});

test("a checkpoint conflict rejects the page immediately and permits the correct retry", async () => {
  const { shared, signer, first, second, third } = await historyFixture();
  const alternate = await signPolicyState({
    ...shared,
    version: 2,
    prevStateHash: first.state.stateHash,
    signedAt: "2026-01-02T00:00:00.000Z",
  });
  const verifier = createPrincipalPolicyHistoryVerifier({
    principalId: shared.principalId,
    principalType: "group",
    localCheckpoint: {
      principalId: shared.principalId,
      principalType: "group",
      version: 2,
      stateHash: alternate.state.stateHash,
    },
  });
  expect(
    (
      await verifier.append({
        entries: [first.entry],
        signerPublicKeys: [signer],
      })
    ).ok,
  ).toBe(true);
  expectVerificationError(
    await verifier.append({
      entries: [second.entry, third.entry],
      signerPublicKeys: [signer],
    }),
    "equivocation",
  );
  expect(
    (
      await verifier.append({
        entries: [alternate.entry],
        signerPublicKeys: [signer],
      })
    ).ok,
  ).toBe(true);
  expect(verifier.finish(historyHead(alternate.state)).ok).toBe(true);
});

test("a local checkpoint cannot replace an omitted verified prefix", async () => {
  const { shared, signer, first, second } = await historyFixture();
  const verifier = createPrincipalPolicyHistoryVerifier({
    principalId: shared.principalId,
    principalType: "group",
    localCheckpoint: {
      principalId: shared.principalId,
      principalType: "group",
      version: 1,
      stateHash: first.state.stateHash,
    },
  });
  expectVerificationError(
    await verifier.append({
      entries: [second.entry],
      signerPublicKeys: [signer],
    }),
    "stale_predecessor",
  );
  expect(
    (
      await verifier.append({
        entries: [first.entry, second.entry],
        signerPublicKeys: [signer],
      })
    ).ok,
  ).toBe(true);
  expect(verifier.finish(historyHead(second.state)).ok).toBe(true);
});

test("a requested historical reference must match all authenticated head fields", async () => {
  const { shared, signer, first } = await historyFixture();
  const verifier = createPrincipalPolicyHistoryVerifier({
    principalId: shared.principalId,
    principalType: "group",
    retainedReferences: [
      { ...historyHead(first.state), keyFingerprint: "a".repeat(64) },
    ],
  });
  expectVerificationError(
    await verifier.append({
      entries: [first.entry],
      signerPublicKeys: [signer],
    }),
    "hash_mismatch",
  );
  expectVerificationError(
    verifier.finish(historyHead(first.state)),
    "missing_dependency",
  );
});
