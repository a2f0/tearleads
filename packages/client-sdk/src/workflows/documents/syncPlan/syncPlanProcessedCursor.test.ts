import { expect, test } from "bun:test";
import { computeDocumentContentRecordMetadataHash } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  emptyVersionVector,
  encodeVersionVector,
  exportFullHistorySnapshot,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { DocumentSyncRequestSchema } from "@tearleads/validators/request";
import { createPendingUpdateRecord } from "../../../../test/helpers/data/documentResponseFixtures";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
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
// queued baseline signs the cursor its source covers the recorded frontier
// of, and none when that frontier holds operations its snapshot lacks.
test("a queued rotation baseline signs the processed cursor its source covers", async () => {
  const fixture = await createMaterializedSyncFixture();
  const { documentId } = fixture.writerProjection;
  const document = await createDocument("plan-cursor-baseline");
  document.getText("text").insert(0, "baseline");
  document.commit();
  const snapshot = exportFullHistorySnapshot(document);
  const vectors = getUpdateVersionVectors(snapshot);
  const baseline = createPendingUpdateRecord({
    id: "550e8400-e29b-41d4-a716-446655440e12",
    partialEndVersionVector: vectors.partialEndVersionVector,
    partialStartVersionVector: emptyVersionVector(),
    sourceVersionVector: vectors.partialEndVersionVector,
    updateData: bytesToBase64(snapshot),
  });
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
    const outgoing = async () => {
      const { request } = (
        await buildMaterializedDocumentSyncPlan({
          author: fixture.author,
          execSql,
          localVersionVector: null,
          pendingUpdates: [baseline, createPendingUpdateRecord()],
          targetSecretKey: fixture.secretKey,
          trustedLocalProjection: true,
          writerProjection: fixture.writerProjection,
        })
      ).plan;
      expect(DocumentSyncRequestSchema.safeParse(request).success).toBe(true);
      return request.outgoingUpdates;
    };

    await recordCursor(vectors.partialEndVersionVector);
    const [signed, ordinary] = await outgoing();
    expect(signed?.coversThroughUpdateId).toBe(CURSOR);
    expect(ordinary && "coversThroughUpdateId" in ordinary).toBe(false);
    expect(Reflect.get(signed?.writeHeader ?? {}, "metadataHash")).toBe(
      await computeDocumentContentRecordMetadataHash({
        checkpointKind: "rotate_baseline",
        checkpointPayloadKind: "full_history_snapshot",
        coversThroughUpdateId: CURSOR,
        dependencyVersionVector: emptyVersionVector(),
        documentId,
        partialEndVersionVector: vectors.partialEndVersionVector,
        partialStartVersionVector: emptyVersionVector(),
        plaintextHash: signed?.plaintextHash ?? "",
        sourceVersionVector: vectors.partialEndVersionVector,
        updateId: baseline.id,
      }),
    );

    await recordCursor(await heldVersion());
    const [unsigned] = await outgoing();
    expect(unsigned && "coversThroughUpdateId" in unsigned).toBe(false);
  } finally {
    close();
  }
});
