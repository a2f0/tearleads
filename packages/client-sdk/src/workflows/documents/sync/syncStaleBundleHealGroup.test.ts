import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  computeDocumentBaselineSegmentsDigest,
  computeDocumentContentRecordMetadataHash,
  verifyWriteHeader,
  type WriteHeader,
} from "@tearleads/crypto";
import {
  createDocument,
  exportFullHistoryIdentity,
  exportFullHistorySnapshot,
  getImportBlobMetadata,
  getTextValue,
  historySegmentsImportInOrder,
  importUpdates,
} from "@tearleads/loro";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  type DocumentOutgoingUpdate,
  type DocumentSyncRequest,
  isDocumentSyncRequest,
} from "@tearleads/validators/request";
import {
  createSyncResponse,
  writerKeyResolver,
} from "../../../../test/helpers/data/documentFixtures";
import { SMALL_BASELINE_SEGMENTS } from "../../../../test/helpers/data/rotationBaselineFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../../test/helpers/workflows/documentSync";
import { createLoroPendingUpdate } from "../../../../test/helpers/workflows/documentSyncFixtures";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import {
  createInterleavedHistoryDocument,
  createStaleBundleSyncFixture,
} from "../../../../test/helpers/workflows/staleBundleSyncFixture";
import { decryptDocumentSyncUpdates } from "../../../data/documents/shared/crypto";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { buildDocumentSyncPlan } from "../syncPlan/syncPlanIdentity";
import { buildMaterializedDocumentSyncPlan } from "../syncPlan/syncPlanMaterial";

let execSql: ExecSql;
let closeExecSql: () => void;

beforeEach(async () => {
  ({ close: closeExecSql, execSql } = await createTestExecSql(
    "document-sync-heal-group",
  ));
  await ensureDocumentTables(execSql);
});

afterEach(() => closeExecSql());

function headerOf(update: DocumentOutgoingUpdate): WriteHeader {
  return update.writeHeader as unknown as WriteHeader;
}

/**
 * A heal of a document whose history takes several segments at the small
 * test sizes, with `queuedTexts` as its queue of ordinary updates.
 */
async function planSegmentedHeal(name: string, queuedTexts: readonly string[]) {
  const fixture = await createStaleBundleSyncFixture();
  const document = await createInterleavedHistoryDocument(name);
  const pendingUpdates = await Promise.all(
    queuedTexts.map((text) =>
      createLoroPendingUpdate(text, crypto.randomUUID()),
    ),
  );
  const traceLines: string[] = [];
  const materialized = await buildMaterializedDocumentSyncPlan({
    author: fixture.author,
    buildRotationSnapshot: async () => exportFullHistorySnapshot(document),
    localVersionVector: null,
    onSyncTrace: (line) => traceLines.push(line),
    pendingUpdates,
    rotationBaselineSegmentSizes: SMALL_BASELINE_SEGMENTS,
    signedAt: "2026-07-26T00:00:00.000Z",
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.staleWriterProjection,
  });
  expect(materialized.healedStaleContentKeyBundle).toBe(true);
  const { outgoingUpdates } = materialized.plan.request;
  const segments = outgoingUpdates.slice(0, -pendingUpdates.length);
  expect(segments.length).toBeGreaterThan(2);
  return {
    document,
    fixture,
    healedEpoch: fixture.staleBundle.contentKeyEpoch + 1,
    materialized,
    pendingUpdates,
    queued: outgoingUpdates.slice(segments.length),
    segments,
    traceLines,
  };
}

test("a heal over a history past the segment target sends its baseline group first", async () => {
  const heal = await planSegmentedHeal("heal-group-order", [
    "first queued edit",
    "second queued edit",
  ]);
  const { segments } = heal;
  const { plan } = heal.materialized;
  const final = segments.length - 1;

  expect(isDocumentSyncRequest(plan.request)).toBe(true);
  // The whole group leads the request in index order. The queue follows it
  // in its own order, as ordinary updates.
  expect(heal.queued.map((update) => update.id)).toEqual(
    heal.pendingUpdates.map((update) => update.id),
  );
  for (const update of heal.queued) {
    expect(update.baselineId).toBeUndefined();
    expect(update.baselineSegmentIndex).toBeUndefined();
    expect(update.baselineSegmentCount).toBeUndefined();
  }
  expect(heal.materialized.rotationBaselineUpdateIds).toEqual(
    segments.map((segment) => segment.id),
  );
  // Every segment names the group and its place; only the final one seals.
  const baselineId = segments[0]?.baselineId ?? "";
  expect(baselineId).not.toBe("");
  expect(
    segments.map((segment) => [
      segment.baselineId,
      segment.baselineSegmentIndex,
      segment.baselineSegmentCount,
      segment.baselineSegmentsDigest === undefined,
    ]),
  ).toEqual(
    segments.map((_, index) => [
      baselineId,
      index,
      index === final ? segments.length : undefined,
      index !== final,
    ]),
  );
  // This device has recorded no processed cursor, so the group signs none.
  expect(segments[final]?.coversThroughUpdateId).toBeUndefined();
  // The declared ranges are gapless from zero, each depending only on
  // earlier segments.
  expect(historySegmentsImportInOrder(segments)).toBe(true);
  expect(heal.traceLines).toContain(
    `document sync heal planned document=${plan.documentId} fromEpoch=${heal.fixture.staleBundle.contentKeyEpoch} toEpoch=${heal.healedEpoch} updates=2 segments=${segments.length}`,
  );
});

test("a heal encrypts and signs each segment of its group under the fresh key", async () => {
  const heal = await planSegmentedHeal("heal-group-signing", ["queued edit"]);
  const { document, fixture, healedEpoch, materialized, segments } = heal;
  const { plan } = materialized;
  const staleProjection = fixture.staleWriterProjection;
  const baselineId = segments[0]?.baselineId ?? "";

  // The final segment's digest binds each earlier one's signed hashes.
  expect(segments.at(-1)?.baselineSegmentsDigest).toBe(
    await computeDocumentBaselineSegmentsDigest({
      baselineId,
      documentId: plan.documentId,
      segments: segments.slice(0, -1).map((segment) => ({
        ciphertextHash: headerOf(segment).ciphertextHash,
        metadataHash: headerOf(segment).metadataHash,
        updateId: segment.id,
      })),
    }),
  );
  // Each segment is an ordinary signed update of the healed epoch, with its
  // group fields in the metadata it signs.
  for (const segment of segments) {
    expect(headerOf(segment).contentKeyEpoch).toBe(healedEpoch);
    expect(headerOf(segment).metadataHash).toBe(
      await computeDocumentContentRecordMetadataHash({
        baselineId: segment.baselineId,
        baselineSegmentCount: segment.baselineSegmentCount,
        baselineSegmentIndex: segment.baselineSegmentIndex,
        baselineSegmentsDigest: segment.baselineSegmentsDigest,
        dependencyVersionVector: segment.dependencyVersionVector,
        documentId: plan.documentId,
        partialEndVersionVector: segment.partialEndVersionVector,
        partialStartVersionVector: segment.partialStartVersionVector,
        plaintextHash: segment.plaintextHash,
        updateId: segment.id,
      }),
    );
    // It is signed against the access boundary the heal moves to: the
    // current link set and the rotated key target.
    const verified = await verifyWriteHeader({
      expectedAccessManifestHash: staleProjection.documentManifest.manifestHash,
      expectedObject: {
        objectId: staleProjection.documentId,
        objectKind: "document",
        organizationId: fixture.author.organizationId,
      },
      expectedTargetHash:
        staleProjection.documentKekTargets.documentKeyTargetHash,
      header: headerOf(segment),
      writerPublicKey: fixture.signingPublicKey,
    });
    expect(verified.ok).toBe(true);
    expect(segment.encryptedData).toContain("tearleads.document.loro-update");
    expect(segment.encryptedData).not.toContain("writer round");
  }

  // A reader holding the fresh key decrypts update blobs, never a snapshot,
  // and importing them in order gives the history the heal's author holds.
  const served = await createSyncResponse(plan);
  const decrypted = await decryptDocumentSyncUpdates({
    contentKey: materialized.contentKey,
    contentKeyEpoch: healedEpoch,
    documentId: plan.documentId,
    organizationId: plan.organizationId,
    updates: served.updates.slice(0, segments.length),
  });
  expect(decrypted.map((segment) => segment.baselineId)).toEqual(
    segments.map(() => baselineId),
  );
  for (const segment of decrypted) {
    expect(getImportBlobMetadata(segment.updateData).mode).toBe("update");
  }
  const reader = await createDocument("heal-group-reader");
  importUpdates(
    reader,
    decrypted.map((segment) => segment.updateData),
  );
  expect(getTextValue(reader)).toBe(getTextValue(document));
  expect(exportFullHistoryIdentity(reader)).toBe(
    exportFullHistoryIdentity(document),
  );
});

// A segment is built for the request and matches no queue row, so its
// acknowledgement settles none. Each queued update settles its own row.
test("an acknowledged heal settles its queued updates and none of its segments", async () => {
  // The server marks the bundle stale; the container path itself is current,
  // so the pass verifies and records it as any sync does.
  const fixture = await createMaterializedSyncFixture();
  const staleProjection = {
    ...fixture.writerProjection,
    contentKeyBundleStale: true as const,
  };
  const document = await createInterleavedHistoryDocument("heal-group-settle");
  const pendingUpdates = [
    await createLoroPendingUpdate("first queued edit", crypto.randomUUID()),
    await createLoroPendingUpdate("second queued edit", crypto.randomUUID()),
  ];
  const submittedRequests: DocumentSyncRequest[] = [];
  const traceLines: string[] = [];

  const synced = await syncRemoteDocument({
    apiClient: createMockApiClient({
      getDocumentWriterProjection: async () => staleProjection,
      // Accepts the request and serves its updates back, as a pull does.
      syncDocument: async (documentId, request) => {
        submittedRequests.push(request);
        const plan = await buildDocumentSyncPlan({
          author: fixture.author,
          contentKeyBundle: staleProjection.contentKeyBundle,
          documentId,
          documentKekTargets: staleProjection.documentKekTargets,
          documentManifest: staleProjection.documentManifest,
          localVersionVector: null,
        });
        return createSyncResponse({ ...plan, request });
      },
    }),
    author: fixture.author,
    buildRotationSnapshot: async () => exportFullHistorySnapshot(document),
    documentId: staleProjection.documentId,
    execSql,
    localVersionVector: null,
    onSyncTrace: (line) => traceLines.push(line),
    pendingUpdates,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    resolveWriterPublicKey: writerKeyResolver(fixture),
    rotationBaselineSegmentSizes: SMALL_BASELINE_SEGMENTS,
    targetSecretKey: fixture.secretKey,
    writerProjection: staleProjection,
  });

  expect(submittedRequests).toHaveLength(1);
  const outgoing = submittedRequests[0]?.outgoingUpdates ?? [];
  const segments = outgoing.filter((update) => update.baselineId !== undefined);
  expect(segments.length).toBeGreaterThan(2);
  // Segments first, in index order, then the queue in its own order.
  expect(outgoing.map((update) => update.baselineSegmentIndex)).toEqual([
    ...segments.map((_, index) => index),
    undefined,
    undefined,
  ]);
  expect(outgoing.slice(segments.length).map((update) => update.id)).toEqual(
    pendingUpdates.map((update) => update.id),
  );
  if (!synced) throw new Error("Expected the heal to complete");
  expect(synced.acceptedRecoveryBaseline).toBe(true);
  expect(synced.settledPendingUpdateIds).toEqual(
    pendingUpdates.map((update) => update.id),
  );
  expect(synced.hasDeferredPendingUpdates).toBe(false);
  // The served group is whole, so it leaves no run for a next page.
  expect(synced.baselineGroupRun).toBeNull();
  expect(synced.voidedUpdates).toEqual([]);
  expect(synced.decryptedUpdates.map((update) => update.id)).toEqual(
    outgoing.map((update) => update.id),
  );
  const healedEpoch = staleProjection.contentKeyBundle.contentKeyEpoch + 1;
  expect(traceLines).toEqual([
    `document sync stale bundle document=${staleProjection.documentId} epoch=${healedEpoch - 1} pending=2`,
    `document sync heal planned document=${staleProjection.documentId} fromEpoch=${healedEpoch - 1} toEpoch=${healedEpoch} updates=2 segments=${segments.length}`,
    `document sync healed document=${staleProjection.documentId} epoch=${healedEpoch} accepted=${outgoing.length}`,
  ]);
});
