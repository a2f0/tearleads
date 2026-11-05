import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { accessEvents } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import {
  isDocumentPurgeProofResponse,
  isDocumentPurgeResponse,
} from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { postDocumentPurge } from "../../../test/helpers/documentPurge";
import {
  countDocumentRows,
  countTombstones,
} from "../../../test/helpers/documentPurgeFootprint";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerAndAuthenticate } from "../../../test/helpers/registerUser";
import { createFailingRuntime } from "../../../test/helpers/serviceRuntime";
import { createRouteApp, routeApp } from "../../routeApp";

test("document purge succeeds when event publication fails", async () => {
  const owner = createTestUser();
  const publishedEvents: Array<Record<string, unknown>> = [];
  const app = createRouteApp({
    runtime: createFailingRuntime((event) => publishedEvents.push(event)),
  });
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  const before = await countDocumentRows(created.id);
  expect(before.documents).toBe(1);
  expect(before.currentDocumentLinks).toBe(1);
  expect(before.accessManifests).toBeGreaterThan(0);
  expect(before.accessEvents).toBeGreaterThan(0);
  expect(before.documentContentKeyEpochs).toBeGreaterThan(0);
  expect(before.documentContentKeyTargets).toBeGreaterThan(0);
  expect(before.accessManifestDocumentLinkProjection).toBeGreaterThan(0);

  const response = await postDocumentPurge({
    app,
    documentId: created.id,
    documentManifestHash: created.manifestHash,
    owner,
    root,
    token: owner.token,
  });

  expect(response.status).toBe(200);
  const purged = await response.json();
  expect(isDocumentPurgeResponse(purged)).toBe(true);
  expect(purged.documentId).toBe(created.id);
  expect(typeof purged.purgedAt).toBe("string");
  expect(new Date(purged.purgedAt).toISOString()).toBe(purged.purgedAt);
  expect(purged.reclaimedBlobStorageKeys).toEqual([]);
  expect(publishedEvents).toHaveLength(1);

  const proofResponse = await app.request(`/documents/${created.id}/purge`, {
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  expect(proofResponse.status).toBe(200);
  const proof = await proofResponse.json();
  expect(isDocumentPurgeProofResponse(proof)).toBe(true);
  expect(proof).toMatchObject({
    documentId: created.id,
    documentManifest: {
      manifestHash: created.manifestHash,
    },
    purgeEvent: purged.purgeEvent,
  });
  // The retained purge event keeps its signed dependency citation.
  expect(
    await db
      .select({
        dependencyManifestHashes: accessEvents.dependencyManifestHashes,
      })
      .from(accessEvents)
      .where(eq(accessEvents.eventHash, purged.purgeEvent.eventHash)),
  ).toEqual([{ dependencyManifestHashes: [root.bundle.manifestHash] }]);

  const after = await countDocumentRows(created.id);
  expect(after).toEqual({
    accessEvents: 2,
    accessManifestDocumentLinkProjection: 1,
    accessManifestHeads: 0,
    accessManifests: 1,
    currentDocumentLinks: 0,
    documentContentKeyEpochs: 0,
    documentContentKeyTargets: 0,
    documentContentWriteHeaders: 0,
    documentUpdates: 0,
    documents: 0,
  });

  expect(
    await countTombstones({
      containerId: root.kekState.containerId,
      documentId: created.id,
    }),
  ).toBe(1);
});

test("purge proof retrieval rejects a database-tampered terminal event", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const purgeResponse = await postDocumentPurge({
    documentId: created.id,
    documentManifestHash: created.manifestHash,
    owner,
    root,
    token: owner.token,
  });
  expect(purgeResponse.status).toBe(200);

  await db
    .update(accessEvents)
    .set({
      body: {
        containerId: root.kekState.containerId,
        containerManifestHash: root.bundle.manifestHash,
        documentManifestHash: "f".repeat(64),
        eventType: "document.purge",
      },
    })
    .where(
      and(
        eq(accessEvents.eventType, "document.purge"),
        eq(accessEvents.objectId, created.id),
      ),
    );

  const proofResponse = await routeApp.request(
    `/documents/${created.id}/purge`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  expect(proofResponse.status).not.toBe(200);
  expect(await proofResponse.json()).toEqual({
    error: "access event body hash does not match body",
  });
});
