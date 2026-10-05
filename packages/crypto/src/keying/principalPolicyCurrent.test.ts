import { expect, test } from "bun:test";
import { verifyPrincipalPolicyCheckpoint } from "./principalPolicy";
import { verifyPrincipalPolicyCurrent } from "./principalPolicyCurrent";
import {
  createPrincipalPolicyHistoryVerifier,
  restorePrincipalPolicyHistoryVerifier,
} from "./principalPolicyHistory";
import {
  historyFixture,
  historyHead,
} from "./principalPolicyHistoryTestFixtures";
import {
  createPolicySigner,
  signPolicyState,
} from "./principalPolicyTestFixtures";
import type { KeyingVerificationResult } from "./types";

function accepted<T>(result: KeyingVerificationResult<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

async function fixture() {
  const signer = await createPolicySigner();
  const first = await signPolicyState({
    signer,
    principalId: "managed-policy",
    members: [{ userId: signer.userId }, { userId: "member" }],
    grants: [{ containerId: "shared-container", accessLevel: "read" }],
    version: 1,
    prevStateHash: null,
  });
  const input = {
    principalType: "group" as const,
    principalId: first.state.principalId,
  };
  const verifier = createPrincipalPolicyHistoryVerifier(input);
  accepted(
    await verifier.append({
      entries: [first.entry],
      signerPublicKeys: [signer],
    }),
  );
  const protection = {
    localKey: crypto.getRandomValues(new Uint8Array(32)),
    context: "current-artifacts",
  };
  const saved = accepted(await verifier.exportProgress(protection));
  const restored = accepted(
    await restorePrincipalPolicyHistoryVerifier(input, saved, protection),
  );
  const history = accepted(restored.finish(historyHead(first.state)));
  const current = {
    currentState: first.state,
    currentProjection: first.entry.projection,
    currentGrants: first.entry.grants,
    currentPayload: first.payload,
    currentMemberEnvelopes: {
      ...input,
      stateHash: first.state.stateHash,
      epoch: first.state.keyEpoch,
      envelopes: first.memberEnvelopes,
    },
  };
  return { current, history };
}

test("current keying artifacts verify with resumed multi-member grant history", async () => {
  const input = await fixture();
  const policy = accepted(await verifyPrincipalPolicyCurrent(input));
  expect(policy.projection).toHaveLength(2);
  expect(policy.grants).toEqual([
    { containerId: "shared-container", accessLevel: "read" },
  ]);
  expect(policy.stateHash).toBe(input.current.currentState.stateHash);
});

test("a matching header hash cannot hide replaced signature bytes", async () => {
  const input = await fixture();
  const result = await verifyPrincipalPolicyCurrent({
    ...input,
    current: {
      ...input.current,
      currentState: { ...input.current.currentState, signature: "replaced" },
    },
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("hash_mismatch");
});

test("verified history cannot authenticate substituted current artifacts", async () => {
  const input = await fixture();
  const other = await fixture();
  for (const current of [
    other.current,
    {
      ...other.current,
      currentState: {
        ...other.current.currentState,
        signature: input.current.currentState.signature,
      },
    },
    {
      ...input.current,
      currentPayload: {
        ...input.current.currentPayload,
        ciphertext: "replaced",
      },
    },
    { ...input.current, currentProjection: [] },
    { ...input.current, currentGrants: [] },
    {
      ...input.current,
      currentMemberEnvelopes: {
        ...input.current.currentMemberEnvelopes,
        envelopes: [],
      },
    },
  ]) {
    const result = await verifyPrincipalPolicyCurrent({ ...input, current });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("hash_mismatch");
  }
});

test("current verification owns artifacts and retained history before yielding", async () => {
  const input = await fixture();
  const pending = verifyPrincipalPolicyCurrent(input);
  Object.assign(input.current.currentState, {
    signature: "changed after call",
  });
  Object.assign(input.history.currentEntry.state, {
    signature: "changed proof after call",
  });
  const policy = accepted(await pending);
  expect(policy.state.signature).not.toBe("changed after call");
  expect(policy.retainedHistory[0]?.state.signature).not.toBe(
    "changed proof after call",
  );
});

test("checkpoint connection selects a retained version rather than its array position", async () => {
  const { shared, signer, first, second, third } = await historyFixture();
  const localCheckpoint = {
    principalType: "group" as const,
    principalId: shared.principalId,
    version: 2,
    stateHash: second.state.stateHash,
  };
  const verifier = createPrincipalPolicyHistoryVerifier({
    ...localCheckpoint,
    localCheckpoint,
    retainedReferences: [historyHead(second.state)],
  });
  accepted(
    await verifier.append({
      entries: [first.entry, second.entry, third.entry],
      signerPublicKeys: [signer],
    }),
  );
  const history = accepted(verifier.finish(historyHead(third.state)));
  expect(history.retainedEntries.map((entry) => entry.state.version)).toEqual([
    2, 3,
  ]);
  const policy = accepted(
    await verifyPrincipalPolicyCurrent({
      history,
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
  expect(() =>
    verifyPrincipalPolicyCheckpoint({
      chain: policy.retainedHistory,
      currentState: policy.state,
      localCheckpoint,
    }),
  ).not.toThrow();
  expect(() =>
    verifyPrincipalPolicyCheckpoint({
      chain: [],
      currentState: policy.state,
      localCheckpoint,
    }),
  ).toThrow("does not extend");
});
