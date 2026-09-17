import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifests,
  containerSyncTombstones,
  containers,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  readContainerParentLanePage,
  requestContainerParentLanes,
} from "../../../test/helpers/containerParentLaneQuery";
import {
  loadRegisteredContainerRoots,
  rootWatermark,
} from "../../../test/helpers/listContainerRoots";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("parent-lanes/query supports client-owned watermark resume", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const roots = await loadRegisteredContainerRoots(owner);

  const firstResponse = await requestContainerParentLanes(owner.token, [
    { laneId: "root", limit: 1, parentId: null },
  ]);
  expect(firstResponse.status).toBe(200);
  const firstBody = await readContainerParentLanePage(firstResponse, "root");
  expect(firstBody.items).toHaveLength(1);
  expect(firstBody.hasMore).toBe(true);
  expect(firstBody.items[0]?.id).toBe(roots[0]?.id);
  expect(firstBody.nextWatermark).toEqual(rootWatermark(roots[0]));
  const firstWatermark = firstBody.nextWatermark;
  if (!firstWatermark) {
    throw new Error("Expected a root lane watermark");
  }

  const secondResponse = await requestContainerParentLanes(owner.token, [
    {
      laneId: "root",
      limit: 1,
      parentId: null,
      watermark: firstWatermark,
    },
  ]);
  expect(secondResponse.status).toBe(200);
  const secondBody = await readContainerParentLanePage(secondResponse, "root");
  expect(secondBody).toEqual({
    hasMore: false,
    items: [expect.objectContaining({ id: roots[1]?.id, parentId: null })],
    nextWatermark: rootWatermark(roots[1]),
    tombstones: [],
  });
  const finalResponse = await requestContainerParentLanes(owner.token, [
    {
      laneId: "root",
      parentId: null,
      watermark: secondBody.nextWatermark,
    },
  ]);
  expect(finalResponse.status).toBe(200);
  expect(await readContainerParentLanePage(finalResponse, "root")).toEqual({
    hasMore: false,
    items: [],
    tombstones: [],
    nextWatermark: secondBody.nextWatermark,
  });
});

test("parent-lanes/query advances a lane watermark over filtered candidates", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const roots = await loadRegisteredContainerRoots(owner);
  const metadata = roots.find((root) => root.id !== owner.rootContainerId);
  if (!metadata) throw new Error("Expected the registered metadata root");
  await db
    .update(containers)
    .set({ updatedAt: new Date("2026-05-05T00:00:02.000Z") })
    .where(eq(containers.id, metadata.id));

  const [rootContainer] = await db
    .select({
      organizationId: containers.organizationId,
    })
    .from(containers)
    .where(eq(containers.id, owner.rootContainerId))
    .limit(1);
  if (!rootContainer) {
    throw new Error("Expected registered root container");
  }

  await db
    .update(containers)
    .set({ updatedAt: new Date("2026-05-05T00:00:00.000Z") })
    .where(eq(containers.id, owner.rootContainerId));

  const [rootManifest] = await db
    .select({ state: accessManifests.state })
    .from(accessManifests)
    .where(eq(accessManifests.objectId, owner.rootContainerId))
    .limit(1);
  if (!rootManifest) {
    throw new Error("Expected registered root access manifest");
  }

  await db
    .update(accessManifests)
    .set({
      state: {
        ...(rootManifest.state as Record<string, unknown>),
        metadataDocumentId: null,
      },
    })
    .where(eq(accessManifests.objectId, owner.rootContainerId));

  const tombstoneContainerId = crypto.randomUUID();
  await db.insert(containerSyncTombstones).values({
    containerId: tombstoneContainerId,
    depth: 0,
    organizationId: rootContainer.organizationId,
    parentId: null,
    reason: "deleted",
    updatedAt: new Date("2026-05-05T00:00:01.000Z"),
    userId: owner.userId,
  });

  const firstResponse = await requestContainerParentLanes(owner.token, [
    { laneId: "root", limit: 1, parentId: null },
  ]);
  expect(firstResponse.status).toBe(200);
  const firstBody = await readContainerParentLanePage(firstResponse, "root");
  expect(firstBody).toEqual({
    hasMore: true,
    items: [],
    nextWatermark: {
      id: owner.rootContainerId,
      updatedAt: "2026-05-05T00:00:00.000Z",
    },
    tombstones: [],
  });

  const secondResponse = await requestContainerParentLanes(owner.token, [
    {
      laneId: "root",
      limit: 1,
      parentId: null,
      watermark: firstBody.nextWatermark,
    },
  ]);
  expect(secondResponse.status).toBe(200);
  const secondBody = await readContainerParentLanePage(secondResponse, "root");
  expect(secondBody).toEqual({
    hasMore: true,
    items: [],
    nextWatermark: {
      id: tombstoneContainerId,
      updatedAt: "2026-05-05T00:00:01.000Z",
    },
    tombstones: [
      {
        containerId: tombstoneContainerId,
        depth: 0,
        parentId: null,
        reason: "deleted",
        updatedAt: "2026-05-05T00:00:01.000Z",
      },
    ],
  });
  const thirdResponse = await requestContainerParentLanes(owner.token, [
    {
      laneId: "root",
      limit: 1,
      parentId: null,
      watermark: secondBody.nextWatermark,
    },
  ]);
  expect(thirdResponse.status).toBe(200);
  expect(await readContainerParentLanePage(thirdResponse, "root")).toEqual({
    hasMore: false,
    items: [
      expect.objectContaining({
        id: metadata.id,
        parentId: null,
        systemSlot: metadata.systemSlot,
      }),
    ],
    nextWatermark: { id: metadata.id, updatedAt: "2026-05-05T00:00:02.000Z" },
    tombstones: [],
  });
});

test("parent-lanes/query rejects a malformed client watermark", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const malformedWatermarkResponse = await routeApp.request(
    "/containers/parent-lanes/query",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        lanes: [
          {
            laneId: "root",
            parentId: null,
            watermark: {
              id: owner.rootContainerId,
              updatedAt: "not-a-date",
            },
          },
        ],
      }),
    },
  );
  expect(malformedWatermarkResponse.status).toBe(400);
});
