import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { db } from "../../adapters/postgres";
import { routeApp } from "../../routeApp";
import {
  accessManifests,
  containerSyncTombstones,
  containers,
} from "../../schema";

test("GET /containers returns the manifest-backed root container for the authenticated user", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const response = await routeApp.request("/containers", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${owner.token}`,
    },
  });

  expect(response.status).toBe(200);
  const listedContainers = await response.json();
  expect(listedContainers).toEqual({
    hasMore: false,
    items: [
      expect.objectContaining({
        depth: 0,
        id: owner.rootContainerId,
        parentId: null,
        metadataAccessEpoch: 1,
      }),
    ],
    nextWatermark: {
      id: owner.rootContainerId,
      updatedAt: expect.any(String),
    },
    tombstones: [],
  });
  expect(listedContainers.items).toEqual([
    expect.objectContaining({
      id: owner.rootContainerId,
    }),
  ]);
  expect(listedContainers.items[0]?.metadataAccessStateHash).toEqual(
    expect.any(String),
  );
  expect(listedContainers.items[0]?.metadataDocumentId).toEqual(
    expect.any(String),
  );
});

test("GET /containers only returns containers readable through current manifests", async () => {
  const owner = createTestUser();
  const otherUser = createTestUser();

  await registerUser(owner);
  await authenticate(owner);
  await registerUser(otherUser);
  await authenticate(otherUser);

  const response = await routeApp.request("/containers", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${otherUser.token}`,
    },
  });

  expect(response.status).toBe(200);
  const listedContainers = await response.json();
  expect(
    listedContainers.items.map((container: { id: string }) => container.id),
  ).toEqual([otherUser.rootContainerId]);
  expect(
    listedContainers.items.map((container: { id: string }) => container.id),
  ).not.toContain(owner.rootContainerId);
});

test("GET /containers without a depth filter includes accessible non-root depths", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  await db
    .update(containers)
    .set({ depth: 2 })
    .where(eq(containers.id, owner.rootContainerId));

  const depthResponse = await routeApp.request("/containers?depth=0", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${owner.token}`,
    },
  });
  expect(depthResponse.status).toBe(200);
  expect((await depthResponse.json()).items).toEqual([]);

  const allDepthResponse = await routeApp.request("/containers", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${owner.token}`,
    },
  });
  expect(allDepthResponse.status).toBe(200);
  expect(await allDepthResponse.json()).toEqual(
    expect.objectContaining({
      items: [
        expect.objectContaining({
          depth: 2,
          id: owner.rootContainerId,
        }),
      ],
    }),
  );
});

test("GET /containers supports client-owned watermark resume", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const firstResponse = await routeApp.request("/containers?depth=0&limit=1", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${owner.token}`,
    },
  });
  expect(firstResponse.status).toBe(200);
  const firstBody = await firstResponse.json();
  expect(firstBody.items).toHaveLength(1);
  expect(firstBody.nextWatermark).toEqual({
    id: owner.rootContainerId,
    updatedAt: expect.any(String),
  });

  const secondResponse = await routeApp.request(
    `/containers?depth=0&watermarkUpdatedAt=${encodeURIComponent(firstBody.nextWatermark.updatedAt)}&watermarkId=${encodeURIComponent(firstBody.nextWatermark.id)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );
  expect(secondResponse.status).toBe(200);
  expect(await secondResponse.json()).toEqual({
    hasMore: false,
    items: [],
    nextWatermark: firstBody.nextWatermark,
    tombstones: [],
  });

  const malformedWatermarkResponse = await routeApp.request(
    `/containers?depth=0&watermarkUpdatedAt=not-a-date&watermarkId=${encodeURIComponent(firstBody.nextWatermark.id)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );
  expect(malformedWatermarkResponse.status).toBe(400);
});

test("GET /containers advances the watermark over filtered page candidates", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

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

  const firstResponse = await routeApp.request("/containers?limit=1", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${owner.token}`,
    },
  });
  expect(firstResponse.status).toBe(200);
  const firstBody = await firstResponse.json();
  expect(firstBody).toEqual({
    hasMore: true,
    items: [],
    nextWatermark: {
      id: owner.rootContainerId,
      updatedAt: "2026-05-05T00:00:00.000Z",
    },
    tombstones: [],
  });

  const secondResponse = await routeApp.request(
    `/containers?limit=1&watermarkUpdatedAt=${encodeURIComponent(firstBody.nextWatermark.updatedAt)}&watermarkId=${encodeURIComponent(firstBody.nextWatermark.id)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );
  expect(secondResponse.status).toBe(200);
  expect(await secondResponse.json()).toEqual({
    hasMore: false,
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
});
