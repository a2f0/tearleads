import { expect, test } from "bun:test";
import { createAuthor } from "../../../test/helpers/containerFixtures";
import { principalRepairEvidence } from "../../../test/helpers/principalRepairEvidence";
import type { PrincipalPolicyResolveRequest } from "../../data/keyingProjectionVerification/types";
import { recoverPrincipalPolicyRepair } from "./policyRepair";

test.each(["organization", "reference"] as const)(
  "repair rejects a resolver result with the wrong %s",
  async (kind) => {
    const { head, evidence } = await principalRepairEvidence(
      await createAuthor(),
    );
    const warmer = Object.assign(async () => undefined, {
      resolveReference: async () => ({
        ...evidence,
        organizationId:
          kind === "organization"
            ? "other-organization"
            : evidence.organizationId,
      }),
    });
    await expect(
      recoverPrincipalPolicyRepair({
        heads: [
          {
            ...head,
            ...(kind === "reference" ? { stateHash: "f".repeat(64) } : {}),
          },
        ],
        organizationId: evidence.organizationId,
        warmReferencedPrincipalPolicies: warmer,
      }),
    ).rejects.toMatchObject({ code: "object_mismatch" });
  },
);

test.each(["caller", "current-result", "prior-result"] as const)(
  "repair stops when the %s expires across recovery",
  async (kind) => {
    const { head, evidence } = await principalRepairEvidence(
      await createAuthor(),
    );
    let callerCurrent = true;
    let firstCurrent = true;
    let calls = 0;
    const warmer = Object.assign(async () => undefined, {
      resolveReference: async () => {
        calls++;
        if (kind === "caller") callerCurrent = false;
        if (kind === "current-result" || calls === 2) firstCurrent = false;
        return {
          ...evidence,
          stillCurrent: calls === 1 ? () => firstCurrent : () => true,
        };
      },
    });
    await expect(
      recoverPrincipalPolicyRepair({
        heads: [head, head],
        organizationId: evidence.organizationId,
        warmReferencedPrincipalPolicies: warmer,
        stillCurrent: () => callerCurrent,
      }),
    ).rejects.toThrow("generation expired");
    expect(calls).toBe(kind === "prior-result" ? 2 : 1);
  },
);

test("repair snapshots requested heads and validates the original citation after a callback mutates its argument", async () => {
  const { head, evidence } = await principalRepairEvidence(
    await createAuthor(),
  );
  const original = { ...head, stateHash: "e".repeat(64) };
  const heads = [original];
  const warmer = Object.assign(async () => undefined, {
    resolveReference: async (input: PrincipalPolicyResolveRequest) => {
      Object.assign(input.reference, head);
      Object.assign(original, head);
      heads.length = 0;
      return evidence;
    },
  });
  await expect(
    recoverPrincipalPolicyRepair({
      heads,
      organizationId: evidence.organizationId,
      warmReferencedPrincipalPolicies: warmer,
    }),
  ).rejects.toMatchObject({ code: "object_mismatch" });
});

test("repair refuses an oversized page before recovery and never falls back to Full", async () => {
  const { head, evidence } = await principalRepairEvidence(
    await createAuthor(),
  );
  let calls = 0;
  const warmer = Object.assign(
    async () => {
      calls++;
    },
    {
      resolveReference: async () => {
        calls++;
        return evidence;
      },
    },
  );
  await expect(
    recoverPrincipalPolicyRepair({
      heads: Array.from({ length: 17 }, () => head),
      organizationId: evidence.organizationId,
      warmReferencedPrincipalPolicies: warmer,
    }),
  ).rejects.toThrow("head limit exceeded");
  expect(
    await recoverPrincipalPolicyRepair({
      heads: [head],
      organizationId: evidence.organizationId,
      warmReferencedPrincipalPolicies: Object.assign(async () => {
        calls++;
      }, {}),
    }),
  ).toBe(false);
  expect(calls).toBe(0);
});
