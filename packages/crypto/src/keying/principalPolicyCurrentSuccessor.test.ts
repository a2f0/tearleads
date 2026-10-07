import { expect, test } from "bun:test";
import { verifyPrincipalPolicyCurrent } from "./principalPolicyCurrent";
import { verifyPrincipalPolicyCurrentSuccessor } from "./principalPolicyCurrentSuccessor";
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
function artifacts(signed: Awaited<ReturnType<typeof signPolicyState>>) {
  const { state, entry, payload, memberEnvelopes } = signed;
  return {
    currentState: state,
    currentProjection: entry.projection,
    currentGrants: entry.grants,
    currentPayload: payload,
    currentMemberEnvelopes: {
      principalType: state.principalType,
      principalId: state.principalId,
      stateHash: state.stateHash,
      epoch: state.keyEpoch,
      envelopes: memberEnvelopes,
    },
  };
}
async function fixture() {
  const f = await historyFixture();
  const verifier = f.create();
  accepted(
    await verifier.append({
      entries: [f.first.entry, f.second.entry],
      signerPublicKeys: [f.signer],
    }),
  );
  const previous = accepted(
    await verifyPrincipalPolicyCurrent({
      current: artifacts(f.second),
      history: accepted(verifier.finish(historyHead(f.second.state))),
    }),
  );
  return { ...f, previous, current: artifacts(f.third) };
}

test("successor verification remains a two-entry selection across repeated advances", async () => {
  const f = await fixture();
  let previous = f.previous;
  for (let version = 3; version <= 8; version += 1) {
    const next = await signPolicyState({
      ...f.shared,
      version,
      prevStateHash: previous.stateHash,
    });
    previous = accepted(
      await verifyPrincipalPolicyCurrentSuccessor({
        previous,
        current: artifacts(next),
        signerPublicKeys: [f.signer],
      }),
    );
    expect(previous.retainedHistory.map(({ state }) => state.version)).toEqual([
      version - 1,
      version,
    ]);
    expect(previous).not.toHaveProperty("history");
  }
});

test("successor verification uses privately issued evidence and owns inputs before yielding", async () => {
  const f = await fixture();
  const input = {
    previous: f.previous,
    current: f.current,
    signerPublicKeys: [f.signer],
  };
  const copied = await verifyPrincipalPolicyCurrentSuccessor({
    ...input,
    previous: { ...f.previous },
  });
  expect(copied.ok).toBe(false);
  if (!copied.ok) expect(copied.error.code).toBe("invalid_shape");
  const pending = verifyPrincipalPolicyCurrentSuccessor(input);
  Reflect.set(f.previous.state, "stateHash", "f".repeat(64));
  f.current.currentState.signature = "replaced";
  const checked = accepted(await pending);
  expect(checked.version).toBe(3);
  expect(checked.retainedHistory[0]?.state.stateHash).toBe(
    f.second.state.stateHash,
  );
});

test.each(["signature", "payload", "envelopes"] as const)(
  "successor %s substitution is rejected",
  async (field) => {
    const f = await fixture();
    if (field === "signature") f.current.currentState.signature = "AAAA";
    else if (field === "payload")
      Reflect.set(f.current.currentPayload, "ciphertext", "replaced");
    else f.current.currentMemberEnvelopes.envelopes = [];
    const checked = await verifyPrincipalPolicyCurrentSuccessor({
      previous: f.previous,
      current: f.current,
      signerPublicKeys: [f.signer],
    });
    expect(checked.ok).toBe(false);
    if (!checked.ok)
      expect(checked.error.code).toBe(
        field === "signature" ? "signature_mismatch" : "hash_mismatch",
      );
  },
);

test.each(["version", "predecessor"] as const)(
  "a signed successor with another %s is rejected",
  async (field) => {
    const f = await fixture();
    const next = await signPolicyState({
      ...f.shared,
      version: field === "version" ? 4 : 3,
      prevStateHash:
        field === "predecessor"
          ? f.first.state.stateHash
          : f.second.state.stateHash,
    });
    const checked = await verifyPrincipalPolicyCurrentSuccessor({
      previous: f.previous,
      current: artifacts(next),
      signerPublicKeys: [f.signer],
    });
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.error.code).toBe("stale_predecessor");
  },
);

test("a correctly signed successor still requires prior admin authority", async () => {
  const f = await fixture();
  const attacker = await createPolicySigner("not-an-admin");
  const next = await signPolicyState({
    ...f.shared,
    projection: f.second.entry.projection,
    version: 3,
    prevStateHash: f.second.state.stateHash,
    signer: attacker,
  });
  const result = await verifyPrincipalPolicyCurrentSuccessor({
    previous: f.previous,
    current: artifacts(next),
    signerPublicKeys: [attacker],
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("unauthorized");
});

test("a signed membership shrink must rotate the principal key", async () => {
  const f = await fixture();
  const next = await signPolicyState({
    ...f.shared,
    members: [],
    projection: [],
    version: 3,
    prevStateHash: f.second.state.stateHash,
  });
  const result = await verifyPrincipalPolicyCurrentSuccessor({
    previous: f.previous,
    current: artifacts(next),
    signerPublicKeys: [f.signer],
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("key_epoch_reuse");
});
