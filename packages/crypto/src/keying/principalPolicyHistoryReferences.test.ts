import { beforeAll, expect, test } from "bun:test";
import { createPrincipalPolicyHistoryVerifier } from "./principalPolicyHistory";
import {
  appendPrincipalHistoryIndex,
  createPrincipalHistoryIndexProof,
} from "./principalPolicyHistoryIndex";
import { verifyPrincipalPolicyHistoryReferences } from "./principalPolicyHistoryReferences";
import { indexedHistoryFixture } from "./principalPolicyHistoryReferenceTestFixtures";
import { historyHead } from "./principalPolicyHistoryTestFixtures";
import {
  expectVerificationError,
  signPolicyState,
} from "./principalPolicyTestFixtures";

let fixture: Awaited<ReturnType<typeof indexedHistoryFixture>>;
beforeAll(async () => {
  fixture = await indexedHistoryFixture();
});

test("new retained references reuse a verified and restarted prefix", async () => {
  const first = await fixture.reference(fixture.first.entry);
  const second = await fixture.reference(fixture.second.entry);
  expect(
    fixture.history.retainedEntries.map((entry) => entry.state.version),
  ).toEqual([3]);
  const result = await verifyPrincipalPolicyHistoryReferences({
    history: fixture.history,
    references: [first],
  });
  if (!result.ok) throw result.error;
  expect(
    result.value.retainedEntries.map((entry) => entry.state.version),
  ).toEqual([1, 3]);
  const replaced = await verifyPrincipalPolicyHistoryReferences({
    history: result.value,
    references: [second],
  });
  if (!replaced.ok) throw replaced.error;
  expect(
    replaced.value.retainedEntries.map((entry) => entry.state.version),
  ).toEqual([2, 3]);
  expect(replaced.value.indexRootHash).toBe(fixture.history.indexRootHash);
});

test("an independently valid fork cannot be attached to a different prefix", async () => {
  const alternate = await signPolicyState({
    ...fixture.shared,
    version: 2,
    prevStateHash: fixture.first.state.stateHash,
    signedAt: "2026-01-02T00:00:00.000Z",
  });
  const verifier = createPrincipalPolicyHistoryVerifier({
    principalId: fixture.shared.principalId,
    principalType: "group",
  });
  const successor = await signPolicyState({
    ...fixture.shared,
    version: 3,
    prevStateHash: alternate.state.stateHash,
    signedAt: "2026-01-03T00:00:00.000Z",
  });
  const append = await verifier.append({
    entries: [fixture.first.entry, alternate.entry, successor.entry],
    signerPublicKeys: [fixture.signer],
  });
  if (!append.ok) throw append.error;
  const fork = verifier.finish(historyHead(successor.state));
  if (!fork.ok) throw fork.error;
  const nodes = new Map(
    append.value.indexNodes.map((node) => [node.hash, node]),
  );
  const reference = {
    reference: historyHead(alternate.state),
    entry: alternate.entry,
    proof: await createPrincipalHistoryIndexProof({
      rootHash: fork.value.indexRootHash,
      treeSize: 3,
      version: 2,
      readNode: async (hash) => nodes.get(hash) ?? null,
    }),
  };
  expect(
    (
      await verifyPrincipalPolicyHistoryReferences({
        history: fork.value,
        references: [reference],
      })
    ).ok,
  ).toBe(true);
  expectVerificationError(
    await verifyPrincipalPolicyHistoryReferences({
      history: fixture.history,
      references: [reference],
    }),
    "hash_mismatch",
  );
});

test("proofs bind signature bytes as well as the unsigned state hash", async () => {
  const original = await fixture.reference(fixture.first.entry);
  const reference = {
    ...original,
    entry: {
      ...original.entry,
      state: {
        ...original.entry.state,
        signature: fixture.second.state.signature,
      },
    },
  };
  expect(reference.entry.state.stateHash).toBe(original.entry.state.stateHash);
  expectVerificationError(
    await verifyPrincipalPolicyHistoryReferences({
      history: fixture.history,
      references: [reference],
    }),
    "hash_mismatch",
  );
});

test("proof membership does not substitute for projection and grant commitments", async () => {
  const original = await fixture.reference(fixture.first.entry);
  const variants = [
    {
      ...original.entry,
      projection: [{ userId: fixture.signer.userId, role: "member" as const }],
    },
    {
      ...original.entry,
      grants: [
        { containerId: "extra-container", accessLevel: "read" as const },
      ],
    },
  ];
  for (const entry of variants)
    expectVerificationError(
      await verifyPrincipalPolicyHistoryReferences({
        history: fixture.history,
        references: [{ ...original, entry }],
      }),
      "hash_mismatch",
    );
});

test("a caller cannot replace the private verified root with its own tree", async () => {
  const original = await fixture.reference(fixture.first.entry);
  const forged = {
    ...fixture.first.state,
    signature: fixture.second.state.signature,
  };
  const index = await appendPrincipalHistoryIndex(
    [],
    [forged, fixture.second.state, fixture.third.state],
  );
  if (!index.rootHash) throw new Error("expected root");
  const nodes = new Map(index.nodes.map((node) => [node.hash, node]));
  const proof = await createPrincipalHistoryIndexProof({
    rootHash: index.rootHash,
    treeSize: 3,
    version: 1,
    readNode: async (hash) => nodes.get(hash) ?? null,
  });
  const finished = fixture.verifier.finish(historyHead(fixture.third.state));
  if (!finished.ok) throw finished.error;
  Object.assign(finished.value, { indexRootHash: index.rootHash });
  expectVerificationError(
    await verifyPrincipalPolicyHistoryReferences({
      history: finished.value,
      references: [
        { ...original, proof, entry: { ...original.entry, state: forged } },
      ],
    }),
    "hash_mismatch",
  );
  expectVerificationError(
    await verifyPrincipalPolicyHistoryReferences({
      history: { ...finished.value },
      references: [original],
    }),
    "invalid_shape",
  );
});

test("proofs bind position, tree size, scope and every requested head field", async () => {
  const original = await fixture.reference(fixture.first.entry);
  for (const reference of [
    { ...original, proof: { ...original.proof, leafIndex: 1 } },
    { ...original, proof: { ...original.proof, treeSize: 2 } },
    { ...original, reference: { ...original.reference, keyEpoch: 2 } },
    {
      ...original,
      reference: { ...original.reference, principalId: "foreign" },
    },
    { ...original, reference: { ...original.reference, version: 4 } },
  ])
    expectVerificationError(
      await verifyPrincipalPolicyHistoryReferences({
        history: fixture.history,
        references: [reference],
      }),
      "object_mismatch",
    );
});

test("selection rejects duplicates and bounds proof arrays before copying", async () => {
  const original = await fixture.reference(fixture.first.entry);
  expectVerificationError(
    await verifyPrincipalPolicyHistoryReferences({
      history: fixture.history,
      references: [original, original],
    }),
    "duplicate_entry",
  );
  for (const references of [
    Array(129).fill(original),
    [
      {
        ...original,
        proof: { ...original.proof, auditPath: Array(54).fill("0".repeat(64)) },
      },
    ],
  ])
    expectVerificationError(
      await verifyPrincipalPolicyHistoryReferences({
        history: fixture.history,
        references,
      }),
      "invalid_shape",
    );
});

test("reference bytes are owned before asynchronous hashing", async () => {
  const original = structuredClone(
    await fixture.reference(fixture.first.entry),
  );
  const pending = verifyPrincipalPolicyHistoryReferences({
    history: fixture.history,
    references: [original],
  });
  Object.assign(original.entry, {
    state: {
      ...original.entry.state,
      signature: fixture.second.state.signature,
    },
  });
  original.proof = { ...original.proof, auditPath: [] };
  const result = await pending;
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  expect(result.value.retainedEntries[0]?.state.signature).toBe(
    fixture.first.state.signature,
  );
});

test("a rejected page cannot publish index leaves before a correct retry", async () => {
  const verifier = createPrincipalPolicyHistoryVerifier({
    principalId: fixture.shared.principalId,
    principalType: "group",
  });
  expectVerificationError(
    await verifier.append({
      entries: [
        fixture.first.entry,
        {
          ...fixture.second.entry,
          state: {
            ...fixture.second.state,
            signature: fixture.first.state.signature,
          },
        },
      ],
      signerPublicKeys: [fixture.signer],
    }),
    "signature_mismatch",
  );
  expect(
    (
      await verifier.append({
        entries: [
          fixture.first.entry,
          fixture.second.entry,
          fixture.third.entry,
        ],
        signerPublicKeys: [fixture.signer],
      })
    ).ok,
  ).toBe(true);
  const finished = verifier.finish(historyHead(fixture.third.state));
  if (!finished.ok) throw finished.error;
  expect(finished.value.indexRootHash).toBe(fixture.history.indexRootHash);
});
