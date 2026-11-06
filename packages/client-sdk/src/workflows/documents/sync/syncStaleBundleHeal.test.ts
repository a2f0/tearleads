import { afterEach, beforeEach, expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  exportAllUpdates,
  exportFullHistorySnapshot,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSyncResponse,
  writerKeyResolver,
} from "../../../../test/helpers/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../../test/helpers/documentSync";
import { createLoroPendingUpdate } from "../../../../test/helpers/documentSyncFixtures";
import {
  createFullHistoryRotationSnapshot,
  createStaleBundleSyncFixture,
} from "../../../../test/helpers/staleBundleSyncFixture";
import { assertDocumentWriterProjectionConsistent } from "../../../data/documents/shared/projection";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { buildDocumentSyncPlan } from "../syncPlan/syncPlanIdentity";
import { buildMaterializedDocumentSyncPlan } from "../syncPlan/syncPlanMaterial";

let execSql: ExecSql;
let closeExecSql: () => void;

beforeEach(async () => {
  ({ close: closeExecSql, execSql } = await createTestExecSql("document-sync"));
  await ensureDocumentTables(execSql);
});

afterEach(() => closeExecSql());

function writeHeaderEpoch(update: { writeHeader: Record<string, unknown> }) {
  return Reflect.get(update.writeHeader, "contentKeyEpoch");
}

test("buildMaterializedDocumentSyncPlan heals a stale bundle with a fresh key and rotation baseline", async () => {
  const fixture = await createStaleBundleSyncFixture();
  const pendingUpdate = await createLoroPendingUpdate("stale heal edit");

  const materialized = await buildMaterializedDocumentSyncPlan({
    author: fixture.author,
    buildRotationSnapshot: createFullHistoryRotationSnapshot,
    localVersionVector: null,
    pendingUpdates: [pendingUpdate],
    signedAt: "2026-07-26T00:00:00.000Z",
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.staleWriterProjection,
  });

  expect(materialized.healedStaleContentKeyBundle).toBe(true);
  expect(materialized.contentKey).toHaveLength(32);
  expect(materialized.contentKey).not.toEqual(fixture.contentKey);

  const { request } = materialized.plan;
  expect(request.contentKeyEpoch).toBe(fixture.staleBundle.contentKeyEpoch + 1);
  expect(request.contentKeyBundle?.contentKeyEpoch).toBe(
    fixture.staleBundle.contentKeyEpoch + 1,
  );
  expect(request.expectedTargetHash).toBe(
    fixture.staleWriterProjection.documentKekTargets.documentKeyTargetHash,
  );
  expect(request.contentKeyBundle?.targets[0]?.containerKeyEpochId).toBe(
    fixture.rotatedTarget.containerKeyEpochId,
  );
  expect(request.contentKeyBundle?.targets[0]?.wrappedKey).not.toBe(
    fixture.staleBundle.targets[0]?.wrappedKey,
  );
  // The covering baseline optimizes current-epoch redirects; predecessor KEKs
  // remain the no-baseline path. The queued update uses the fresh key.
  expect(request.outgoingUpdates).toHaveLength(2);
  expect(request.outgoingUpdates[0]?.checkpointKind).toBe("rotate_baseline");
  expect(request.outgoingUpdates[1]?.id).toBe(pendingUpdate.id);
  for (const update of request.outgoingUpdates) {
    expect(writeHeaderEpoch(update)).toBe(
      fixture.staleBundle.contentKeyEpoch + 1,
    );
  }
});

test("a read-only stale bundle degrades when its target predates the current path", async () => {
  const fixture = await createStaleBundleSyncFixture();

  const materialized = await buildMaterializedDocumentSyncPlan({
    author: fixture.author,
    localVersionVector: null,
    pendingUpdates: [],
    signedAt: "2026-07-26T00:00:00.000Z",
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.staleWriterProjection,
  });

  expect(materialized.healedStaleContentKeyBundle).toBe(false);
  expect(materialized.contentKey).toHaveLength(0);
  const { plan } = materialized;
  expect(plan.request.contentKeyBundle).toBeUndefined();
  expect(plan.request.contentKeyEpoch).toBe(
    fixture.staleBundle.contentKeyEpoch,
  );
  expect(plan.request.expectedTargetHash).toBe(fixture.staleBundle.targetHash);
  expect(plan.documentKekTargets.documentKeyTargetHash).toBe(
    fixture.staleBundle.targetHash,
  );
});

test("buildMaterializedDocumentSyncPlan refuses to heal without a rotation snapshot", async () => {
  const fixture = await createStaleBundleSyncFixture();

  await expect(
    buildMaterializedDocumentSyncPlan({
      author: fixture.author,
      localVersionVector: null,
      pendingUpdates: [await createLoroPendingUpdate("stuck edit")],
      signedAt: "2026-07-26T00:00:00.000Z",
      targetSecretKey: fixture.secretKey,
      trustedLocalProjection: true,
      writerProjection: fixture.staleWriterProjection,
    }),
  ).rejects.toThrow(
    "Document content-key bundle is stale and no rotation snapshot is available to heal it",
  );
});

test("consumers that cannot heal reject a stale content-key bundle outright", async () => {
  const fixture = await createStaleBundleSyncFixture();

  await expect(
    assertDocumentWriterProjectionConsistent(fixture.staleWriterProjection, {
      trustedLocalProjection: true,
    }),
  ).rejects.toThrow("Document writer projection content-key bundle is stale");
});

test("a heal holds back superseded pending rotation checkpoints it provably covers", async () => {
  const fixture = await createStaleBundleSyncFixture();
  // One live document backs the queued edit, the leftover checkpoint, AND the
  // recovery snapshot — exactly how the stores wire buildRotationSnapshot.
  const doc = await createDocument("held-back-checkpoint-source");
  doc.getText("text").update("stale heal edit");
  doc.commit();
  const editUpdate = exportAllUpdates(doc);
  const editVectors = getUpdateVersionVectors(editUpdate);
  const pendingEdit = createPendingUpdateRecord({
    updateData: bytesToBase64(editUpdate),
    ...editVectors,
  });
  const supersededCheckpoint = createPendingUpdateRecord({
    id: "550e8400-e29b-41d4-a716-446655440777",
    sourceVersionVector: editVectors.partialEndVersionVector,
    updateData: bytesToBase64(exportFullHistorySnapshot(doc)),
    partialStartVersionVector: "{}",
    partialEndVersionVector: editVectors.partialEndVersionVector,
  });

  const materialized = await buildMaterializedDocumentSyncPlan({
    author: fixture.author,
    buildRotationSnapshot: async () => exportFullHistorySnapshot(doc),
    localVersionVector: null,
    pendingUpdates: [supersededCheckpoint, pendingEdit],
    signedAt: "2026-07-26T00:00:00.000Z",
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.staleWriterProjection,
  });

  expect(materialized.healedStaleContentKeyBundle).toBe(true);
  const { request } = materialized.plan;
  // Fresh covering baseline + the ordinary edit; the covered checkpoint is
  // withheld — submitting it would trip the server's covering-baseline gate,
  // and resubmitting it post-heal could mask the covering baseline.
  expect(request.outgoingUpdates).toHaveLength(2);
  expect(request.outgoingUpdates[0]?.checkpointKind).toBe("rotate_baseline");
  expect(request.outgoingUpdates.map((update) => update.id)).not.toContain(
    supersededCheckpoint.id,
  );
  expect(request.outgoingUpdates[1]?.id).toBe(pendingEdit.id);
  // The plan reports what it withheld (settled by the heal, since the
  // baseline subsumes it) and which ack is synthetic.
  expect(materialized.heldBackPendingUpdateIds).toEqual([
    supersededCheckpoint.id,
  ]);
  expect(materialized.staleRecoveryBaselineUpdateId).toBe(
    request.outgoingUpdates[0]?.id ?? "",
  );
});

test("a heal refuses to settle a checkpoint its snapshot does not cover", async () => {
  const fixture = await createStaleBundleSyncFixture();
  // The checkpoint's ops come from a document the recovery snapshot has never
  // seen — settling it would silently drop those ops.
  const foreignEdit = await createLoroPendingUpdate("foreign checkpoint ops");
  const uncoveredCheckpoint = createPendingUpdateRecord({
    id: "550e8400-e29b-41d4-a716-446655440888",
    sourceVersionVector: foreignEdit.partialEndVersionVector,
    updateData: foreignEdit.updateData,
    partialStartVersionVector: "{}",
    partialEndVersionVector: foreignEdit.partialEndVersionVector,
  });

  await expect(
    buildMaterializedDocumentSyncPlan({
      author: fixture.author,
      buildRotationSnapshot: createFullHistoryRotationSnapshot,
      localVersionVector: null,
      pendingUpdates: [
        uncoveredCheckpoint,
        await createLoroPendingUpdate("stuck edit"),
      ],
      signedAt: "2026-07-26T00:00:00.000Z",
      targetSecretKey: fixture.secretKey,
      trustedLocalProjection: true,
      writerProjection: fixture.staleWriterProjection,
    }),
  ).rejects.toThrow(
    "Document stale-bundle recovery snapshot does not cover a queued rotation checkpoint",
  );
});

test("regeneration replaces queued checkpoints with a fresh covering baseline", async () => {
  const { author, secretKey, writerProjection } =
    await createMaterializedSyncFixture();
  const doc = await createDocument("leftover-checkpoint-regenerate");
  doc.getText("text").update("history behind the checkpoint");
  doc.commit();
  const editUpdate = exportAllUpdates(doc);
  const editVectors = getUpdateVersionVectors(editUpdate);
  const pendingEdit = createPendingUpdateRecord({
    updateData: bytesToBase64(editUpdate),
    ...editVectors,
  });
  const leftoverCheckpoint = createPendingUpdateRecord({
    id: "550e8400-e29b-41d4-a716-446655440aaa",
    sourceVersionVector: editVectors.partialEndVersionVector,
    updateData: bytesToBase64(exportFullHistorySnapshot(doc)),
    partialStartVersionVector: "{}",
    partialEndVersionVector: editVectors.partialEndVersionVector,
  });

  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    buildRotationSnapshot: async () => exportFullHistorySnapshot(doc),
    localVersionVector: null,
    pendingUpdates: [leftoverCheckpoint, pendingEdit],
    regenerateQueuedCheckpoints: true,
    signedAt: "2026-07-26T00:00:00.000Z",
    targetSecretKey: secretKey,
    trustedLocalProjection: true,
    writerProjection,
  });

  // The stale leftover is replaced by one fresh full-history baseline (which
  // provably covers it) and settled on success — resubmitting the old
  // payload could shrink the redirect's baseline coverage. The request stays
  // non-advancing: it carries the CURRENT bundle at the current epoch, and
  // the ordinary edit rides along.
  expect(materialized.healedStaleContentKeyBundle).toBe(false);
  const { request } = materialized.plan;
  expect(request.contentKeyBundle?.contentKeyEpoch).toBe(
    writerProjection.contentKeyBundle.contentKeyEpoch,
  );
  expect(request.outgoingUpdates).toHaveLength(2);
  expect(request.outgoingUpdates[0]?.checkpointKind).toBe("rotate_baseline");
  expect(request.outgoingUpdates[0]?.id).not.toBe(leftoverCheckpoint.id);
  expect(request.outgoingUpdates[1]?.id).toBe(pendingEdit.id);
  expect(materialized.heldBackPendingUpdateIds).toEqual([
    leftoverCheckpoint.id,
  ]);
  expect(materialized.staleRecoveryBaselineUpdateId).toBe(
    request.outgoingUpdates[0]?.id ?? "",
  );
});

test("syncRemoteDocument regenerates a rejected queued checkpoint and resubmits", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const doc = await createDocument("coverage-rejected-checkpoint");
  doc.getText("text").update("interrupted recovery history");
  doc.commit();
  const vectors = getUpdateVersionVectors(exportAllUpdates(doc));
  const leftoverCheckpoint = createPendingUpdateRecord({
    id: "550e8400-e29b-41d4-a716-446655440bbb",
    sourceVersionVector: vectors.partialEndVersionVector,
    updateData: bytesToBase64(exportFullHistorySnapshot(doc)),
    partialStartVersionVector: "{}",
    partialEndVersionVector: vectors.partialEndVersionVector,
  });
  const submittedRequests: DocumentSyncRequest[] = [];
  const traceLines: string[] = [];

  const synced = await syncRemoteDocument({
    apiClient: createMockApiClient({
      getDocumentWriterProjection: async () => writerProjection,
      syncDocument: async () => {
        throw new Error("Expected syncDocumentResult to handle sync retries");
      },
      syncDocumentResult: async (documentId, request) => {
        submittedRequests.push(request);

        if (submittedRequests.length === 1) {
          const message = `POST /documents/${documentId}/sync: 409 : Document content-key rotation baseline does not cover the committed frontier`;
          return {
            kind: "http",
            method: "POST",
            path: "mock-request",
            statusText: "",
            code: DOCUMENT_SYNC_ERROR_CODES.checkpointCoverageConflict,
            message,
            ok: false,
            report: () => {},
            status: 409,
          };
        }

        const plan = await buildDocumentSyncPlan({
          author,
          contentKeyBundle: writerProjection.contentKeyBundle,
          documentId,
          documentKekTargets: writerProjection.documentKekTargets,
          documentManifest: writerProjection.documentManifest,
          localVersionVector: null,
        });
        return {
          data: await createSyncResponse({ ...plan, documentId, request }),
          ok: true,
        };
      },
    }),
    author,
    buildRotationSnapshot: async () => exportFullHistorySnapshot(doc),
    documentId: writerProjection.documentId,
    execSql,
    localVersionVector: null,
    onSyncTrace: (line) => traceLines.push(line),
    pendingUpdates: [leftoverCheckpoint],
    resolveProjectionUserKey,
    targetSecretKey: secretKey,
    writerProjection,
    resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
  });

  // First attempt passes the stale leftover through; the server's coverage
  // gate rejects it; the retry regenerates a fresh covering baseline under a
  // new id and succeeds, settling the leftover row it subsumes.
  expect(submittedRequests).toHaveLength(2);
  expect(submittedRequests[0]?.outgoingUpdates[0]?.id).toBe(
    leftoverCheckpoint.id,
  );
  const regenerated = submittedRequests[1]?.outgoingUpdates[0];
  expect(regenerated?.checkpointKind).toBe("rotate_baseline");
  expect(regenerated?.id).not.toBe(leftoverCheckpoint.id);
  expect(synced?.settledPendingUpdateIds).toContain(leftoverCheckpoint.id);
  expect(synced?.settledPendingUpdateIds).not.toContain(regenerated?.id ?? "");
  // The pass narrates itself in clipboard-safe trace lines.
  expect(traceLines).toContain(
    `document sync submit failed document=${writerProjection.documentId} status=409 code=${DOCUMENT_SYNC_ERROR_CODES.checkpointCoverageConflict} action=regenerate-checkpoints`,
  );
  expect(traceLines).toContain(
    `document sync checkpoint regeneration document=${writerProjection.documentId} checkpoints=1 updates=0`,
  );
});
