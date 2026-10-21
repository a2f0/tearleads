import { expect, mock, test } from "bun:test";
import { currentGroupMutationInput } from "../../../../test/helpers/currentGroupMutation";
import { principalMutationJournalFixture } from "../../../../test/helpers/principalMutationJournalFixture";
import { principalPolicyHead } from "../../../../test/helpers/principalPolicyFixtures";
import { withAuthoredPrincipalPolicies } from "./authoredPrincipalPolicyWarmer";

async function fixture() {
  const f = await principalMutationJournalFixture();
  const { verifiedCurrentPolicy } = await currentGroupMutationInput(
    f.response.groupPolicy,
    [
      {
        userId: f.scope.userId,
        signingKeyFingerprint: f.scope.signingFingerprint,
        signingPublicKey: f.signingKeyPair.signingPublicKey,
      },
    ],
  );
  let active = true;
  const resolve = mock(async (): Promise<never> => {
    throw new Error("Remote recovery required");
  });
  const evidence = {
    organizationId: f.scope.organizationId,
    policy: verifiedCurrentPolicy,
    dependencies: [],
    stillCurrent: () => active,
  };
  const warmer = withAuthoredPrincipalPolicies(
    Object.assign(async () => {}, { resolveReference: resolve }),
    [evidence],
  );
  if (!warmer?.resolveReference) throw new Error("Expected authored resolver");
  return {
    evidence,
    resolve,
    read: warmer.resolveReference,
    expire: () => {
      active = false;
    },
    request: {
      organizationId: f.scope.organizationId,
      reference: principalPolicyHead(f.response.groupPolicy),
      stillCurrent: () => true,
    },
  };
}

test("authored policy reuse requires the exact organization and signed head", async () => {
  const f = await fixture();
  expect(await f.read(f.request)).toBe(f.evidence);
  expect(f.resolve).not.toHaveBeenCalled();
  await expect(
    f.read({ ...f.request, organizationId: crypto.randomUUID() }),
  ).rejects.toThrow("Remote recovery required");
  await expect(
    f.read({
      ...f.request,
      reference: { ...f.request.reference, stateHash: "a".repeat(64) },
    }),
  ).rejects.toThrow("Remote recovery required");
  expect(f.resolve).toHaveBeenCalledTimes(2);
});

test("authored policy reuse ends with either the producer or consumer lifetime", async () => {
  const f = await fixture();
  await expect(
    f.read({ ...f.request, stillCurrent: () => false }),
  ).rejects.toThrow("generation expired");
  f.expire();
  await expect(f.read(f.request)).rejects.toThrow("generation expired");
  expect(f.resolve).not.toHaveBeenCalled();
});
