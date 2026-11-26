import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportHistorySegments,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { SMALL_BASELINE_SEGMENTS } from "../../../../test/helpers/data/rotationBaselineFixtures";
import { sqlDocumentsPersistence } from "./documentsPersistence";

// A synced rotation baseline leaves its segments in the tail as remote
// updates. Each is an update blob cut from the history at any counter, and a
// later recovery that holds the history proves and prunes every one.
test("later recovery accepts a settled rotation baseline's segments in the tail", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-recovery-settled-baseline-tail",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const recoveredDocument = await createDocument(
      "settled-baseline-history-writer",
    );
    const baselineText = "first rotation ".repeat(100);
    recoveredDocument.getText("text").update(baselineText);
    recoveredDocument.commit();
    const baselineVersion = encodeVersionVector(recoveredDocument);
    const baselineSnapshot = bytesToBase64(
      exportFullHistorySnapshot(recoveredDocument),
    );
    const baselineSegments = [
      ...exportHistorySegments(recoveredDocument, SMALL_BASELINE_SEGMENTS),
    ].map((segment) => bytesToBase64(segment.update));
    expect(baselineSegments.length).toBeGreaterThan(1);
    const initialRecord = {
      accessEpoch: 1,
      containerId: "container-1",
      documentId: "document-1",
      id: "settled-baseline-local-document",
      snapshotEndVersion: baselineVersion,
      text: baselineText,
    };
    await sqlDocumentsPersistence.createDocumentWithHistoryCheckpoint(
      execSql,
      initialRecord,
      { endVersionVector: baselineVersion, snapshot: baselineSnapshot },
      undefined,
      async () => undefined,
    );
    await sqlDocumentsPersistence.appendHistoryUpdates(execSql, {
      localId: initialRecord.id,
      origin: "remote",
      updates: baselineSegments,
    });

    recoveredDocument.getText("text").update("then later recovery");
    recoveredDocument.commit();
    const recoveredVersion = encodeVersionVector(recoveredDocument);
    const recoveredSnapshot = bytesToBase64(
      exportFullHistorySnapshot(recoveredDocument),
    );
    const expectedRecord = await sqlDocumentsPersistence.loadDocument(
      execSql,
      initialRecord.id,
    );
    if (!expectedRecord) throw new Error("Expected the stored document");

    await expect(
      sqlDocumentsPersistence.commitDocumentMutation(
        execSql,
        {
          acceptedPendingUpdateIds: [],
          document: {
            ...expectedRecord,
            snapshotEndVersion: recoveredVersion,
            text: "then later recovery",
          },
          expectedRecord,
          historyCheckpoint: {
            coveredTailIds: [],
            endVersionVector: recoveredVersion,
            pruneCoveredLocalState: true,
            snapshot: recoveredSnapshot,
          },
          settleAcceptedPendingOnConflict: false,
        },
        async () => undefined,
      ),
    ).resolves.toMatchObject({ committed: true });
    expect(
      await sqlDocumentsPersistence.loadHistoryRestoreState(
        execSql,
        initialRecord.id,
      ),
    ).toEqual({ snapshot: recoveredSnapshot, tailUpdates: [] });
    recoveredDocument.free();
  } finally {
    close();
  }
});
