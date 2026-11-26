import { expect, test } from "bun:test";
import {
  createMockApiClient,
  createMockRequestFailure,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { writerKeyResolver } from "../../../../test/helpers/data/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../../test/helpers/workflows/documentSync";
import { createLoroPendingUpdate } from "../../../../test/helpers/workflows/documentSyncFixtures";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import {
  createFullHistoryRotationSnapshot,
  createStaleBundleSyncFixture,
} from "../../../../test/helpers/workflows/staleBundleSyncFixture";
import { assertDocumentWriterProjectionConsistent } from "../../../data/documents/shared/projection";
import type { DocumentSyncSubmitFailure } from "../../../data/documents/shared/sync/syncSubmitFailure";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import { buildMaterializedDocumentSyncPlan } from "../syncPlan/syncPlanMaterial";

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
  // remain the no-baseline path. A short history is a group of one segment,
  // sent ahead of the queued update, which uses the fresh key.
  expect(request.outgoingUpdates).toHaveLength(2);
  const [baseline, queued] = request.outgoingUpdates;
  expect(baseline?.baselineId).toBeDefined();
  expect(baseline?.baselineSegmentIndex).toBe(0);
  expect(baseline?.baselineSegmentCount).toBe(1);
  expect(baseline?.baselineSegmentsDigest).toBeDefined();
  expect(materialized.rotationBaselineUpdateIds).toEqual([baseline?.id ?? ""]);
  expect(queued?.id).toBe(pendingUpdate.id);
  expect(queued?.baselineId).toBeUndefined();
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

// The server refuses a heal whose baseline does not cover the committed
// frontier. Nothing on this device can answer that within the pass, so the
// first refusal is terminal and the queued update keeps its id for a later
// pass: it is not re-keyed, and no other baseline is built to resubmit.
test("a heal refused for its baseline's coverage is a terminal submit failure", async () => {
  // The server marks the bundle stale; the container path itself is current,
  // so the pass verifies and records it as any sync does.
  const fixture = await createMaterializedSyncFixture();
  const staleProjection = {
    ...fixture.writerProjection,
    contentKeyBundleStale: true as const,
  };
  const { documentId } = staleProjection;
  const pendingUpdate = await createLoroPendingUpdate("stale heal edit");
  const submittedRequests: DocumentSyncRequest[] = [];
  const terminalFailures: DocumentSyncSubmitFailure[] = [];
  const abandonedReasons: string[] = [];
  const rekeyedIds: string[] = [];
  const traceLines: string[] = [];
  const { close, execSql } = await createTestExecSql("heal-coverage-refusal");

  try {
    await ensureDocumentTables(execSql);
    const synced = await syncRemoteDocument({
      apiClient: createMockApiClient({
        getDocumentWriterProjection: async () => staleProjection,
        syncDocument: async () => {
          throw new Error("Expected syncDocumentResult to carry the refusal");
        },
        syncDocumentResult: async (_documentId, request) => {
          submittedRequests.push(request);
          return createMockRequestFailure({
            code: DOCUMENT_SYNC_ERROR_CODES.checkpointCoverageConflict,
            message: `POST /documents/${documentId}/sync: 409 : Document content-key rotation baseline does not cover the committed frontier`,
            status: 409,
          });
        },
      }),
      author: fixture.author,
      buildRotationSnapshot: createFullHistoryRotationSnapshot,
      documentId,
      execSql,
      localVersionVector: null,
      onSyncAbandoned: (reason) => abandonedReasons.push(reason),
      onSyncTrace: (line) => traceLines.push(line),
      onTerminalSubmitFailure: (failure) => {
        terminalFailures.push(failure);
      },
      pendingUpdates: [pendingUpdate],
      rekeyPendingUpdate: async (_execSql, id) => {
        rekeyedIds.push(id);
        return crypto.randomUUID();
      },
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      resolveWriterPublicKey: writerKeyResolver(fixture),
      targetSecretKey: fixture.secretKey,
      writerProjection: staleProjection,
    });

    // Attempts remain, and the one refusal still ends the pass.
    expect(synced).toBeNull();
    expect(submittedRequests).toHaveLength(1);
    const [baseline, queued, ...rest] =
      submittedRequests[0]?.outgoingUpdates ?? [];
    expect(rest).toEqual([]);
    expect(baseline?.baselineSegmentCount).toBe(1);
    expect(queued?.id).toBe(pendingUpdate.id);
    expect(terminalFailures.map((failure) => failure.code)).toEqual([
      DOCUMENT_SYNC_ERROR_CODES.checkpointCoverageConflict,
    ]);
    expect(terminalFailures[0]?.status).toBe(409);
    expect(abandonedReasons).toEqual(["the sync submit failed terminally"]);
    expect(rekeyedIds).toEqual([]);
    expect(traceLines.at(-1)).toBe(
      `document sync submit failed document=${documentId} status=409 code=${DOCUMENT_SYNC_ERROR_CODES.checkpointCoverageConflict} action=stop`,
    );
  } finally {
    close();
  }
});
