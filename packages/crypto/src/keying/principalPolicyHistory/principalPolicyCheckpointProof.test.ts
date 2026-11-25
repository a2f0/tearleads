import { beforeAll, expect, test } from "bun:test";
import { verifyPrincipalPolicyHistoryReferences } from "./principalPolicyHistoryReferences";
import { indexedHistoryFixture } from "./principalPolicyHistoryReferenceTestFixtures";

let fixture: Awaited<ReturnType<typeof indexedHistoryFixture>>;
beforeAll(async () => {
  fixture = await indexedHistoryFixture();
});

test("proof selection retains a separately authenticated checkpoint", async () => {
  const input = {
    history: fixture.history,
    references: [await fixture.reference(fixture.first.entry)],
    checkpointReference: await fixture.reference(fixture.second.entry),
  };
  const result = await verifyPrincipalPolicyHistoryReferences(input);
  if (!result.ok) throw result.error;
  expect(
    result.value.retainedEntries.map(({ state }) => state.version),
  ).toEqual([1, 2, 3]);
});

test("checkpoint proof must belong to the locally verified root", async () => {
  const checkpoint = await fixture.reference(fixture.second.entry);
  const input = {
    history: fixture.history,
    references: [],
    checkpointReference: {
      ...checkpoint,
      entry: {
        ...checkpoint.entry,
        state: {
          ...checkpoint.entry.state,
          signature: fixture.first.state.signature,
        },
      },
    },
  };
  const result = await verifyPrincipalPolicyHistoryReferences(input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("hash_mismatch");
});

test("checkpoint proofs cannot exceed the per-proof path budget", async () => {
  const checkpoint = await fixture.reference(fixture.second.entry);
  const input = {
    history: fixture.history,
    references: [],
    checkpointReference: {
      ...checkpoint,
      proof: { ...checkpoint.proof, auditPath: Array(54).fill("0".repeat(64)) },
    },
  };
  const result = await verifyPrincipalPolicyHistoryReferences(input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("invalid_shape");
});
