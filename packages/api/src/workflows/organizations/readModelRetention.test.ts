import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  organizationReadModelChanges,
  organizationReadModelHeads,
} from "@symcrypt/api-shared/schema";
import { asc, eq } from "drizzle-orm";
import { appendOrganizationReadModelChangeInTransaction } from "./readModelChanges";
import {
  isOrganizationReadModelCursorRetained,
  ORGANIZATION_READ_MODEL_RETAINED_CHANGE_COUNT,
  pruneOrganizationReadModelChangesInTransaction,
} from "./readModelRetention";

async function seedHead(cursor = 0n): Promise<string> {
  const organizationId = crypto.randomUUID();
  await db.insert(organizationReadModelHeads).values({
    organizationId,
    cursor,
  });
  return organizationId;
}

async function retainedCursors(organizationId: string): Promise<bigint[]> {
  const rows = await db
    .select({ cursor: organizationReadModelChanges.cursor })
    .from(organizationReadModelChanges)
    .where(eq(organizationReadModelChanges.organizationId, organizationId))
    .orderBy(asc(organizationReadModelChanges.cursor));
  return rows.map((row) => row.cursor);
}

async function headCursor(organizationId: string): Promise<bigint | null> {
  const [head] = await db
    .select({ cursor: organizationReadModelHeads.cursor })
    .from(organizationReadModelHeads)
    .where(eq(organizationReadModelHeads.organizationId, organizationId))
    .limit(1);
  return head?.cursor ?? null;
}

test("prunes only a contiguous prefix and exposes its cursor boundary", async () => {
  const organizationId = await seedHead();
  await db.transaction(async (tx) => {
    for (let index = 0; index < 4; index += 1) {
      await appendOrganizationReadModelChangeInTransaction(tx, {
        entityId: crypto.randomUUID(),
        lane: "directory",
        operation: "upsert",
        organizationId,
      });
    }
    await pruneOrganizationReadModelChangesInTransaction({
      currentCursor: 4n,
      organizationId,
      retainedChangeCount: 2n,
      tx,
    });
  });

  expect(await retainedCursors(organizationId)).toEqual([3n, 4n]);
  await db.transaction(async (tx) => {
    expect(
      await isOrganizationReadModelCursorRetained({
        currentCursor: 4n,
        organizationId,
        requestedCursor: 2n,
        tx,
      }),
    ).toBe(true);
    expect(
      await isOrganizationReadModelCursorRetained({
        currentCursor: 4n,
        organizationId,
        requestedCursor: 1n,
        tx,
      }),
    ).toBe(false);
    expect(
      await isOrganizationReadModelCursorRetained({
        currentCursor: 4n,
        organizationId,
        requestedCursor: 4n,
        tx,
      }),
    ).toBe(true);
  });
});

test("marker append applies the production retention bound transactionally", async () => {
  const organizationId = await seedHead(
    ORGANIZATION_READ_MODEL_RETAINED_CHANGE_COUNT,
  );
  await db.insert(organizationReadModelChanges).values({
    cursor: 1n,
    entityId: crypto.randomUUID(),
    lane: "directory",
    operation: "upsert",
    organizationId,
  });

  await db.transaction((tx) =>
    appendOrganizationReadModelChangeInTransaction(tx, {
      entityId: crypto.randomUUID(),
      lane: "groups",
      operation: "upsert",
      organizationId,
    }),
  );

  expect(await retainedCursors(organizationId)).toEqual([
    ORGANIZATION_READ_MODEL_RETAINED_CHANGE_COUNT + 1n,
  ]);
});

test("pruning rolls back with its surrounding source mutation", async () => {
  const organizationId = await seedHead();
  await db.transaction(async (tx) => {
    for (let index = 0; index < 3; index += 1) {
      await appendOrganizationReadModelChangeInTransaction(tx, {
        entityId: crypto.randomUUID(),
        lane: "directory",
        operation: "upsert",
        organizationId,
      });
    }
  });

  await expect(
    db.transaction(async (tx) => {
      await appendOrganizationReadModelChangeInTransaction(tx, {
        entityId: crypto.randomUUID(),
        lane: "groups",
        operation: "upsert",
        organizationId,
      });
      await pruneOrganizationReadModelChangesInTransaction({
        currentCursor: 4n,
        organizationId,
        retainedChangeCount: 2n,
        tx,
      });
      throw new Error("roll back source mutation");
    }),
  ).rejects.toThrow("roll back source mutation");

  expect(await headCursor(organizationId)).toBe(3n);
  expect(await retainedCursors(organizationId)).toEqual([1n, 2n, 3n]);
});

test("pruning one organization preserves another organization's history", async () => {
  const organizationId = await seedHead();
  const otherOrganizationId = await seedHead();
  for (const scopedOrganizationId of [organizationId, otherOrganizationId]) {
    await db.transaction(async (tx) => {
      for (let index = 0; index < 2; index += 1) {
        await appendOrganizationReadModelChangeInTransaction(tx, {
          entityId: crypto.randomUUID(),
          lane: "directory",
          operation: "upsert",
          organizationId: scopedOrganizationId,
        });
      }
    });
  }

  await db.transaction(async (tx) => {
    await appendOrganizationReadModelChangeInTransaction(tx, {
      entityId: crypto.randomUUID(),
      lane: "groups",
      operation: "upsert",
      organizationId,
    });
    await pruneOrganizationReadModelChangesInTransaction({
      currentCursor: 3n,
      organizationId,
      retainedChangeCount: 1n,
      tx,
    });
  });

  expect(await retainedCursors(organizationId)).toEqual([3n]);
  expect(await retainedCursors(otherOrganizationId)).toEqual([1n, 2n]);
});

test("rejects a retention policy that would discard the current marker", async () => {
  const organizationId = await seedHead();
  await expect(
    db.transaction((tx) =>
      pruneOrganizationReadModelChangesInTransaction({
        currentCursor: 1n,
        organizationId,
        retainedChangeCount: 0n,
        tx,
      }),
    ),
  ).rejects.toThrow("retention must keep a change");
});
