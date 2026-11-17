import { expect, test } from "bun:test";
import { type DatabaseTransaction, db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
  principalPolicyMutationAcknowledgements,
} from "@tearleads/api-shared/schema";
import { inArray, type SQLWrapper, sql } from "drizzle-orm";
import { selectDueStripeSeatSync } from "./stripeSeatSyncClaim";

const ROWS = 2_000;
const NOW = new Date("2026-08-01T00:00:00.000Z");

class PlanRollback extends Error {}

function rowUuid(prefix: string, index: number): string {
  return `${prefix}-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

/**
 * Seeds inside a transaction, refreshes the planner's statistics there, and
 * rolls everything back, so the plan reflects the seeded table shape.
 */
async function planWith(
  seed: (tx: DatabaseTransaction) => Promise<void>,
  statement: (tx: DatabaseTransaction) => SQLWrapper,
): Promise<string> {
  let plan = "";
  try {
    await db.transaction(async (tx) => {
      await seed(tx);
      await tx.execute(sql`analyze`);
      const result = await tx.execute(
        sql`explain (costs off) ${statement(tx).getSQL()}`,
      );
      plan = result.rows
        .map((row) => String(Reflect.get(row, "QUERY PLAN")))
        .join("\n");
      throw new PlanRollback();
    });
  } catch (error) {
    if (!(error instanceof PlanRollback)) throw error;
  }
  return plan;
}

// Unbound seat rows (no Stripe subscription) stay due forever and are never
// claimable; the due index leaves them out, so the claim and the idle billing
// probe read only bound rows.
test("the seat due leg reads the bound-row due index", async () => {
  const plan = await planWith(
    async (tx) => {
      const ids = Array.from({ length: ROWS }, (_, index) =>
        rowUuid("5ea70000", index),
      );
      await tx.insert(organizationBilling).values(
        ids.map((organizationId) => ({
          organizationId,
          status: "active" as const,
        })),
      );
      await tx.insert(organizationBillingStripeSeats).values(
        ids.map((organizationId, index) => ({
          nextAttemptAt: new Date(NOW.getTime() - index * 1_000),
          organizationId,
        })),
      );
    },
    (tx) => selectDueStripeSeatSync(tx, NOW),
  );
  expect(plan).toContain(
    "Index Scan using organization_billing_stripe_seats_due_idx",
  );
});

// An organization purge deletes acknowledgements by container batch.
test("the purge acknowledgement delete searches by container", async () => {
  const containerIds = Array.from({ length: ROWS }, (_, index) =>
    rowUuid("ac0c0000", index),
  );
  const plan = await planWith(
    async (tx) => {
      await tx.insert(principalPolicyMutationAcknowledgements).values(
        containerIds.map((containerId, index) => ({
          batchIndex: index % 10,
          containerId,
          manifestHash: `manifest-${index}`,
          principalId: rowUuid("9a0c0000", Math.floor(index / 10)),
          principalType: "group" as const,
          requestSha256: "0".repeat(64),
          responseJson: "{}",
          stateHash: `state-${Math.floor(index / 10)}`,
        })),
      );
    },
    (tx) =>
      tx
        .delete(principalPolicyMutationAcknowledgements)
        .where(
          inArray(
            principalPolicyMutationAcknowledgements.containerId,
            containerIds.slice(0, 3),
          ),
        ),
  );
  expect(plan).toContain("Index Cond: (container_id = ANY");
  expect(plan).not.toContain("Seq Scan");
});
