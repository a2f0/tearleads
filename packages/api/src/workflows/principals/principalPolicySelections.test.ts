import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { principalStates } from "@tearleads/api-shared/schema";
import { principalPolicyMatchesReference } from "@tearleads/crypto";
import { and, eq } from "drizzle-orm";
import { principalHistoryPreparationFixture } from "../../../test/helpers/principalHistoryPreparation";
import * as historyReads from "../../access/read/principalHistoryProgress";
import {
  preparePrincipalHistory,
  principalHistoryPreparationBudget,
} from "./preparePrincipalHistory";
import { withBoundedPrincipalHistory } from "./principalHistoryExecution";
import { PrincipalHistoryPreparationRequired } from "./principalHistoryPreparationRequest";
import { loadPrincipalAuthorizationPoliciesForReferences } from "./principalPolicyProjection";

test("historical authorization yields cold work and reuses bounded public evidence", async () => {
  // No live group, payload, or envelopes: retained public history is sufficient.
  const { head, entries } = await principalHistoryPreparationFixture({
    versions: 65,
  });
  const first = entries[0]?.state;
  if (!first) throw new Error("Missing historical fixture");
  const load = () =>
    withBoundedPrincipalHistory(() =>
      loadPrincipalAuthorizationPoliciesForReferences(
        db,
        [first, head, first],
        [],
      ),
    );
  await expect(load()).rejects.toBeInstanceOf(
    PrincipalHistoryPreparationRequired,
  );
  for (let batch = 0; batch < 3; batch++) {
    const budget = principalHistoryPreparationBudget();
    const prepared = await preparePrincipalHistory(db, { head, budget });
    expect(budget.acceptedEntries).toBeLessThanOrEqual(32);
    expect(prepared.complete).toBe(batch === 2);
  }
  const reads = spyOn(historyReads, "readPrincipalHistoryPage");
  try {
    const policies = await load();
    expect(policies).toHaveLength(1);
    const policy = policies[0];
    if (!policy) throw new Error("Missing authorization evidence");
    expect("retainedHistory" in policy).toBe(true);
    expect(policy).not.toHaveProperty("history");
    if ("retainedHistory" in policy)
      expect(
        policy.retainedHistory.map((entry) => entry.state.version),
      ).toEqual([1, 65]);
    for (const reference of [first, head])
      expect(principalPolicyMatchesReference({ policy, reference })).toBe(true);
    expect(reads.mock.calls.length).toBeGreaterThan(0);
    expect(reads.mock.calls.length).toBeLessThan(10);
    for (const [, page] of reads.mock.calls)
      expect(page.throughVersion - page.afterVersion).toBe(1);
  } finally {
    reads.mockRestore();
  }
});

test("historical authorization rejects substituted citations and cached signature bytes", async () => {
  const { head, entries } = await principalHistoryPreparationFixture({
    versions: 3,
  });
  const first = entries[0]?.state;
  if (!first) throw new Error("Missing historical fixture");
  const load = (reference = first) =>
    loadPrincipalAuthorizationPoliciesForReferences(db, [reference, head], []);
  expect(await load()).toHaveLength(1);
  await expect(load({ ...first, stateHash: "0".repeat(64) })).rejects.toThrow(
    "Principal policy state is stale",
  );
  const conflicting = { ...first, keyEpoch: first.keyEpoch + 1 };
  for (const citations of [
    [first, conflicting],
    [conflicting, first],
  ])
    await expect(
      loadPrincipalAuthorizationPoliciesForReferences(
        db,
        [head, ...citations],
        [],
      ),
    ).rejects.toThrow("Principal policy state is stale");
  await db
    .update(principalStates)
    .set({ signature: head.signature })
    .where(
      and(
        eq(principalStates.principalId, head.principalId),
        eq(principalStates.version, 1),
      ),
    );
  await expect(load()).rejects.toThrow("proof root does not match");
});

test("historical selections cannot reuse ordinary history as reserved Admins authority", async () => {
  const authority = await principalHistoryPreparationFixture({
    versions: 2,
    initiallyOrdinaryMember: true,
  });
  expect(
    (
      await preparePrincipalHistory(db, {
        head: authority.head,
        budget: principalHistoryPreparationBudget(),
      })
    ).complete,
  ).toBe(true);
  const policy = await principalHistoryPreparationFixture({
    versions: 1,
    signer: authority.signer,
    externalAuthority: { ...authority.head, principalType: "group" },
  });
  await expect(
    loadPrincipalAuthorizationPoliciesForReferences(db, [policy.head], []),
  ).rejects.toThrow("reserved Admins history contains a non-admin projection");
});

test("historical citations continue beyond a single proof batch", async () => {
  const { entries } = await principalHistoryPreparationFixture({
    versions: 129,
  });
  const references = entries.map((entry) => entry.state);
  const policies = await loadPrincipalAuthorizationPoliciesForReferences(
    db,
    references,
    [],
  );
  expect(policies).toHaveLength(2);
  expect(policies.every((policy) => policy.version === 129)).toBe(true);
  for (const reference of references)
    expect(
      policies.some((policy) =>
        principalPolicyMatchesReference({ policy, reference }),
      ),
    ).toBe(true);
}, 15_000);
