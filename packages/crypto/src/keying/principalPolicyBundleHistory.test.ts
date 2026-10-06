import { expect, test } from "bun:test";
import { verifyPrincipalPolicyBundleAgainstHistory } from "./principalPolicyBundleHistory";
import { appendPrincipalHistoryIndex } from "./principalPolicyHistoryIndex";
import { indexedHistoryFixture } from "./principalPolicyHistoryReferenceTestFixtures";
import { historyHead } from "./principalPolicyHistoryTestFixtures";
import { signPolicyState } from "./principalPolicyTestFixtures";

async function fixture() {
  const indexed = await indexedHistoryFixture();
  const last = indexed.third;
  const bundle = {
    currentState: last.state,
    currentProjection: last.entry.projection,
    currentGrants: last.entry.grants,
    currentPayload: last.payload,
    currentMemberEnvelopes: {
      principalType: last.state.principalType,
      principalId: last.state.principalId,
      stateHash: last.state.stateHash,
      epoch: last.state.keyEpoch,
      envelopes: last.memberEnvelopes,
    },
    previousStates: [indexed.first.entry, indexed.second.entry],
  };
  return { ...indexed, bundle };
}

test("complete bundle verification connects every entry to resumed history", async () => {
  const { bundle, history } = await fixture();
  const result = await verifyPrincipalPolicyBundleAgainstHistory({
    bundle,
    history,
  });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.history?.map((entry) => entry.state.version)).toEqual([
      1, 2, 3,
    ]);
    expect("retainedHistory" in result.value).toBe(false);
  }
});

test("a complete bundle cannot replace signature, projection or grant commitments", async () => {
  const input = await fixture();
  const first = input.first.entry;
  for (const replacement of [
    {
      ...first,
      state: { ...first.state, signature: input.third.state.signature },
    },
    { ...first, projection: [{ userId: "intruder", role: "admin" as const }] },
    {
      ...first,
      grants: [
        { containerId: "substituted-container", accessLevel: "admin" as const },
      ],
    },
  ]) {
    const result = await verifyPrincipalPolicyBundleAgainstHistory({
      history: input.history,
      bundle: {
        ...input.bundle,
        previousStates: [replacement, input.second.entry],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("hash_mismatch");
  }
});

test("a complete bundle rejects missing, repeated and reordered entries", async () => {
  const input = await fixture();
  for (const previousStates of [
    [input.first.entry],
    [input.first.entry, input.first.entry],
    [input.second.entry, input.first.entry],
  ]) {
    expect(
      (
        await verifyPrincipalPolicyBundleAgainstHistory({
          history: input.history,
          bundle: { ...input.bundle, previousStates },
        })
      ).ok,
    ).toBe(false);
  }
});

test("the public root cannot authorize a substituted older signature", async () => {
  const input = await fixture();
  input.bundle.previousStates[0] = {
    ...input.first.entry,
    state: { ...input.first.state, signature: input.third.state.signature },
  };
  const changed = await appendPrincipalHistoryIndex(
    [],
    [
      ...input.bundle.previousStates.map((entry) => entry.state),
      input.third.state,
    ],
  );
  Object.assign(input.history, { indexRootHash: changed.rootHash });
  expect((await verifyPrincipalPolicyBundleAgainstHistory(input)).ok).toBe(
    false,
  );
});

test("bundle verification owns the returned history before yielding", async () => {
  const input = await fixture();
  const original = input.first.state.signature;
  const pending = verifyPrincipalPolicyBundleAgainstHistory(input);
  Object.assign(input.bundle.previousStates[0]?.state ?? {}, {
    signature: input.third.state.signature,
  });
  const result = await pending;
  expect(result.ok).toBe(true);
  if (result.ok)
    expect(result.value.history?.[0]?.state.signature).toBe(original);
});

test("complete bundle hashing continues across index batches", async () => {
  const input = await fixture();
  const entries = [input.first.entry, input.second.entry, input.third.entry];
  let last = input.third;
  for (let version = 4; version <= 129; version += 1) {
    last = await signPolicyState({
      ...input.shared,
      version,
      signedAt: new Date(Date.UTC(2026, 8, 12) + version * 1000).toISOString(),
      prevStateHash: last.state.stateHash,
    });
    entries.push(last.entry);
  }
  const verifier = input.create();
  for (let offset = 0; offset < entries.length; offset += 64) {
    const result = await verifier.append({
      entries: entries.slice(offset, offset + 64),
      signerPublicKeys: [input.signer],
    });
    if (!result.ok) throw result.error;
  }
  const history = verifier.finish(historyHead(last.state));
  if (!history.ok) throw history.error;
  const result = await verifyPrincipalPolicyBundleAgainstHistory({
    history: history.value,
    bundle: {
      ...input.bundle,
      currentState: last.state,
      currentProjection: last.entry.projection,
      currentGrants: last.entry.grants,
      currentPayload: last.payload,
      currentMemberEnvelopes: {
        ...input.bundle.currentMemberEnvelopes,
        stateHash: last.state.stateHash,
        envelopes: last.memberEnvelopes,
      },
      previousStates: entries.slice(0, -1),
    },
  });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.history).toHaveLength(129);
}, 20_000);
