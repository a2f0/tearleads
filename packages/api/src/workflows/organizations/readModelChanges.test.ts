import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import {
  groups,
  organizationGroupTombstones,
  organizationReadModelHeads,
  organizationRosterEntries,
} from "@tearleads/api-shared/schema";
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

async function loadHead(organizationId: string) {
  const [head] = await db
    .select({
      cursor: organizationReadModelHeads.cursor,
      directoryCursor: organizationReadModelHeads.directoryCursor,
      grantsCursor: organizationReadModelHeads.grantsCursor,
      groupMembershipsCursor: organizationReadModelHeads.groupMembershipsCursor,
      groupsCursor: organizationReadModelHeads.groupsCursor,
      organizationPolicyCursor:
        organizationReadModelHeads.organizationPolicyCursor,
    })
    .from(organizationReadModelHeads)
    .where(eq(organizationReadModelHeads.organizationId, organizationId));
  return head;
}

test("organization read-model changes stamp ordered cursors on their lanes", async () => {
  const organizationId = crypto.randomUUID();
  await createOrganizationReadModelHead(organizationId);

  const { observedChanges, result: results } =
    await collectOrganizationReadModelChanges(() =>
      db.transaction(async (tx) => {
        const first = await appendOrganizationReadModelChangeInTransaction(tx, {
          organizationId,
          lanes: ["groups"],
        });
        const second = await appendOrganizationReadModelChangeInTransaction(
          tx,
          {
            organizationId,
            lanes: ["directory"],
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

  expect(await loadHead(organizationId)).toEqual({
    cursor: 2n,
    directoryCursor: 2n,
    grantsCursor: 0n,
    groupMembershipsCursor: 0n,
    groupsCursor: 1n,
    organizationPolicyCursor: 0n,
  });
});

test("organization read-model cursor allocation rolls back without gaps", async () => {
  const organizationId = crypto.randomUUID();
  await createOrganizationReadModelHead(organizationId);

  await expect(
    db.transaction(async (tx) => {
      await appendOrganizationReadModelChangeInTransaction(tx, {
        organizationId,
        lanes: ["directory"],
      });
      throw new Error("roll back source mutation");
    }),
  ).rejects.toThrow("roll back source mutation");

  expect(await loadHead(organizationId)).toMatchObject({
    cursor: 0n,
    directoryCursor: 0n,
  });

  const next = await db.transaction((tx) =>
    appendOrganizationReadModelChangeInTransaction(tx, {
      organizationId,
      lanes: ["directory"],
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
            lanes: ["directory"],
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
          lanes: ["groups"],
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
          lanes: ["directory"],
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
        lanes: ["groups"],
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
      lanes: ["groups"],
    }),
  );

  expect(result.cursor).toBe("9007199254740993");
});

test("organization read-model changes reject a missing cursor head", async () => {
  await expect(
    db.transaction((tx) =>
      appendOrganizationReadModelChangeInTransaction(tx, {
        organizationId: crypto.randomUUID(),
        lanes: ["directory"],
      }),
    ),
  ).rejects.toThrow("Organization read-model cursor head is missing");
});

test("one change stamps several lanes, member groups, and tombstones with one cursor", async () => {
  const organizationId = crypto.randomUUID();
  const changedGroupId = crypto.randomUUID();
  const otherGroupId = crypto.randomUUID();
  const deletedGroupId = crypto.randomUUID();
  await createOrganizationReadModelHead(organizationId);
  await db.insert(groups).values([
    { id: changedGroupId, organizationId },
    { id: otherGroupId, organizationId },
  ]);
  await db
    .insert(organizationGroupTombstones)
    .values({ groupId: deletedGroupId, organizationId });

  const counter = { statements: 0 };
  const result = await db.transaction((tx) =>
    withDatabaseStatementCounter(counter, () =>
      appendOrganizationReadModelChangeInTransaction(tx, {
        deletedGroupIds: [deletedGroupId],
        lanes: ["directory", "organizationPolicy"],
        membershipGroupIds: [changedGroupId],
        organizationId,
      }),
    ),
  );

  expect(result).toEqual({ cursor: "1" });
  // One head update for every lane, then one update per stamped table.
  expect(counter.statements).toBe(3);
  const laneOnly = { statements: 0 };
  await db.transaction((tx) =>
    withDatabaseStatementCounter(laneOnly, () =>
      appendOrganizationReadModelChangeInTransaction(tx, {
        lanes: ["directory", "groups", "grants", "organizationPolicy"],
        organizationId,
      }),
    ),
  );
  expect(laneOnly.statements).toBe(1);
  expect(await loadHead(organizationId)).toEqual({
    cursor: 2n,
    directoryCursor: 2n,
    grantsCursor: 2n,
    groupMembershipsCursor: 1n,
    groupsCursor: 2n,
    organizationPolicyCursor: 2n,
  });
  const groupRows = await db
    .select({ cursor: groups.membershipCursor, id: groups.id })
    .from(groups)
    .where(inArray(groups.id, [changedGroupId, otherGroupId]));
  expect(new Map(groupRows.map((row) => [row.id, row.cursor]))).toEqual(
    new Map([
      [changedGroupId, 1n],
      [otherGroupId, 0n],
    ]),
  );
  const [tombstone] = await db
    .select({ cursor: organizationGroupTombstones.deletedCursor })
    .from(organizationGroupTombstones)
    .where(eq(organizationGroupTombstones.groupId, deletedGroupId));
  expect(tombstone).toEqual({ cursor: 1n });
});

test("organization read-model changes fail closed on a missing stamp target", async () => {
  const organizationId = crypto.randomUUID();
  const foreignGroupId = crypto.randomUUID();
  await createOrganizationReadModelHead(organizationId);
  await db
    .insert(groups)
    .values({ id: foreignGroupId, organizationId: crypto.randomUUID() });

  for (const change of [
    { membershipGroupIds: [foreignGroupId] },
    { deletedGroupIds: [crypto.randomUUID()] },
  ]) {
    await expect(
      db.transaction((tx) =>
        appendOrganizationReadModelChangeInTransaction(tx, {
          ...change,
          organizationId,
        }),
      ),
    ).rejects.toThrow("Organization read-model group stamp target is missing");
  }
  await expect(
    db.transaction((tx) =>
      appendOrganizationReadModelChangeInTransaction(tx, {
        lanes: [],
        organizationId,
      }),
    ),
  ).rejects.toThrow("Organization read-model change names no lane");
  expect(await loadHead(organizationId)).toMatchObject({ cursor: 0n });
});
