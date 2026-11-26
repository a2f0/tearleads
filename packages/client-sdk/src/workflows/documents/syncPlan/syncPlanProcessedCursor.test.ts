import { expect, test } from "bun:test";
import { computeDocumentContentRecordMetadataHash } from "@tearleads/crypto";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { DocumentSyncRequestSchema } from "@tearleads/validators/request";
import { createPendingUpdateRecord } from "../../../../test/helpers/data/documentResponseFixtures";
import { SMALL_BASELINE_SEGMENTS } from "../../../../test/helpers/data/rotationBaselineFixtures";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import { createInterleavedHistoryDocument } from "../../../../test/helpers/workflows/staleBundleSyncFixture";
import { documentVerdictJudge } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

const CURSOR = "550e8400-e29b-41d4-a716-446655440e11";

async function heldVersion(): Promise<string> {
  const document = await createDocument("plan-cursor-held");
  document.getText("text").insert(0, "held");
  document.commit();
  const version = encodeVersionVector(document);
  document.free();
  return version;
}

test("a plan carries the processed cursor only with the version it was recorded with", async () => {
  const fixture = await createMaterializedSyncFixture();
  const plan = (input: {
    readonly historyMode?: "raw";
    readonly localVersionVector: string | null;
  }) =>
    buildMaterializedDocumentSyncPlan({
      author: fixture.author,
      pendingUpdates: [],
      processedThroughUpdateId: CURSOR,
      targetSecretKey: fixture.secretKey,
      trustedLocalProjection: true,
      writerProjection: fixture.writerProjection,
      ...input,
    });

  const versioned = (await plan({ localVersionVector: await heldVersion() }))
    .plan.request;
  expect(versioned.processedThroughUpdateId).toBe(CURSOR);

  // A pull without a version vector, and a raw-history pull, read the whole
  // history: neither may skip what the cursor stands for, and the server
  // refuses a cursor without a version vector.
  for (const request of [
    (await plan({ localVersionVector: null })).plan.request,
    (await plan({ historyMode: "raw", localVersionVector: null })).plan.request,
  ]) {
    expect("processedThroughUpdateId" in request).toBe(false);
    expect(DocumentSyncRequestSchema.safeParse(request).success).toBe(true);
  }
});

// The API weighs only updates committed after a baseline's signed cursor. A
// heal's baseline signs the cursor whose recorded frontier its history
// covers, on its final segment alone, and none when that frontier holds
// operations the history lacks.
test("a heal's rotation baseline signs the processed cursor its history covers", async () => {
  const fixture = await createMaterializedSyncFixture();
  // The server marks the bundle stale, so a plan with a queued update heals.
  const staleProjection = {
    ...fixture.writerProjection,
    contentKeyBundleStale: true as const,
  };
  const { documentId } = staleProjection;
  const document = await createInterleavedHistoryDocument("plan-cursor-heal");
  const version = encodeVersionVector(document);
  const snapshot = exportFullHistorySnapshot(document);
  document.free();
  const queued = createPendingUpdateRecord();
  const { close, execSql } = await createTestExecSql("plan-cursor-baseline");
  try {
    await ensureDocumentTables(execSql);
    const recordCursor = (throughVersion: string) =>
      execSql(
        `INSERT OR REPLACE INTO document_sync_progress (app_kind, local_id,
           document_id, through_update_id, through_version, judge)
         VALUES ('documents', 'local', ?, ?, ?, ?)`,
        [documentId, CURSOR, throughVersion, documentVerdictJudge()],
      );
    // The request's updates: the baseline's segments, then the queued one.
    const outgoing = async () => {
      const { request } = (
        await buildMaterializedDocumentSyncPlan({
          author: fixture.author,
          buildRotationSnapshot: async () => snapshot,
          execSql,
          localVersionVector: null,
          pendingUpdates: [queued],
          rotationBaselineSegmentSizes: SMALL_BASELINE_SEGMENTS,
          targetSecretKey: fixture.secretKey,
          trustedLocalProjection: true,
          writerProjection: staleProjection,
        })
      ).plan;
      expect(DocumentSyncRequestSchema.safeParse(request).success).toBe(true);
      expect(request.outgoingUpdates.at(-1)?.id).toBe(queued.id);
      expect(request.outgoingUpdates.length).toBeGreaterThan(3);
      return request.outgoingUpdates;
    };
    const cursors = (updates: Awaited<ReturnType<typeof outgoing>>) =>
      updates.map((update) => update.coversThroughUpdateId);

    // With no cursor recorded, the baseline signs none.
    expect(new Set(cursors(await outgoing()))).toEqual(new Set([undefined]));

    await recordCursor(version);
    const signed = await outgoing();
    const segments = signed.slice(0, -1);
    const final = segments.at(-1);
    if (!final) throw new Error("Expected a final baseline segment");
    expect(cursors(signed)).toEqual([
      ...segments.slice(0, -1).map(() => undefined),
      CURSOR,
      undefined,
    ]);
    expect(Reflect.get(final.writeHeader, "metadataHash")).toBe(
      await computeDocumentContentRecordMetadataHash({
        baselineId: final.baselineId,
        baselineSegmentCount: segments.length,
        baselineSegmentIndex: segments.length - 1,
        baselineSegmentsDigest: final.baselineSegmentsDigest,
        coversThroughUpdateId: CURSOR,
        dependencyVersionVector: final.dependencyVersionVector,
        documentId,
        partialEndVersionVector: final.partialEndVersionVector,
        partialStartVersionVector: final.partialStartVersionVector,
        plaintextHash: final.plaintextHash,
        updateId: final.id,
      }),
    );

    // A cursor recorded at a version the history lacks is not signed.
    await recordCursor(await heldVersion());
    expect(new Set(cursors(await outgoing()))).toEqual(new Set([undefined]));
  } finally {
    close();
  }
});
