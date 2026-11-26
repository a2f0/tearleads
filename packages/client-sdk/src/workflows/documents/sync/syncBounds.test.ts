import { afterEach, beforeEach, expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  exportAllUpdates,
  exportFullHistorySnapshot,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import {
  createMockApiClient,
  createMockRequestFailure,
  createTestExecSql,
} from "@tearleads/test-utils";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import {
  MAX_DOCUMENT_SYNC_OUTGOING_UPDATES,
  MAX_DOCUMENT_SYNC_REQUEST_BYTES,
} from "@tearleads/validators/util";
import {
  createPendingUpdateRecord,
  createSyncResponse,
  writerKeyResolver,
} from "../../../../test/helpers/data/documentFixtures";
import { SMALL_BASELINE_SEGMENTS } from "../../../../test/helpers/data/rotationBaselineFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../../test/helpers/workflows/documentSync";
import { createLoroPendingUpdate } from "../../../../test/helpers/workflows/documentSyncFixtures";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import {
  rotationBaselineDataCharacters,
  segmentRotationSnapshot,
} from "../../../../test/helpers/workflows/rotationBaselineGroup";
import { createStagedHealHarness } from "../../../../test/helpers/workflows/stagedBaselineHeal";
import {
  createInterleavedHistoryDocument,
  createStaleBundleSyncFixture,
} from "../../../../test/helpers/workflows/staleBundleSyncFixture";
import type { DocumentSyncSubmitFailure } from "../../../data/documents/shared/sync/syncSubmitFailure";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { buildDocumentSyncPlan } from "../syncPlan/syncPlanIdentity";
import { buildMaterializedDocumentSyncPlan } from "../syncPlan/syncPlanMaterial";

let execSql: ExecSql;
let closeExecSql: () => void;

beforeEach(async () => {
  ({ close: closeExecSql, execSql } = await createTestExecSql(
    "document-sync-bounds",
  ));
  await ensureDocumentTables(execSql);
});

afterEach(() => closeExecSql());

test("conflict recovery re-keys only updates submitted by a bounded request", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const pendingUpdates = Array.from({ length: 65 }, (_, index) =>
    createPendingUpdateRecord({
      id: `550e8400-e29b-41d4-a716-${String(index).padStart(12, "0")}`,
    }),
  );
  const submittedIds: string[] = [];
  const rekeyedIds: string[] = [];
  let submitCount = 0;

  const synced = await syncRemoteDocument({
    apiClient: createMockApiClient({
      getDocumentWriterProjection: async () => writerProjection,
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to handle recovery");
      },
      syncDocumentResult: async (documentId, request) => {
        submitCount += 1;
        if (submitCount === 1) {
          submittedIds.push(...request.outgoingUpdates.map(({ id }) => id));
          return createMockRequestFailure({
            code: DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
            message: `POST /documents/${documentId}/sync: 409 Conflict: Document update id conflict`,
            status: 409,
          });
        }

        const readPlan = await buildMaterializedDocumentSyncPlan({
          author,
          execSql,
          localVersionVector: null,
          pendingUpdates: [],
          resolveProjectionUserKey,
          targetSecretKey: secretKey,
          writerProjection,
        });
        return {
          data: await createSyncResponse(
            { ...readPlan.plan, documentId, request },
            { acceptedOutgoingUpdateIds: [], updates: [] },
          ),
          ok: true,
        };
      },
    }),
    author,
    documentId: writerProjection.documentId,
    execSql,
    localVersionVector: null,
    pendingUpdates,
    rekeyPendingUpdate: async (_execSql, id) => {
      rekeyedIds.push(id);
      return crypto.randomUUID();
    },
    resolveProjectionUserKey,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
    targetSecretKey: secretKey,
  });

  expect(submittedIds).toHaveLength(64);
  expect(rekeyedIds).toEqual(submittedIds);
  expect(rekeyedIds).not.toContain(pendingUpdates[64]?.id);
  expect(synced?.rekeyedPendingUpdateIds).toHaveLength(64);
  expect(synced?.hasDeferredPendingUpdates).toBe(true);
});

// A heal's baseline goes whole or the heal does not go, so the group takes
// its places in the request first and the queue fills what is left.
test("a heal's baseline group takes its room ahead of a full queue", async () => {
  const fixture = await createStaleBundleSyncFixture();
  const document = await createInterleavedHistoryDocument("full-queue-heal");
  const queuedEdit = await createLoroPendingUpdate("queued behind the heal");
  const pendingUpdates = Array.from(
    { length: MAX_DOCUMENT_SYNC_OUTGOING_UPDATES },
    (_, index) => ({
      ...queuedEdit,
      id: `550e8400-e29b-41d4-a716-${String(index).padStart(12, "0")}`,
    }),
  );

  const materialized = await buildMaterializedDocumentSyncPlan({
    author: fixture.author,
    buildRotationSnapshot: async () => exportFullHistorySnapshot(document),
    localVersionVector: null,
    pendingUpdates,
    rotationBaselineSegmentSizes: SMALL_BASELINE_SEGMENTS,
    signedAt: "2026-07-26T00:00:00.000Z",
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.staleWriterProjection,
  });

  const segmentIds = materialized.rotationBaselineUpdateIds ?? [];
  expect(segmentIds.length).toBeGreaterThan(2);
  const queuedCount = MAX_DOCUMENT_SYNC_OUTGOING_UPDATES - segmentIds.length;
  const { outgoingUpdates } = materialized.plan.request;
  expect(outgoingUpdates.map(({ id }) => id)).toEqual([
    ...segmentIds,
    ...pendingUpdates.slice(0, queuedCount).map(({ id }) => id),
  ]);
  expect(
    outgoingUpdates.map(({ baselineSegmentIndex }) => baselineSegmentIndex),
  ).toEqual([
    ...segmentIds.map((_, index) => index),
    ...Array.from({ length: queuedCount }, () => undefined),
  ]);
});

/**
 * A document of one insert of incompressible text, `slackBytes` short of the
 * plaintext that base64 turns into a whole request's worth of characters.
 */
async function documentNearRequestLimit(name: string, slackBytes: number) {
  const characters = new Uint8Array(
    (MAX_DOCUMENT_SYNC_REQUEST_BYTES / 4) * 3 - slackBytes,
  );
  let seed = 7;
  for (let index = 0; index < characters.length; index += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    characters[index] = 33 + ((seed >>> 24) % 94);
  }
  const document = await createDocument(name);
  document.getText("text").insert(0, new TextDecoder().decode(characters));
  document.commit();
  return document;
}

/**
 * A real Loro update (encryption reads its dependencies) whose base64 fits
 * the preliminary plaintext-character bound with little to spare.
 */
async function updateNearRequestLimit() {
  // Loro frames this incompressible text in about a hundred bytes.
  const document = await documentNearRequestLimit("near-request-limit", 128);
  const update = exportAllUpdates(document);
  document.free();
  const updateData = bytesToBase64(update);
  expect(updateData.length).toBeLessThanOrEqual(
    MAX_DOCUMENT_SYNC_REQUEST_BYTES,
  );
  expect(updateData.length).toBeGreaterThan(
    MAX_DOCUMENT_SYNC_REQUEST_BYTES - 1024,
  );
  return { ...getUpdateVersionVectors(update), updateData };
}

// A baseline is not trimmed to fit as a queue is: every segment the request
// carries has to lead it. A group is cut to travel whole by its plaintext,
// and the request's exact byte check is made once it is encrypted and
// signed. One that fits the first and not the second is staged instead, so
// the request carries only its final segment. It used to end in
// `document_sync_request_too_large`.
test("a heal whose baseline group fits only before it is encrypted goes through a stage", async () => {
  const harness = await createStagedHealHarness();
  // Each segment is framed apart, so the history leaves room for a few.
  const document = await documentNearRequestLimit("near-limit-history", 2048);
  const history = segmentRotationSnapshot({
    purpose: "Near-limit history fixture",
    snapshot: exportFullHistorySnapshot(document),
  });
  expect(history.segments.length).toBeGreaterThan(1);
  const dataCharacters = rotationBaselineDataCharacters(history);
  expect(dataCharacters).toBeLessThanOrEqual(MAX_DOCUMENT_SYNC_REQUEST_BYTES);
  expect(dataCharacters).toBeGreaterThan(
    MAX_DOCUMENT_SYNC_REQUEST_BYTES - 4096,
  );

  // The default segment sizes, as a host uses them.
  const synced = await harness.heal(document, execSql, {});

  expect(synced?.acceptedRecoveryBaseline).toBe(true);
  expect(harness.terminalFailures).toEqual([]);
  expect(harness.abandonedReasons).toEqual([]);
  expect(harness.server.calls[0]).toBe("open");
  expect(harness.server.committed).toHaveLength(1);
  // Nothing was sent until the group was staged: one request commits it.
  expect(harness.requests).toHaveLength(1);
  const [request] = harness.requests;
  expect(request?.baselineStageId).toBeDefined();
  expect(
    request?.outgoingUpdates.filter((update) => update.baselineId),
  ).toHaveLength(1);
}, 120_000);

test("an encrypted update that cannot fit records a terminal queue failure", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const terminalFailures: DocumentSyncSubmitFailure[] = [];
  const abandonedReasons: string[] = [];
  let submitCount = 0;

  const synced = await syncRemoteDocument({
    apiClient: createMockApiClient({
      getDocumentWriterProjection: async () => writerProjection,
      syncDocument: async () => {
        submitCount += 1;
        throw new Error("An oversized plan must not reach the network");
      },
    }),
    author,
    documentId: writerProjection.documentId,
    execSql,
    localVersionVector: null,
    onSyncAbandoned: (reason) => abandonedReasons.push(reason),
    onTerminalSubmitFailure: (failure) => {
      terminalFailures.push(failure);
    },
    pendingUpdates: [
      // This fits the preliminary plaintext-character bound. Encryption and
      // the signed request envelope make the final JSON exceed 16 MiB.
      createPendingUpdateRecord(await updateNearRequestLimit()),
    ],
    resolveProjectionUserKey,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
    targetSecretKey: secretKey,
    writerProjection,
  });

  expect(synced).toBeNull();
  expect(submitCount).toBe(0);
  expect(terminalFailures).toHaveLength(1);
  expect(terminalFailures[0]?.code).toBe("document_sync_request_too_large");
  expect(terminalFailures[0]?.message).toContain(
    "cannot fit within the request limit",
  );
  expect(abandonedReasons).toEqual([
    "one queued update or operation cannot fit a document sync request, or the history needs more segments than a staged rotation baseline holds",
  ]);
});

test("a high-actor write above the old vector ceiling remains syncable", async () => {
  const fixture = await createMaterializedSyncFixture();
  const highActorVector = "V".repeat(64 * 1024 + 1);
  const pendingUpdate = createPendingUpdateRecord({
    partialEndVersionVector: highActorVector,
    partialStartVersionVector: highActorVector,
  });
  let submittedVectorLength = 0;

  const synced = await syncRemoteDocument({
    apiClient: createMockApiClient({
      getDocumentWriterProjection: async () => fixture.writerProjection,
      syncDocument: async (documentId, request) => {
        submittedVectorLength =
          request.outgoingUpdates[0]?.partialEndVersionVector.length ?? 0;
        const plan = await buildDocumentSyncPlan({
          author: fixture.author,
          contentKeyBundle: fixture.writerProjection.contentKeyBundle,
          documentId,
          documentKekTargets: fixture.writerProjection.documentKekTargets,
          documentManifest: fixture.writerProjection.documentManifest,
          localVersionVector: null,
        });
        return createSyncResponse(
          { ...plan, request },
          {
            acceptedOutgoingUpdateIds: request.outgoingUpdates.map(
              (update) => update.id,
            ),
            updates: [],
          },
        );
      },
    }),
    author: fixture.author,
    documentId: fixture.writerProjection.documentId,
    execSql,
    localVersionVector: highActorVector,
    pendingUpdates: [pendingUpdate],
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    resolveWriterPublicKey: writerKeyResolver({
      author: fixture.author,
      signingPublicKey: fixture.signingPublicKey,
    }),
    targetSecretKey: fixture.secretKey,
    writerProjection: fixture.writerProjection,
  });

  expect(submittedVectorLength).toBe(highActorVector.length);
  expect(synced?.settledPendingUpdateIds).toEqual([pendingUpdate.id]);
});

test("a persisted oversized read frontier falls back to a complete pull", async () => {
  const fixture = await createMaterializedSyncFixture();
  let submittedLocalVersionVector: string | null | undefined;

  const synced = await syncRemoteDocument({
    apiClient: createMockApiClient({
      getDocumentWriterProjection: async () => {
        throw new Error("Persisted read-only sync must not fetch a projection");
      },
      syncDocument: async (documentId, request) => {
        submittedLocalVersionVector = request.localVersionVector;
        const plan = await buildDocumentSyncPlan({
          author: fixture.author,
          contentKeyBundle: fixture.writerProjection.contentKeyBundle,
          documentId,
          documentKekTargets: fixture.writerProjection.documentKekTargets,
          documentManifest: fixture.writerProjection.documentManifest,
          localVersionVector: null,
        });
        return createSyncResponse(
          { ...plan, request },
          { acceptedOutgoingUpdateIds: [], updates: [] },
        );
      },
    }),
    author: fixture.author,
    documentId: fixture.writerProjection.documentId,
    execSql,
    localVersionVector: "V".repeat(MAX_DOCUMENT_SYNC_REQUEST_BYTES),
    pendingUpdates: [],
    persistedState: {
      contentKeyBundle: JSON.stringify(
        fixture.writerProjection.contentKeyBundle,
      ),
      documentId: fixture.writerProjection.documentId,
      documentKekTargets: JSON.stringify(
        fixture.writerProjection.documentKekTargets,
      ),
      documentManifestBundle: JSON.stringify(
        fixture.writerProjection.documentManifest,
      ),
    },
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    resolveWriterPublicKey: writerKeyResolver({
      author: fixture.author,
      signingPublicKey: fixture.signingPublicKey,
    }),
    targetSecretKey: fixture.secretKey,
    writerProjection: fixture.writerProjection,
  });

  expect(submittedLocalVersionVector).toBeNull();
  expect(synced).not.toBeNull();
});
