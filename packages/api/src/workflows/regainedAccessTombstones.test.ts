import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  containerSyncTombstones,
  containers,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { authenticate } from "../../test/helpers/authenticate";
import {
  organizationIdForContainer,
  storeChildContainerAccessManifest,
} from "../../test/helpers/containerManifests";
import {
  readContainerParentLanePage,
  requestContainerParentLanes,
} from "../../test/helpers/containerParentLaneQuery";
import { addUserToAdminGroup } from "../../test/helpers/organizationAdmin";
import {
  addOrganizationMember,
  getDefaultOrganizationId,
} from "../../test/helpers/organizationMembership";
import { registerUser } from "../../test/helpers/registerUser";
import { pruneRegainedAccessTombstones } from "./regainedAccessTombstones";

const STALE_TOMBSTONE_AT = new Date("2026-12-31T00:00:00.000Z");

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

test("policy access gain prunes tombstones through the route", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const member = createTestUser();
  await registerUser(member);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  await addOrganizationMember({ actor, member, organizationId });

  // The root is granted to the organization's Admins group. Adding the user
  // to that group rematerializes the root grant in the same policy PUT and
  // restores inherited access to the child subtree.
  const rootHead = await db
    .select({ manifestHash: accessManifestHeads.manifestHash })
    .from(accessManifestHeads)
    .where(eq(accessManifestHeads.objectId, actor.rootContainerId))
    .limit(1);
  const parentManifestHash = rootHead[0]?.manifestHash;
  if (!parentManifestHash) {
    throw new Error("expected registered root manifest head");
  }
  const childContainerId = crypto.randomUUID();
  await db.insert(containers).values({
    depth: 1,
    id: childContainerId,
    organizationId,
    parentId: actor.rootContainerId,
  });
  const childManifestHash = await storeChildContainerAccessManifest({
    childContainerId,
    metadataDocumentId: crypto.randomUUID(),
    organizationId,
    owner: actor,
    parentContainerId: actor.rootContainerId,
    parentManifestHash,
  });

  // A grandchild with its OWN stale tombstone (from a separate earlier
  // revoke): grants inherit through paths, so regaining the ancestor also
  // invalidates it — the subtree expansion must reach it.
  const grandchildContainerId = crypto.randomUUID();
  await db.insert(containers).values({
    depth: 2,
    id: grandchildContainerId,
    organizationId,
    parentId: childContainerId,
  });
  await storeChildContainerAccessManifest({
    childContainerId: grandchildContainerId,
    metadataDocumentId: crypto.randomUUID(),
    organizationId,
    owner: actor,
    parentContainerId: childContainerId,
    parentManifestHash: childManifestHash,
  });

  await db.insert(containerSyncTombstones).values([
    {
      containerId: childContainerId,
      depth: 1,
      organizationId,
      parentId: actor.rootContainerId,
      reason: "access_revoked",
      updatedAt: STALE_TOMBSTONE_AT,
      userId: member.userId,
    },
    {
      containerId: grandchildContainerId,
      depth: 2,
      organizationId,
      parentId: childContainerId,
      reason: "access_revoked",
      updatedAt: STALE_TOMBSTONE_AT,
      userId: member.userId,
    },
  ]);

  await addUserToAdminGroup({ actor, member, organizationId });

  const remaining = await db
    .select({ id: containerSyncTombstones.id })
    .from(containerSyncTombstones)
    .where(eq(containerSyncTombstones.userId, member.userId));
  expect(remaining).toEqual([]);
});

test("prune tolerates user sets beyond a single chunk", async () => {
  const { close } = { close: async () => {} };
  try {
    // 2,500 synthetic users exercise the multi-chunk select path; none have
    // tombstones, so the prune is a structured no-op rather than one giant
    // IN clause.
    const userIds = Array.from({ length: 2500 }, () => crypto.randomUUID());
    await db.transaction(async (tx) => {
      await pruneRegainedAccessTombstones({ executor: tx, userIds });
    });
  } finally {
    await close();
  }
});
