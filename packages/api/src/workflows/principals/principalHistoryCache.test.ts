import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { principalHistoryProgress } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { principalHistoryPreparationFixture } from "../../../test/helpers/principalHistoryPreparation";
import {
  preparePrincipalHistory,
  principalHistoryPreparationBudget,
} from "./preparePrincipalHistory";
import {
  discardBufferedPrincipalHistoryProgress,
  removePrincipalHistoryProgressOnCommit,
  selectBufferedPrincipalHistoryProgress,
} from "./principalHistoryCache";
import { principalHistoryProtection } from "./principalHistoryProtection";

test("transaction-local progress advances without writing hints until commit", async () => {
  const { head } = await principalHistoryPreparationFixture({ versions: 3 });
  await db.transaction(async (tx) => {
    for (let version = 1; version <= 3; version += 1) {
      const budget = {
        ...principalHistoryPreparationBudget(),
        remainingEntries: 1,
      };
      const result = await preparePrincipalHistory(tx, { head, budget });
      expect(budget.acceptedEntries).toBe(1);
      expect(result.complete).toBe(version === 3);
      expect(
        await tx
          .select()
          .from(principalHistoryProgress)
          .where(eq(principalHistoryProgress.principalId, head.principalId)),
      ).toHaveLength(0);
    }
  });
  expect(
    await db
      .select()
      .from(principalHistoryProgress)
      .where(eq(principalHistoryProgress.principalId, head.principalId)),
  ).toHaveLength(3);
  const budget = principalHistoryPreparationBudget();
  expect((await preparePrincipalHistory(db, { head, budget })).complete).toBe(
    true,
  );
  expect(budget.acceptedEntries).toBe(0);
});

test("a released savepoint cannot publish hints before its outer rollback", async () => {
  const { head } = await principalHistoryPreparationFixture({ versions: 2 });
  await expect(
    db.transaction(async (tx) => {
      await tx.transaction(async (nested) => {
        expect(
          (
            await preparePrincipalHistory(nested, {
              head,
              budget: principalHistoryPreparationBudget(),
            })
          ).complete,
        ).toBe(true);
      });
      throw new Error("outer rollback");
    }),
  ).rejects.toThrow("outer rollback");
  expect(
    await db
      .select()
      .from(principalHistoryProgress)
      .where(eq(principalHistoryProgress.principalId, head.principalId)),
  ).toHaveLength(0);
  const budget = principalHistoryPreparationBudget();
  expect((await preparePrincipalHistory(db, { head, budget })).complete).toBe(
    true,
  );
  expect(budget.acceptedEntries).toBe(2);
});

test("a corrupt hint can be discarded even when its reader rolls back", async () => {
  const { head } = await principalHistoryPreparationFixture({ versions: 1 });
  await preparePrincipalHistory(db, {
    head,
    budget: principalHistoryPreparationBudget(),
  });
  await db
    .update(principalHistoryProgress)
    .set({ progress: "corrupt" })
    .where(eq(principalHistoryProgress.principalId, head.principalId));
  await expect(
    db.transaction(async (tx) => {
      expect(
        (
          await preparePrincipalHistory(tx, {
            head,
            budget: principalHistoryPreparationBudget(),
          })
        ).complete,
      ).toBe(false);
      throw new Error("rollback reader");
    }),
  ).rejects.toThrow("rollback reader");
  expect(
    await db
      .select()
      .from(principalHistoryProgress)
      .where(eq(principalHistoryProgress.principalId, head.principalId)),
  ).toHaveLength(0);
  expect(
    (
      await preparePrincipalHistory(db, {
        head,
        budget: principalHistoryPreparationBudget(),
      })
    ).complete,
  ).toBe(true);
});

test("one transaction reads each stored hint once and still honors its discard", async () => {
  const { head } = await principalHistoryPreparationFixture({ versions: 2 });
  await preparePrincipalHistory(db, {
    head,
    budget: principalHistoryPreparationBudget(),
  });
  const local = principalHistoryProtection(
    {
      principalType: head.principalType,
      principalId: head.principalId,
      retainedReferences: [],
    },
    "policy",
  );
  const counted = async <T>(work: () => Promise<T>) => {
    const counter = { statements: 0 };
    const result = await withDatabaseStatementCounter(counter, work);
    return { result, statements: counter.statements };
  };
  try {
    await db.transaction(async (tx) => {
      const select = (throughVersion: number) =>
        counted(() =>
          selectBufferedPrincipalHistoryProgress(tx, {
            ...local.scope,
            throughVersion,
          }),
        );
      const first = await select(head.version);
      expect(first.statements).toBe(1);
      expect(first.result?.version).toBe(head.version);
      const repeat = await select(head.version);
      expect(repeat.statements).toBe(0);
      expect(repeat.result).toBe(first.result);
      // Another version bound is another read.
      expect((await select(head.version - 1)).statements).toBe(1);
      if (!first.result) throw new Error("Missing stored hint");
      await discardBufferedPrincipalHistoryProgress(tx, first.result);
      const discarded = await select(head.version);
      expect(discarded.statements).toBe(0);
      expect(discarded.result).toBeNull();
    });
  } finally {
    local.protection.localKey.fill(0);
  }
});

test("a removed principal's stored and buffered hints go only when its transaction commits", async () => {
  const removed = await principalHistoryPreparationFixture({ versions: 2 });
  const kept = await principalHistoryPreparationFixture({ versions: 2 });
  const progressOf = (principalId: string) =>
    db
      .select()
      .from(principalHistoryProgress)
      .where(eq(principalHistoryProgress.principalId, principalId));
  const budget = () => ({
    ...principalHistoryPreparationBudget(),
    remainingEntries: 1,
  });
  // One committed hint each, then one more buffered in each transaction.
  for (const { head } of [removed, kept])
    await preparePrincipalHistory(db, { head, budget: budget() });
  const rollback = new Error("rollback");
  await expect(
    db.transaction(async (tx) => {
      await preparePrincipalHistory(tx, {
        head: removed.head,
        budget: budget(),
      });
      await removePrincipalHistoryProgressOnCommit(tx, "group", [
        removed.head.principalId,
      ]);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
  expect(await progressOf(removed.head.principalId)).toHaveLength(1);

  await db.transaction(async (tx) => {
    for (const { head } of [removed, kept])
      await preparePrincipalHistory(tx, { head, budget: budget() });
    await removePrincipalHistoryProgressOnCommit(tx, "group", [
      removed.head.principalId,
    ]);
    // Nothing is deleted before the commit.
    expect(
      await tx
        .select()
        .from(principalHistoryProgress)
        .where(
          eq(principalHistoryProgress.principalId, removed.head.principalId),
        ),
    ).toHaveLength(1);
  });
  expect(await progressOf(removed.head.principalId)).toEqual([]);
  expect(await progressOf(kept.head.principalId)).toHaveLength(2);
});
