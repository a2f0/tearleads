import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { principalStates } from "@tearleads/api-shared/schema";
import { and, eq } from "drizzle-orm";
import { principalHistoryPreparationFixture } from "../../../test/helpers/principalHistoryPreparation";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { getVerifiedPrincipalPolicyForStateWithExecutor } from "./getCurrentPrincipalPolicy";
import {
  preparePrincipalHistory,
  principalHistoryPreparationBudget,
} from "./preparePrincipalHistory";

test("changing retained references does not replay a verified prefix", async () => {
  const { entries, head } = await principalHistoryPreparationFixture({
    versions: 8,
  });
  const cold = principalHistoryPreparationBudget();
  expect(
    (await preparePrincipalHistory(db, { head, budget: cold })).complete,
  ).toBe(true);
  expect(cold.acceptedEntries).toBe(8);
  for (const entry of entries.slice(0, -1)) {
    const budget = principalHistoryPreparationBudget();
    const selected = await preparePrincipalHistory(db, {
      head,
      budget,
      retainedReferences: [entry.state],
    });
    expect(selected.complete).toBe(true);
    if (selected.complete)
      expect(
        selected.history.retainedEntries.map(
          (retained) => retained.state.version,
        ),
      ).toEqual([entry.state.version, 8]);
    expect(budget.acceptedEntries).toBe(0);
  }
});

test("the current-policy caller rejects future and conflicting references as stale", async () => {
  const { entries, head } = await principalHistoryPreparationFixture({
    versions: 3,
    currentArtifacts: true,
  });
  const first = entries[0]?.state;
  const stored = await getCurrentPrincipalState(
    head.principalType,
    head.principalId,
    db,
  );
  if (!first || !stored) throw new Error("Missing policy fixture");
  expect(
    (
      await getVerifiedPrincipalPolicyForStateWithExecutor(db, stored, [first])
    ).policy.retainedHistory.map((entry) => entry.state.version),
  ).toEqual([1, 3]);
  for (const references of [
    [{ ...first, version: 4 }],
    [{ ...first, stateHash: "0".repeat(64) }],
    [first, { ...first, stateHash: "0".repeat(64) }],
  ])
    await expect(
      getVerifiedPrincipalPolicyForStateWithExecutor(db, stored, references),
    ).rejects.toMatchObject({
      status: 409,
      message: "Principal policy state is stale",
    });
});

test("a cached prefix rejects a replaced historical signature during reference selection", async () => {
  const { entries, head } = await principalHistoryPreparationFixture({
    versions: 3,
  });
  const first = entries[0]?.state;
  if (!first) throw new Error("Missing historical fixture");
  expect(
    (
      await preparePrincipalHistory(db, {
        head,
        budget: principalHistoryPreparationBudget(),
        retainedReferences: [first],
      })
    ).complete,
  ).toBe(true);
  await db
    .update(principalStates)
    .set({ signature: head.signature })
    .where(
      and(
        eq(principalStates.principalId, head.principalId),
        eq(principalStates.version, 1),
      ),
    );
  await expect(
    preparePrincipalHistory(db, {
      head,
      budget: principalHistoryPreparationBudget(),
      retainedReferences: [first],
    }),
  ).rejects.toThrow("proof root does not match");
});
