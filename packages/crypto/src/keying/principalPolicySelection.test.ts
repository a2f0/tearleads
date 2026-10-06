import { expect, test } from "bun:test";
import { principalPolicyMatchesReference } from "./containerPathAccess";
import type { VerifiedPrincipalPolicyCurrent } from "./principalPolicyCurrent";
import { createPrincipalPolicyHistoryVerifier } from "./principalPolicyHistory";
import {
  historyFixture,
  historyHead,
} from "./principalPolicyHistoryTestFixtures";
import { selectPrincipalPolicyAuthorization } from "./principalPolicySelection";
import type { VerifiedPrincipalPolicySelection } from "./principalPolicyTypes";
import type {
  AnyVerifiedPrincipalPolicy,
  KeyingVerificationResult,
} from "./types";

const isFullPolicy: VerifiedPrincipalPolicySelection extends AnyVerifiedPrincipalPolicy
  ? true
  : false = false;
const isCurrentPolicy: VerifiedPrincipalPolicySelection extends VerifiedPrincipalPolicyCurrent
  ? true
  : false = false;

function accepted<T>(result: KeyingVerificationResult<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

async function fixture() {
  const { shared, signer, first, second, third } = await historyFixture();
  const verifier = createPrincipalPolicyHistoryVerifier({
    principalType: "group",
    principalId: shared.principalId,
    retainedReferences: [historyHead(first.state)],
  });
  accepted(
    await verifier.append({
      entries: [first.entry, second.entry, third.entry],
      signerPublicKeys: [signer],
    }),
  );
  return {
    first,
    second,
    third,
    history: accepted(verifier.finish(historyHead(third.state))),
  };
}

test("public selection exposes only authenticated citations without keying artifacts", async () => {
  const { first, second, third, history } = await fixture();
  const policy = accepted(await selectPrincipalPolicyAuthorization(history));
  expect(isFullPolicy).toBe(false);
  expect(isCurrentPolicy).toBe(false);
  expect(policy).not.toHaveProperty("history");
  expect(policy.retainedHistory.map((entry) => entry.state.version)).toEqual([
    1, 3,
  ]);
  for (const entry of [first, third])
    expect(
      principalPolicyMatchesReference({
        policy,
        reference: historyHead(entry.state),
      }),
    ).toBe(true);
  expect(
    principalPolicyMatchesReference({
      policy,
      reference: historyHead(second.state),
    }),
  ).toBe(false);
});

test("public selection rejects serialized history", async () => {
  const input = await fixture();
  const cloned = await selectPrincipalPolicyAuthorization(
    structuredClone(input.history),
  );
  expect(cloned.ok).toBe(false);
  if (!cloned.ok) expect(cloned.error.code).toBe("invalid_shape");
});

test("public selection ignores modified public copies", async () => {
  const input = await fixture();
  Object.assign(input.history.currentEntry.state, { signature: "substituted" });
  Object.assign(input.history.retainedEntries[0]?.state ?? {}, {
    stateHash: "0".repeat(64),
  });
  const policy = accepted(
    await selectPrincipalPolicyAuthorization(input.history),
  );
  expect(policy.state.signature).toBe(input.third.state.signature);
  expect(policy.retainedHistory[0]?.state.stateHash).toBe(
    input.first.state.stateHash,
  );
  Object.assign(policy.state, { signature: "changed result" });
  expect(
    accepted(await selectPrincipalPolicyAuthorization(input.history)).state
      .signature,
  ).toBe(input.third.state.signature);
});
