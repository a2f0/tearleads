import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  principalHistoryIndexNodes,
  principalHistoryProgress,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { principalHistoryPreparationFixture } from "../../../test/helpers/principalHistoryPreparation";
import {
  preparePrincipalHistory,
  principalHistoryPreparationBudget,
} from "./preparePrincipalHistory";

test.each(["missing", "corrupt"] as const)(
  "a %s proof node rebuilds from signed history in bounded steps",
  async (damage) => {
    const { head, entries } = await principalHistoryPreparationFixture({
      versions: 8,
    });
    const first = entries[0];
    if (!first) throw new Error("Missing genesis fixture");
    const prepared = await preparePrincipalHistory(db, {
      head,
      budget: principalHistoryPreparationBudget(),
    });
    if (!prepared.complete) throw new Error("Expected complete fixture");
    const hash = prepared.history.indexRootHash;
    if (damage === "missing")
      await db
        .delete(principalHistoryIndexNodes)
        .where(eq(principalHistoryIndexNodes.hash, hash));
    else
      await db
        .update(principalHistoryIndexNodes)
        .set({ leftHash: "0".repeat(64) })
        .where(eq(principalHistoryIndexNodes.hash, hash));
    let recovered = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const budget = {
        ...principalHistoryPreparationBudget(),
        remainingEntries: 1,
      };
      const result = await preparePrincipalHistory(db, {
        head,
        budget,
        retainedReferences: [first.state],
      });
      expect(budget.acceptedEntries).toBeLessThanOrEqual(1);
      if (result.complete) {
        expect(
          result.history.retainedEntries.map((entry) => entry.state.version),
        ).toEqual([1, 8]);
        recovered = true;
        break;
      }
    }
    expect(recovered).toBe(true);
  },
);

test("cache loss discards a bounded newest chunk and resumes the surviving prefix", async () => {
  const { head, entries } = await principalHistoryPreparationFixture({
    versions: 65,
  });
  const first = entries[0]?.state;
  if (!first) throw new Error("Missing genesis fixture");
  let rootHash = "";
  const oneEntry = () => ({
    ...principalHistoryPreparationBudget(),
    remainingEntries: 1,
  });
  for (let version = 1; version <= head.version; version += 1) {
    const result = await preparePrincipalHistory(db, {
      head,
      budget: oneEntry(),
    });
    if (result.complete) rootHash = result.history.indexRootHash;
  }
  expect(rootHash).not.toBe("");
  await db
    .delete(principalHistoryIndexNodes)
    .where(eq(principalHistoryIndexNodes.hash, rootHash));
  const hints = () =>
    db
      .select()
      .from(principalHistoryProgress)
      .where(eq(principalHistoryProgress.principalId, head.principalId));
  expect(await hints()).toHaveLength(65);
  const repair = oneEntry();
  expect(
    (
      await preparePrincipalHistory(db, {
        head,
        budget: repair,
        retainedReferences: [first],
      })
    ).complete,
  ).toBe(false);
  expect(repair.acceptedEntries).toBe(0);
  const surviving = await hints();
  expect(surviving).toHaveLength(33);
  expect(Math.max(...surviving.map((row) => row.version))).toBe(33);
  for (let version = 34; version <= head.version; version += 1) {
    const budget = oneEntry();
    const result = await preparePrincipalHistory(db, {
      head,
      budget,
      retainedReferences: [first],
    });
    expect(budget.acceptedEntries).toBe(1);
    expect(result.complete).toBe(version === head.version);
    if (result.complete) expect(result.history.indexRootHash).toBe(rootHash);
  }
}, 30_000);

test("rolled-back cache repair discards broken hints without publishing rebuilt nodes", async () => {
  const { head, entries } = await principalHistoryPreparationFixture({
    versions: 3,
  });
  const first = entries[0]?.state;
  if (!first) throw new Error("Missing genesis fixture");
  const prepared = await preparePrincipalHistory(db, {
    head,
    budget: principalHistoryPreparationBudget(),
  });
  if (!prepared.complete) throw new Error("Incomplete fixture");
  const rootHash = prepared.history.indexRootHash;
  await db
    .delete(principalHistoryIndexNodes)
    .where(eq(principalHistoryIndexNodes.hash, rootHash));
  await expect(
    db.transaction(async (tx) => {
      const request = () => ({
        head,
        budget: principalHistoryPreparationBudget(),
        retainedReferences: [first],
      });
      expect((await preparePrincipalHistory(tx, request())).complete).toBe(
        false,
      );
      expect((await preparePrincipalHistory(tx, request())).complete).toBe(
        true,
      );
      throw new Error("rollback repaired reader");
    }),
  ).rejects.toThrow("rollback repaired reader");
  expect(
    await db
      .select()
      .from(principalHistoryIndexNodes)
      .where(eq(principalHistoryIndexNodes.hash, rootHash)),
  ).toHaveLength(0);
  expect(
    await db
      .select()
      .from(principalHistoryProgress)
      .where(eq(principalHistoryProgress.principalId, head.principalId)),
  ).toHaveLength(0);
  const budget = principalHistoryPreparationBudget();
  expect(
    (
      await preparePrincipalHistory(db, {
        head,
        budget,
        retainedReferences: [first],
      })
    ).complete,
  ).toBe(true);
  expect(budget.acceptedEntries).toBe(3);
});
