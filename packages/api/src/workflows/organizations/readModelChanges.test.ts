import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  organizationReadModelChanges,
  organizationReadModelHeads,
  organizationRosterEntries,
} from "@symcrypt/api-shared/schema";
import { eq, inArray } from "drizzle-orm";
import {
  appendOrganizationReadModelChangeInTransaction,
  collectOrganizationReadModelChanges,
  listCommittedOrganizationReadModelChanges,
  recordOrganizationReadModelChangeAudience,
} from "./readModelChanges";

async function createOrganizationReadModelHead(
  organizationId: string,
): Promise<void> {
  await db.insert(organizationReadModelHeads).values({ organizationId });
}

test("organization read-model changes receive ordered cursors", async () => {
  const organizationId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  await createOrganizationReadModelHead(organizationId);

  const { observedChanges, result: results } =
    await collectOrganizationReadModelChanges(() =>
      db.transaction(async (tx) => {
        const first = await appendOrganizationReadModelChangeInTransaction(tx, {
          organizationId,
          lane: "groups",
          entityId: groupId,
          operation: "upsert",
        });
        const second = await appendOrganizationReadModelChangeInTransaction(
          tx,
          {
            organizationId,
            lane: "directory",
            entityId: groupId,
            operation: "replace",
          },
        );

        return { first, second };
      }),
    );

  expect(observedChanges).toEqual([
    {
      affectedUserIds: [],
      cursor: 2n,
      organizationId,
    },
  ]);

  expect(results.first.cursor).toBe("1");
  expect(results.second.cursor).toBe("2");

  const rows = await db
    .select({
      cursor: organizationReadModelChanges.cursor,
      lane: organizationReadModelChanges.lane,
    })
    .from(organizationReadModelChanges)
    .where(eq(organizationReadModelChanges.organizationId, organizationId))
    .orderBy(organizationReadModelChanges.cursor);
  expect(rows).toEqual([
    { cursor: 1n, lane: "groups" },
    { cursor: 2n, lane: "directory" },
  ]);
});

test("organization read-model cursor allocation rolls back without gaps", async () => {
  const organizationId = crypto.randomUUID();
  await createOrganizationReadModelHead(organizationId);

  await expect(
    db.transaction(async (tx) => {
      await appendOrganizationReadModelChangeInTransaction(tx, {
        organizationId,
        lane: "directory",
        entityId: crypto.randomUUID(),
        operation: "upsert",
      });
      throw new Error("roll back source mutation");
    }),
  ).rejects.toThrow("roll back source mutation");

  const rows = await db
    .select({ cursor: organizationReadModelChanges.cursor })
    .from(organizationReadModelChanges)
    .where(eq(organizationReadModelChanges.organizationId, organizationId));
  expect(rows).toEqual([]);

  const next = await db.transaction((tx) =>
    appendOrganizationReadModelChangeInTransaction(tx, {
      organizationId,
      lane: "directory",
      entityId: crypto.randomUUID(),
      operation: "upsert",
    }),
  );
  expect(next).toEqual({ cursor: "1" });
});

test("rolled-back observed cursors are not considered committed", async () => {
  const organizationId = crypto.randomUUID();
  await createOrganizationReadModelHead(organizationId);

  const { observedChanges } = await collectOrganizationReadModelChanges(
    async () => {
      try {
        await db.transaction(async (tx) => {
          await appendOrganizationReadModelChangeInTransaction(tx, {
            organizationId,
            lane: "directory",
            entityId: crypto.randomUUID(),
            operation: "upsert",
          });
          throw new Error("roll back but return a successful outer result");
        });
      } catch {
        // Model a request boundary that converts an inner failure to 2xx.
      }
    },
  );

  expect(observedChanges).toEqual([
    { affectedUserIds: [], cursor: 1n, organizationId },
  ]);
  expect(
    await listCommittedOrganizationReadModelChanges(db, observedChanges),
  ).toEqual([]);
});

test("committed observed cursors survive a later request error", async () => {
  const organizationId = crypto.randomUUID();
  await createOrganizationReadModelHead(organizationId);

  const { observedChanges } = await collectOrganizationReadModelChanges(
    async () => {
      await db.transaction((tx) =>
        appendOrganizationReadModelChangeInTransaction(tx, {
          organizationId,
          lane: "groups",
          entityId: crypto.randomUUID(),
          operation: "upsert",
        }),
      );
      try {
        throw new Error("post-commit request failure");
      } catch {
        // Hono converts route errors into a response before collection ends.
      }
    },
  );

  expect(
    await listCommittedOrganizationReadModelChanges(db, observedChanges),
  ).toEqual([
    { affectedUserIds: [], cursor: 1n, organizationId, recipientUserIds: [] },
  ]);
});

test("hint audience unions recorded access-affected users with the active roster", async () => {
  const organizationId = crypto.randomUUID();
  const activeUserId = crypto.randomUUID();
  const removedUserId = crypto.randomUUID();
  await createOrganizationReadModelHead(organizationId);
  await db.insert(organizationRosterEntries).values([
    { organizationId, status: "active", userId: activeUserId },
    { organizationId, status: "disabled", userId: removedUserId },
  ]);

  const { observedChanges } = await collectOrganizationReadModelChanges(
    async () => {
      await db.transaction((tx) =>
        appendOrganizationReadModelChangeInTransaction(tx, {
          organizationId,
          lane: "directory",
          entityId: organizationId,
          operation: "replace",
        }),
      );
      recordOrganizationReadModelChangeAudience(organizationId, [
        removedUserId,
      ]);
    },
  );

  expect(observedChanges).toEqual([
    { affectedUserIds: [removedUserId], cursor: 1n, organizationId },
  ]);
  expect(
    await listCommittedOrganizationReadModelChanges(db, observedChanges),
  ).toEqual([
    {
      affectedUserIds: [removedUserId],
      cursor: 1n,
      organizationId,
      recipientUserIds: [activeUserId, removedUserId].sort(),
    },
  ]);
});

test("recorded audience without an observed change publishes nothing", async () => {
  const organizationId = crypto.randomUUID();
  await createOrganizationReadModelHead(organizationId);

  const { observedChanges } = await collectOrganizationReadModelChanges(
    async () => {
      recordOrganizationReadModelChangeAudience(organizationId, [
        crypto.randomUUID(),
      ]);
    },
  );

  expect(observedChanges).toEqual([]);
});

test("organization read-model cursors are independent per organization", async () => {
  const organizationIds = [crypto.randomUUID(), crypto.randomUUID()].toSorted();
  await db
    .insert(organizationReadModelHeads)
    .values(organizationIds.map((organizationId) => ({ organizationId })));

  for (const organizationId of organizationIds) {
    const result = await db.transaction((tx) =>
      appendOrganizationReadModelChangeInTransaction(tx, {
        organizationId,
        lane: "groups",
        entityId: organizationId,
        operation: "replace",
      }),
    );
    expect(result.cursor).toBe("1");
  }

  const heads = await db
    .select({
      cursor: organizationReadModelHeads.cursor,
      organizationId: organizationReadModelHeads.organizationId,
    })
    .from(organizationReadModelHeads)
    .where(inArray(organizationReadModelHeads.organizationId, organizationIds))
    .orderBy(organizationReadModelHeads.organizationId);
  expect(heads).toEqual(
    organizationIds.map((organizationId) => ({ cursor: 1n, organizationId })),
  );
});

test("organization read-model cursors preserve values above Number.MAX_SAFE_INTEGER", async () => {
  const organizationId = crypto.randomUUID();

  await db.insert(organizationReadModelHeads).values({
    cursor: 9_007_199_254_740_992n,
    organizationId,
  });
  const result = await db.transaction((tx) =>
    appendOrganizationReadModelChangeInTransaction(tx, {
      organizationId,
      lane: "groups",
      entityId: crypto.randomUUID(),
      operation: "upsert",
    }),
  );

  expect(result.cursor).toBe("9007199254740993");
});

test("organization read-model changes reject a missing cursor head", async () => {
  await expect(
    db.transaction((tx) =>
      appendOrganizationReadModelChangeInTransaction(tx, {
        organizationId: crypto.randomUUID(),
        lane: "directory",
        entityId: crypto.randomUUID(),
        operation: "replace",
      }),
    ),
  ).rejects.toThrow("Organization read-model cursor head is missing");
});
