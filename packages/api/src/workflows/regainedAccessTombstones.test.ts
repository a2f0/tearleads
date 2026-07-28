import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  containerSyncTombstones,
  containers,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { authenticate } from "../../test/helpers/authenticate";
import {
  readContainerParentLanePage,
  requestContainerParentLanes,
} from "../../test/helpers/containerParentLaneQuery";
import { registerUser } from "../../test/helpers/registerUser";
import { pruneRegainedAccessTombstones } from "./regainedAccessTombstones";

const STALE_TOMBSTONE_AT = new Date("2026-12-31T00:00:00.000Z");

async function organizationIdForContainer(
  containerId: string,
): Promise<string> {
  const rows = await db
    .select({ organizationId: containers.organizationId })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);
  const organizationId = rows[0]?.organizationId;
  if (!organizationId) {
    throw new Error(`container ${containerId} has no organization`);
  }
  return organizationId;
}

test("prune deletes only regained access_revoked tombstones", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const organizationId = await organizationIdForContainer(
    owner.rootContainerId,
  );

  const unreachableContainerId = crypto.randomUUID();
  const deletedContainerId = crypto.randomUUID();
  await db.insert(containerSyncTombstones).values([
    {
      // Stale: the owner can read their root container, so this row is the
      // regained-access shape the prune exists for.
      containerId: owner.rootContainerId,
      depth: 0,
      organizationId,
      parentId: null,
      reason: "access_revoked",
      updatedAt: STALE_TOMBSTONE_AT,
      userId: owner.userId,
    },
    {
      // Undelivered: the owner has no access to this container, so a client
      // that never synced during the revoke window still needs the row.
      containerId: unreachableContainerId,
      depth: 0,
      organizationId,
      parentId: null,
      reason: "access_revoked",
      updatedAt: STALE_TOMBSTONE_AT,
      userId: owner.userId,
    },
    {
      // Terminal: deleted tombstones are never pruned; deletion is
      // permanent and container ids are not reused.
      containerId: deletedContainerId,
      depth: 0,
      organizationId,
      parentId: null,
      reason: "deleted",
      updatedAt: STALE_TOMBSTONE_AT,
      userId: owner.userId,
    },
  ]);

  await db.transaction(async (tx) => {
    await pruneRegainedAccessTombstones({
      executor: tx,
      userIds: [owner.userId],
    });
  });

  const remaining = await db
    .select({
      containerId: containerSyncTombstones.containerId,
      reason: containerSyncTombstones.reason,
    })
    .from(containerSyncTombstones)
    .where(eq(containerSyncTombstones.userId, owner.userId));
  expect(
    remaining.map((row) => `${row.reason}:${row.containerId}`).sort(),
  ).toEqual(
    [
      `access_revoked:${unreachableContainerId}`,
      `deleted:${deletedContainerId}`,
    ].sort(),
  );
});

test("pruned lane pages stop serving the stale tombstone", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const organizationId = await organizationIdForContainer(
    owner.rootContainerId,
  );

  await db.insert(containerSyncTombstones).values({
    containerId: owner.rootContainerId,
    depth: 0,
    organizationId,
    parentId: null,
    reason: "access_revoked",
    updatedAt: STALE_TOMBSTONE_AT,
    userId: owner.userId,
  });

  // Before the prune the lane serves the stale tombstone alongside the item
  // — with a newer timestamp, so a client's last-writer filter would keep
  // the restored container suppressed indefinitely.
  const beforeResponse = await requestContainerParentLanes(owner.token, [
    { laneId: "root", parentId: null },
  ]);
  expect(beforeResponse.status).toBe(200);
  const beforeBody = await readContainerParentLanePage(beforeResponse, "root");
  expect(beforeBody.tombstones).toContainEqual(
    expect.objectContaining({
      containerId: owner.rootContainerId,
      reason: "access_revoked",
    }),
  );

  await db.transaction(async (tx) => {
    await pruneRegainedAccessTombstones({
      executor: tx,
      userIds: [owner.userId],
    });
  });

  const afterResponse = await requestContainerParentLanes(owner.token, [
    { laneId: "root", parentId: null },
  ]);
  expect(afterResponse.status).toBe(200);
  const afterBody = await readContainerParentLanePage(afterResponse, "root");
  expect(afterBody.tombstones).toEqual([]);
  expect(afterBody.items).toContainEqual(
    expect.objectContaining({ id: owner.rootContainerId }),
  );
});
