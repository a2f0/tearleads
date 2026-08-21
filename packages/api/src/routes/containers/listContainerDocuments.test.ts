import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import {
  containerDocumentSyncTombstones,
  containers,
  documents,
  organizationRosterEntries,
  organizations,
} from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { toFingerprint } from "@symcrypt/crypto";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { createCurrentDocumentProjection } from "../../../test/helpers/currentProtocolProjection";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

async function getContainerOrganizationId(containerId: string) {
  const [container] = await db
    .select({ organizationId: containers.organizationId })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);

  invariant(container, "expected container row");
  return container.organizationId;
}

async function listContainerDocumentsForUser(input: {
  readonly containerId: string;
  readonly limit?: number;
  readonly token: string;
  readonly watermark?: { id: string; updatedAt: string } | null;
}) {
  const searchParams = new URLSearchParams();
  if (input.limit !== undefined) {
    searchParams.set("limit", String(input.limit));
  }
  if (input.watermark) {
    searchParams.set("watermarkUpdatedAt", input.watermark.updatedAt);
    searchParams.set("watermarkId", input.watermark.id);
  }

  const query = searchParams.toString();
  return routeApp.request(
    `/containers/${input.containerId}/documents${query ? `?${query}` : ""}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.token}`,
      },
    },
  );
}

test("GET /containers/:containerId/documents lists current manifest-linked documents", async () => {
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

  const response = await routeApp.request(
    `/containers/${owner.rootContainerId}/documents`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
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

test("GET /containers/:containerId/documents hides roster profile documents", async () => {
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

  const response = await listContainerDocumentsForUser({
    containerId: owner.rootContainerId,
    token: owner.token,
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    hasMore: false,
    items: [],
    nextWatermark: null,
    tombstones: [],
  });
});

test("GET /containers/:containerId/documents serves the organization profile document", async () => {
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

  const response = await listContainerDocumentsForUser({
    containerId: owner.rootContainerId,
    token: owner.token,
  });

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.items.map((item: { id: string }) => item.id)).toContain(
    profileDocument.id,
  );
});

test("GET /containers/:containerId/documents rejects users without manifest access", async () => {
  const owner = createTestUser();
  const otherUser = createTestUser();

  await registerUser(owner);
  await authenticate(owner);
  await registerUser(otherUser);
  await authenticate(otherUser);

  const response = await routeApp.request(
    `/containers/${owner.rootContainerId}/documents`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${otherUser.token}`,
      },
    },
  );

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "Forbidden" });
});

test("GET /containers/:containerId/documents supports watermark resume", async () => {
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

  const firstResponse = await listContainerDocumentsForUser({
    containerId: owner.rootContainerId,
    limit: 1,
    token: owner.token,
  });
  expect(firstResponse.status).toBe(200);
  const firstBody = await firstResponse.json();
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

  const secondResponse = await listContainerDocumentsForUser({
    containerId: owner.rootContainerId,
    token: owner.token,
    watermark: firstBody.nextWatermark,
  });
  expect(secondResponse.status).toBe(200);
  expect(await secondResponse.json()).toEqual({
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

test("GET /containers/:containerId/documents returns unlink tombstones by watermark order", async () => {
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

  const response = await listContainerDocumentsForUser({
    containerId: owner.rootContainerId,
    token: owner.token,
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
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

test("GET /containers/:containerId/documents rejects malformed watermarks", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const response = await routeApp.request(
    `/containers/${owner.rootContainerId}/documents?watermarkUpdatedAt=not-a-date&watermarkId=${crypto.randomUUID()}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid watermark" });
});
