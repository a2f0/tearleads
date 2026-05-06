import { expect, test } from "bun:test";
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
import { registerUser } from "../../../test/helpers/registerUser";
import { storeVerifiedAccessManifest } from "../../access/write/accessManifestStore";
import { db } from "../../adapters/postgres";
import { routeApp } from "../../routeApp";
import {
  accessManifestHeads,
  accessManifests,
  containerSyncTombstones,
  containers,
} from "../../schema";

const SIGNED_AT = "2026-05-05T00:00:00.000Z";

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
    dependencyManifestHashes: [],
    bodyHash: await computeAccessEventBodyHash(
      input.body as unknown as KeyingCanonicalJson,
    ),
    signerUserId: input.signerUserId,
    signerDeviceId: `signing-key:${input.signerKeyFingerprint}`,
    signerKeyFingerprint: input.signerKeyFingerprint,
    signedAt: SIGNED_AT,
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

test("GET /containers treats missing parentId as the root discovery lane", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const explicitRootResponse = await routeApp.request(
    "/containers?parentId=null",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );
  expect(explicitRootResponse.status).toBe(200);

  const defaultRootResponse = await routeApp.request("/containers", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${owner.token}`,
    },
  });
  expect(defaultRootResponse.status).toBe(200);
  expect(await defaultRootResponse.json()).toEqual(
    await explicitRootResponse.json(),
  );
});

test("GET /containers lists inherited children in the requested parent lane", async () => {
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

  const rootLaneResponse = await routeApp.request("/containers?parentId=null", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${owner.token}`,
    },
  });
  expect(rootLaneResponse.status).toBe(200);
  expect(
    (await rootLaneResponse.json()).items.map(
      (container: { id: string }) => container.id,
    ),
  ).toEqual([owner.rootContainerId]);

  const childLaneResponse = await routeApp.request(
    `/containers?parentId=${owner.rootContainerId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );
  expect(childLaneResponse.status).toBe(200);
  expect(await childLaneResponse.json()).toEqual(
    expect.objectContaining({
      items: [
        expect.objectContaining({
          depth: 1,
          id: childContainerId,
          metadataDocumentId: childMetadataDocumentId,
          parentId: owner.rootContainerId,
        }),
      ],
    }),
  );
});

test("GET /containers root discovery includes directly granted non-root containers", async () => {
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

  const response = await routeApp.request("/containers?parentId=null", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${recipient.token}`,
    },
  });
  expect(response.status).toBe(200);
  const body = await response.json();
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

test("GET /containers rejects malformed parent lanes", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const response = await routeApp.request("/containers?parentId=not-a-uuid", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${owner.token}`,
    },
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid parentId" });
});

test("GET /containers supports client-owned watermark resume", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const firstResponse = await routeApp.request(
    "/containers?parentId=null&limit=1",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );
  expect(firstResponse.status).toBe(200);
  const firstBody = await firstResponse.json();
  expect(firstBody.items).toHaveLength(1);
  expect(firstBody.nextWatermark).toEqual({
    id: owner.rootContainerId,
    updatedAt: expect.any(String),
  });

  const secondResponse = await routeApp.request(
    `/containers?parentId=null&watermarkUpdatedAt=${encodeURIComponent(firstBody.nextWatermark.updatedAt)}&watermarkId=${encodeURIComponent(firstBody.nextWatermark.id)}`,
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
    `/containers?parentId=null&watermarkUpdatedAt=not-a-date&watermarkId=${encodeURIComponent(firstBody.nextWatermark.id)}`,
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

  const firstResponse = await routeApp.request(
    "/containers?parentId=null&limit=1",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );
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
    `/containers?parentId=null&limit=1&watermarkUpdatedAt=${encodeURIComponent(firstBody.nextWatermark.updatedAt)}&watermarkId=${encodeURIComponent(firstBody.nextWatermark.id)}`,
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

test("GET /containers exposes non-root tombstones from root discovery and parent lanes", async () => {
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
  await db.insert(containerSyncTombstones).values({
    containerId: tombstoneContainerId,
    depth: 1,
    organizationId: rootContainer.organizationId,
    parentId: owner.rootContainerId,
    reason: "access_revoked",
    updatedAt: new Date("2026-05-05T00:00:01.000Z"),
    userId: owner.userId,
  });

  const rootLaneResponse = await routeApp.request("/containers?parentId=null", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${owner.token}`,
    },
  });
  expect(rootLaneResponse.status).toBe(200);
  expect((await rootLaneResponse.json()).tombstones).toContainEqual({
    containerId: tombstoneContainerId,
    depth: 1,
    parentId: owner.rootContainerId,
    reason: "access_revoked",
    updatedAt: "2026-05-05T00:00:01.000Z",
  });

  const parentLaneResponse = await routeApp.request(
    `/containers?parentId=${owner.rootContainerId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );
  expect(parentLaneResponse.status).toBe(200);
  expect((await parentLaneResponse.json()).tombstones).toContainEqual({
    containerId: tombstoneContainerId,
    depth: 1,
    parentId: owner.rootContainerId,
    reason: "access_revoked",
    updatedAt: "2026-05-05T00:00:01.000Z",
  });
});
