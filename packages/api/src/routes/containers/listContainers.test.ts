import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  accessManifests,
  containerSyncTombstones,
  containers,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  type AccessEvent,
  type ContainerAccessManifestState,
  type ContainerCreateAccessEventBody,
  computeAccessEventBodyHash,
  computeAccessEventHash,
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  type KeyingCanonicalJson,
  signAccessEvent,
  type UnsignedAccessEvent,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  readContainerParentLanePage,
  requestContainerParentLanes,
} from "../../../test/helpers/containerParentLaneQuery";
import { registerUser } from "../../../test/helpers/registerUser";
import { storeVerifiedAccessManifest } from "../../access/write/accessManifestStore";
import { routeApp } from "../../routeApp";

const AT = "2026-05-05T00:00:00.000Z";
const CONTACTS_SLOT = "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

async function signContainerEvent(input: {
  body: ContainerCreateAccessEventBody;
  containerId: string;
  organizationId: string;
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  signerUserId: string;
}): Promise<{ event: AccessEvent; eventHash: string }> {
  const unsigned: UnsignedAccessEvent = {
    version: 1,
    eventId: crypto.randomUUID(),
    eventType: "container.create",
    objectKind: "container",
    objectId: input.containerId,
    organizationId: input.organizationId,
    previousManifestHash: null,
    dependencyManifestHashes: [input.body.parentManifestHash as string],
    bodyHash: await computeAccessEventBodyHash(
      input.body as unknown as KeyingCanonicalJson,
    ),
    signerUserId: input.signerUserId,
    signerDeviceId: `signing-key:${input.signerKeyFingerprint}`,
    signerKeyFingerprint: input.signerKeyFingerprint,
    signedAt: AT,
  };
  const event = await signAccessEvent(unsigned, input.signerPrivateKey);

  return {
    event,
    eventHash: await computeAccessEventHash(event),
  };
}

async function storeChildContainerAccessManifest(input: {
  childContainerId: string;
  directGrants?: ContainerCreateAccessEventBody["directGrants"];
  metadataDocumentId: string;
  organizationId: string;
  owner: ReturnType<typeof createTestUser>;
  parentContainerId: string;
  parentManifestHash: string;
}) {
  const containerKeyEpochId = crypto.randomUUID();
  const body: ContainerCreateAccessEventBody = {
    eventType: "container.create",
    parentContainerId: input.parentContainerId,
    parentManifestHash: input.parentManifestHash,
    metadataDocumentId: input.metadataDocumentId,
    containerKeyEpochId,
    directGrants: input.directGrants ?? [],
    referencedPrincipalHeads: [],
  };
  const { event, eventHash } = await signContainerEvent({
    body,
    containerId: input.childContainerId,
    organizationId: input.organizationId,
    signerKeyFingerprint: input.owner.fingerprint,
    signerPrivateKey: input.owner.signing.signingPrivateKey,
    signerUserId: input.owner.userId,
  });
  const state: ContainerAccessManifestState = {
    version: 1,
    containerId: input.childContainerId,
    organizationId: input.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash,
    parentContainerId: input.parentContainerId,
    parentManifestHash: input.parentManifestHash,
    metadataDocumentId: input.metadataDocumentId,
    containerKeyEpochId,
    directGrants: body.directGrants,
    referencedPrincipalHeads: body.referencedPrincipalHeads,
  };
  const manifest = await deriveContainerAccessManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const verifiedManifest: VerifiedContainerAccessManifest = {
    event: {
      event,
      body: body as unknown as KeyingCanonicalJson,
      eventHash,
    },
    manifest,
    manifestHash,
    state,
  } as VerifiedContainerAccessManifest;

  await storeVerifiedAccessManifest({ verifiedManifest }, db);
}

test("POST parent-lanes/query returns the manifest-backed root lane", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const response = await requestContainerParentLanes(owner.token, [
    { laneId: "root", parentId: null },
  ]);

  expect(response.status).toBe(200);
  const responseBody = await response.json();
  expect(
    responseBody.results.map((result: { laneId: string }) => result.laneId),
  ).toEqual(["root"]);
  const listedContainers = responseBody.results[0]?.page;
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

test("parent-lanes/query only returns containers readable through current manifests", async () => {
  const owner = createTestUser();
  const otherUser = createTestUser();

  await registerUser(owner);
  await authenticate(owner);
  await registerUser(otherUser);
  await authenticate(otherUser);

  const response = await requestContainerParentLanes(otherUser.token, [
    { laneId: "root", parentId: null },
  ]);

  expect(response.status).toBe(200);
  const listedContainers = await readContainerParentLanePage(response, "root");
  expect(
    listedContainers.items.map((container: { id: string }) => container.id),
  ).toEqual([otherUser.rootContainerId]);
  expect(
    listedContainers.items.map((container: { id: string }) => container.id),
  ).not.toContain(owner.rootContainerId);
});

test("parent-lanes/query keeps root and child lane pages independent", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const [rootContainer] = await db
    .select({ organizationId: containers.organizationId })
    .from(containers)
    .where(eq(containers.id, owner.rootContainerId))
    .limit(1);
  const [rootHead] = await db
    .select({ manifestHash: accessManifestHeads.manifestHash })
    .from(accessManifestHeads)
    .where(eq(accessManifestHeads.objectId, owner.rootContainerId))
    .limit(1);
  if (!rootContainer || !rootHead) {
    throw new Error("Expected registered root container");
  }

  const childContainerId = crypto.randomUUID();
  const childMetadataDocumentId = crypto.randomUUID();
  await db.insert(containers).values({
    systemSlot: CONTACTS_SLOT,
    depth: 1,
    id: childContainerId,
    organizationId: rootContainer.organizationId,
    parentId: owner.rootContainerId,
  });
  await storeChildContainerAccessManifest({
    childContainerId,
    metadataDocumentId: childMetadataDocumentId,
    organizationId: rootContainer.organizationId,
    owner,
    parentContainerId: owner.rootContainerId,
    parentManifestHash: rootHead.manifestHash,
  });

  const response = await requestContainerParentLanes(owner.token, [
    { laneId: "root", parentId: null },
    { laneId: "root-children", parentId: owner.rootContainerId },
  ]);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(
    body.results.map((result: { laneId: string }) => result.laneId),
  ).toEqual(["root", "root-children"]);
  const rootLanePage = body.results[0]?.page;
  expect(
    rootLanePage.items.map((container: { id: string }) => container.id),
  ).toEqual([owner.rootContainerId]);

  expect(body.results[1]?.page).toEqual(
    expect.objectContaining({
      items: [
        expect.objectContaining({
          depth: 1,
          systemSlot: CONTACTS_SLOT,
          id: childContainerId,
          metadataDocumentId: childMetadataDocumentId,
          parentId: owner.rootContainerId,
        }),
      ],
    }),
  );
});

test("root parent lane includes directly granted non-root containers", async () => {
  const owner = createTestUser();
  const recipient = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  await registerUser(recipient);
  await authenticate(recipient);

  const [rootContainer] = await db
    .select({ organizationId: containers.organizationId })
    .from(containers)
    .where(eq(containers.id, owner.rootContainerId))
    .limit(1);
  const [rootHead] = await db
    .select({ manifestHash: accessManifestHeads.manifestHash })
    .from(accessManifestHeads)
    .where(eq(accessManifestHeads.objectId, owner.rootContainerId))
    .limit(1);
  if (!rootContainer || !rootHead) {
    throw new Error("Expected registered root container");
  }

  const childContainerId = crypto.randomUUID();
  const childMetadataDocumentId = crypto.randomUUID();
  await db.insert(containers).values({
    depth: 1,
    id: childContainerId,
    organizationId: rootContainer.organizationId,
    parentId: owner.rootContainerId,
  });
  await storeChildContainerAccessManifest({
    childContainerId,
    directGrants: [
      {
        accessLevel: "read",
        subjectId: recipient.userId,
        subjectType: "user",
      },
    ],
    metadataDocumentId: childMetadataDocumentId,
    organizationId: rootContainer.organizationId,
    owner,
    parentContainerId: owner.rootContainerId,
    parentManifestHash: rootHead.manifestHash,
  });

  const response = await requestContainerParentLanes(recipient.token, [
    { laneId: "root", parentId: null },
  ]);
  expect(response.status).toBe(200);
  const body = await readContainerParentLanePage(response, "root");
  expect(
    body.items.map((container: { id: string }) => container.id),
  ).not.toContain(owner.rootContainerId);
  expect(body).toEqual(
    expect.objectContaining({
      items: expect.arrayContaining([
        expect.objectContaining({
          depth: 1,
          id: childContainerId,
          metadataDocumentId: childMetadataDocumentId,
          parentId: owner.rootContainerId,
        }),
      ]),
    }),
  );
});

test("parent-lanes/query supports client-owned watermark resume", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const firstResponse = await requestContainerParentLanes(owner.token, [
    { laneId: "root", limit: 1, parentId: null },
  ]);
  expect(firstResponse.status).toBe(200);
  const firstBody = await readContainerParentLanePage(firstResponse, "root");
  expect(firstBody.items).toHaveLength(1);
  expect(firstBody.nextWatermark).toEqual({
    id: owner.rootContainerId,
    updatedAt: expect.any(String),
  });
  const firstWatermark = firstBody.nextWatermark;
  if (!firstWatermark) {
    throw new Error("Expected a root lane watermark");
  }

  const secondResponse = await requestContainerParentLanes(owner.token, [
    {
      laneId: "root",
      parentId: null,
      watermark: firstWatermark,
    },
  ]);
  expect(secondResponse.status).toBe(200);
  expect(await readContainerParentLanePage(secondResponse, "root")).toEqual({
    hasMore: false,
    items: [],
    nextWatermark: firstWatermark,
    tombstones: [],
  });

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
              id: firstWatermark.id,
              updatedAt: "not-a-date",
            },
          },
        ],
      }),
    },
  );
  expect(malformedWatermarkResponse.status).toBe(400);
});

test("parent-lanes/query advances a lane watermark over filtered candidates", async () => {
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
  expect(await readContainerParentLanePage(secondResponse, "root")).toEqual({
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

test("parent-lanes/query keeps root and child tombstones scoped per result", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const [rootContainer] = await db
    .select({ organizationId: containers.organizationId })
    .from(containers)
    .where(eq(containers.id, owner.rootContainerId))
    .limit(1);
  if (!rootContainer) {
    throw new Error("Expected registered root container");
  }

  const tombstoneContainerId = crypto.randomUUID();
  const parentOnlyTombstoneContainerId = crypto.randomUUID();
  await db.insert(containerSyncTombstones).values([
    {
      containerId: tombstoneContainerId,
      depth: 1,
      organizationId: rootContainer.organizationId,
      parentId: owner.rootContainerId,
      reason: "access_revoked",
      rootDiscoveryVisible: true,
      updatedAt: new Date("2026-05-05T00:00:01.000Z"),
      userId: owner.userId,
    },
    {
      containerId: parentOnlyTombstoneContainerId,
      depth: 1,
      organizationId: rootContainer.organizationId,
      parentId: owner.rootContainerId,
      reason: "access_revoked",
      rootDiscoveryVisible: false,
      updatedAt: new Date("2026-05-05T00:00:02.000Z"),
      userId: owner.userId,
    },
  ]);

  const response = await requestContainerParentLanes(owner.token, [
    { laneId: "root", parentId: null },
    { laneId: "root-children", parentId: owner.rootContainerId },
  ]);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(
    body.results.map((result: { laneId: string }) => result.laneId),
  ).toEqual(["root", "root-children"]);
  const rootLaneBody = body.results[0]?.page;
  expect(rootLaneBody.tombstones).toContainEqual({
    containerId: tombstoneContainerId,
    depth: 1,
    parentId: owner.rootContainerId,
    reason: "access_revoked",
    updatedAt: "2026-05-05T00:00:01.000Z",
  });
  expect(rootLaneBody.tombstones).not.toContainEqual({
    containerId: parentOnlyTombstoneContainerId,
    depth: 1,
    parentId: owner.rootContainerId,
    reason: "access_revoked",
    updatedAt: "2026-05-05T00:00:02.000Z",
  });

  const parentLaneBody = body.results[1]?.page;
  expect(parentLaneBody.tombstones).toContainEqual({
    containerId: tombstoneContainerId,
    depth: 1,
    parentId: owner.rootContainerId,
    reason: "access_revoked",
    updatedAt: "2026-05-05T00:00:01.000Z",
  });
  expect(parentLaneBody.tombstones).toContainEqual({
    containerId: parentOnlyTombstoneContainerId,
    depth: 1,
    parentId: owner.rootContainerId,
    reason: "access_revoked",
    updatedAt: "2026-05-05T00:00:02.000Z",
  });
});
