import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  containerDocumentSyncTombstones,
  containers,
  documents,
  organizationRosterEntries,
  organizations,
} from "@tearleads/api-shared/schema";
import { toFingerprint } from "@tearleads/crypto";
import { createTestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  listContainerDocumentLane,
  listContainerDocumentPage,
  readContainerDocumentLaneResults,
  requestContainerDocumentLanes,
} from "../../../test/helpers/containerDocumentLaneQuery";
import { createCurrentDocumentProjection } from "../../../test/helpers/currentProtocolProjection";
import { registerUser } from "../../../test/helpers/registerUser";

async function getContainerOrganizationId(containerId: string) {
  const [container] = await db
    .select({ organizationId: containers.organizationId })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);

  invariant(container, "expected container row");
  return container.organizationId;
}

test("POST /containers/documents/query lists current manifest-linked documents", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const createdDocument = await createCurrentDocumentProjection({
    containerIds: [owner.rootContainerId],
    createdByFingerprint: await toFingerprint(owner.signing.signingPublicKey),
    epoch: 2,
    manifestHash: `document-manifest:${crypto.randomUUID()}`,
    organizationId: await getContainerOrganizationId(owner.rootContainerId),
  });

  expect(
    await listContainerDocumentPage(owner.token, {
      containerId: owner.rootContainerId,
    }),
  ).toEqual({
    hasMore: false,
    items: [
      expect.objectContaining({
        currentAccessEpoch: 2,
        currentAccessStateHash: createdDocument.manifestHash,
        id: createdDocument.id,
        linkedContainerIds: [owner.rootContainerId],
      }),
    ],
    nextWatermark: {
      id: createdDocument.id,
      updatedAt: expect.any(String),
    },
    tombstones: [],
  });
});

test("POST /containers/documents/query hides roster profile documents", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const profileDocument = await createCurrentDocumentProjection({
    containerIds: [owner.rootContainerId],
    createdByFingerprint: await toFingerprint(owner.signing.signingPublicKey),
    epoch: 1,
    manifestHash: `document-manifest:${crypto.randomUUID()}`,
    organizationId: await getContainerOrganizationId(owner.rootContainerId),
  });

  await db
    .update(organizationRosterEntries)
    .set({ profileDocumentId: profileDocument.id })
    .where(eq(organizationRosterEntries.userId, owner.userId));

  expect(
    await listContainerDocumentPage(owner.token, {
      containerId: owner.rootContainerId,
    }),
  ).toEqual({
    hasMore: false,
    items: [],
    nextWatermark: null,
    tombstones: [],
  });
});

test("POST /containers/documents/query serves the organization profile document", async () => {
  // The org profile document is intentionally NOT hidden (unlike roster profile
  // and container metadata documents): it lives in a Members-granted metadata
  // container and must reach active members so they can decrypt the org display
  // name. Serving it through generic discovery — gated by the container's own
  // read-access check — is how that happens.
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const profileDocument = await createCurrentDocumentProjection({
    containerIds: [owner.rootContainerId],
    createdByFingerprint: await toFingerprint(owner.signing.signingPublicKey),
    epoch: 1,
    manifestHash: `document-manifest:${crypto.randomUUID()}`,
    organizationId: await getContainerOrganizationId(owner.rootContainerId),
  });

  await db
    .update(organizations)
    .set({ profileDocumentId: profileDocument.id })
    .where(
      eq(
        organizations.id,
        await getContainerOrganizationId(owner.rootContainerId),
      ),
    );

  const page = await listContainerDocumentPage(owner.token, {
    containerId: owner.rootContainerId,
  });
  expect(page.items.map((item) => item.id)).toContain(profileDocument.id);
});

test("POST /containers/documents/query rejects users without manifest access", async () => {
  const owner = createTestUser();
  const otherUser = createTestUser();

  await registerUser(owner);
  await authenticate(owner);
  await registerUser(otherUser);
  await authenticate(otherUser);

  expect(
    await listContainerDocumentLane(otherUser.token, {
      containerId: owner.rootContainerId,
    }),
  ).toEqual({
    failure: { error: "Forbidden", status: 403 },
    laneId: "lane-0",
  });
});

test("POST /containers/documents/query supports watermark resume", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const organizationId = await getContainerOrganizationId(
    owner.rootContainerId,
  );
  const createdByFingerprint = await toFingerprint(
    owner.signing.signingPublicKey,
  );
  const olderUpdatedAt = new Date("2026-05-05T00:00:00.000Z");
  const newerUpdatedAt = new Date("2026-05-05T00:00:01.000Z");

  const olderDocument = await createCurrentDocumentProjection({
    containerIds: [owner.rootContainerId],
    createdByFingerprint,
    epoch: 1,
    manifestHash: `document-manifest:${crypto.randomUUID()}`,
    organizationId,
  });
  const newerDocument = await createCurrentDocumentProjection({
    containerIds: [owner.rootContainerId],
    createdByFingerprint,
    epoch: 2,
    manifestHash: `document-manifest:${crypto.randomUUID()}`,
    organizationId,
  });
  await db
    .update(documents)
    .set({ updatedAt: olderUpdatedAt })
    .where(eq(documents.id, olderDocument.id));
  await db
    .update(documents)
    .set({ updatedAt: newerUpdatedAt })
    .where(eq(documents.id, newerDocument.id));

  const firstBody = await listContainerDocumentPage(owner.token, {
    containerId: owner.rootContainerId,
    limit: 1,
  });
  expect(firstBody).toEqual({
    hasMore: true,
    items: [
      expect.objectContaining({
        id: olderDocument.id,
        updatedAt: olderUpdatedAt.toISOString(),
      }),
    ],
    nextWatermark: {
      id: olderDocument.id,
      updatedAt: olderUpdatedAt.toISOString(),
    },
    tombstones: [],
  });

  expect(
    await listContainerDocumentPage(owner.token, {
      containerId: owner.rootContainerId,
      watermark: firstBody.nextWatermark,
    }),
  ).toEqual({
    hasMore: false,
    items: [
      expect.objectContaining({
        id: newerDocument.id,
        updatedAt: newerUpdatedAt.toISOString(),
      }),
    ],
    nextWatermark: {
      id: newerDocument.id,
      updatedAt: newerUpdatedAt.toISOString(),
    },
    tombstones: [],
  });
});

test("POST /containers/documents/query returns unlink tombstones by watermark order", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const tombstoneUpdatedAt = new Date("2026-05-05T00:05:00.000Z");
  const tombstonedDocumentId = crypto.randomUUID();

  await db.insert(containerDocumentSyncTombstones).values({
    containerId: owner.rootContainerId,
    documentId: tombstonedDocumentId,
    updatedAt: tombstoneUpdatedAt,
  });

  expect(
    await listContainerDocumentPage(owner.token, {
      containerId: owner.rootContainerId,
    }),
  ).toEqual({
    hasMore: false,
    items: [],
    nextWatermark: {
      id: tombstonedDocumentId,
      updatedAt: tombstoneUpdatedAt.toISOString(),
    },
    tombstones: [
      {
        containerId: owner.rootContainerId,
        documentId: tombstonedDocumentId,
        updatedAt: tombstoneUpdatedAt.toISOString(),
      },
    ],
  });
});

test("POST /containers/documents/query rejects malformed watermarks", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const response = await requestContainerDocumentLanes(owner.token, [
    {
      containerId: owner.rootContainerId,
      watermark: { id: crypto.randomUUID(), updatedAt: "not-a-date" },
    },
  ]);

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid request" });
});

test("POST /containers/documents/query isolates each lane's access decision", async () => {
  const owner = createTestUser();
  const otherUser = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  await registerUser(otherUser);
  await authenticate(otherUser);
  const ownDocument = await createCurrentDocumentProjection({
    containerIds: [owner.rootContainerId],
    createdByFingerprint: await toFingerprint(owner.signing.signingPublicKey),
    epoch: 1,
    manifestHash: `document-manifest:${crypto.randomUUID()}`,
    organizationId: await getContainerOrganizationId(owner.rootContainerId),
  });
  const missingContainerId = crypto.randomUUID();

  const results = await readContainerDocumentLaneResults(
    await requestContainerDocumentLanes(owner.token, [
      { containerId: otherUser.rootContainerId, laneId: "foreign" },
      { containerId: missingContainerId, laneId: "missing" },
      { containerId: owner.rootContainerId, laneId: "own" },
    ]),
  );

  // Results keep request order; one rejected lane never hides the others.
  expect(results.map((result) => result.laneId)).toEqual([
    "foreign",
    "missing",
    "own",
  ]);
  expect(results[0]).toEqual({
    failure: { error: "Forbidden", status: 403 },
    laneId: "foreign",
  });
  expect(results[1]).toEqual({
    failure: {
      code: "container_not_found",
      error: expect.any(String),
      status: 404,
    },
    laneId: "missing",
  });
  const own = results[2];
  invariant(own && "page" in own, "expected the readable lane to list");
  expect(own.page.items.map((item) => item.id)).toEqual([ownDocument.id]);
});
