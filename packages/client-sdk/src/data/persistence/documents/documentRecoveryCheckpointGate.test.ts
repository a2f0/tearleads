import { expect, test } from "bun:test";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  getUpdateVersionVectors,
} from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import { sqlDocumentsPersistence } from "./documentsPersistence";

test("a rejected recovery checkpoint rolls back its whole document mutation", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-recovery-checkpoint-gate",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const storedDocument = await createDocument("stored-checkpoint-writer");
    storedDocument.getText("text").update("stored winner");
    const storedSnapshot = bytesToBase64(
      exportFullHistorySnapshot(storedDocument),
    );
    const storedVersion = encodeVersionVector(storedDocument);
    const candidateDocument = await createDocument(
      "recovery-checkpoint-writer",
    );
    candidateDocument.getText("text").update("recovery candidate");
    const candidateSnapshotBytes = exportFullHistorySnapshot(candidateDocument);
    const candidateSnapshot = bytesToBase64(candidateSnapshotBytes);
    const candidateVectors = getUpdateVersionVectors(candidateSnapshotBytes);
    const candidateVersion = encodeVersionVector(candidateDocument);
    const initialRecord = {
      accessEpoch: 1,
      containerId: "container-1",
      documentId: "document-1",
      id: "local-document",
      snapshotEndVersion: storedVersion,
      text: "stored winner",
    };

    await sqlDocumentsPersistence.createDocumentWithHistoryCheckpoint(
      execSql,
      initialRecord,
      { endVersionVector: storedVersion, snapshot: storedSnapshot },
      undefined,
      async () => undefined,
    );
    await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
      localId: initialRecord.id,
      partialEndVersionVector: candidateVectors.partialEndVersionVector,
      partialStartVersionVector: candidateVectors.partialStartVersionVector,
      sourceVersionVector: candidateVersion,
      updateData: candidateSnapshot,
    });
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
            snapshotEndVersion: candidateVersion,
            text: "recovery candidate",
          },
          expectedRecord,
          historyCheckpoint: {
            coveredTailIds: [],
            endVersionVector: candidateVersion,
            pruneCoveredLocalState: true,
            snapshot: candidateSnapshot,
          },
          settleAcceptedPendingOnConflict: false,
        },
        async () => undefined,
      ),
    ).rejects.toThrow("recovery checkpoint was superseded");
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, initialRecord.id),
    ).toEqual(expectedRecord);
    expect(
      await sqlDocumentsPersistence.listPendingUpdates(
        execSql,
        initialRecord.id,
      ),
    ).toHaveLength(1);
    expect(
      await sqlDocumentsPersistence.loadHistoryRestoreState(
        execSql,
        initialRecord.id,
      ),
    ).toEqual({
      snapshot: storedSnapshot,
      tailUpdates: [{ origin: "local", updateData: candidateSnapshot }],
    });
  } finally {
    close();
  }
});
