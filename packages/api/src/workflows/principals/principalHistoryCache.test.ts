import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { principalHistoryProgress } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { principalHistoryPreparationFixture } from "../../../test/helpers/principalHistoryPreparation";
import {
  preparePrincipalHistory,
  principalHistoryPreparationBudget,
} from "./preparePrincipalHistory";

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
