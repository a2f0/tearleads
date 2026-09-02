import { expect, test } from "bun:test";
import {
  createPendingUpdateRecord,
  createSyncResponse,
} from "../../../test/helpers/documentFixtures";
import {
  createFullHistoryRotationSnapshot,
  createStaleBundleSyncFixture,
} from "../../../test/helpers/staleBundleSyncFixture";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";
import { applyAcceptedHealSideEffects } from "./syncSubmittedResult";

test("expired response verification cannot evict or trace a healed projection", async () => {
  const fixture = await createStaleBundleSyncFixture();
  const pendingUpdate = createPendingUpdateRecord();
  const materializedPlan = await buildMaterializedDocumentSyncPlan({
    author: fixture.author,
    buildRotationSnapshot: createFullHistoryRotationSnapshot,
    localVersionVector: null,
    pendingUpdates: [pendingUpdate],
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.staleWriterProjection,
  });
  expect(materializedPlan.healedStaleContentKeyBundle).toBe(true);
  const response = await createSyncResponse(materializedPlan.plan);
  const evictedDocumentIds: string[] = [];
  const traceLines: string[] = [];
  let current = false;
  const applyEffects = () =>
    applyAcceptedHealSideEffects({
      documentId: fixture.staleWriterProjection.documentId,
      evictWriterProjection: (documentId) => {
        evictedDocumentIds.push(documentId);
        current = false;
      },
      materializedPlan,
      onSyncTrace: (line) => traceLines.push(line),
      response,
      stillCurrent: () => current,
    });

  applyEffects();
  expect(evictedDocumentIds).toEqual([]);
  expect(traceLines).toEqual([]);

  current = true;
  applyEffects();
  expect(evictedDocumentIds).toEqual([
    fixture.staleWriterProjection.documentId,
  ]);
  expect(traceLines).toEqual([]);
});
