import { expect, test } from "bun:test";
import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  getTextValue,
  getUpdateVersionVectors,
  importSnapshot,
  satisfiesVersionVector,
} from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import { sqlDocumentsPersistence } from "./documentsPersistence";

test("recovery quarantines a racing checkpoint before restart", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-recovery-checkpoint-artifact-race",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const recoveredDocument = await createDocument("recovered-base-writer");
    recoveredDocument.getText("text").update("verified base");
    const recoveredSnapshotBytes = exportFullHistorySnapshot(recoveredDocument);
    const recoveredSnapshot = bytesToBase64(recoveredSnapshotBytes);
    const recoveredVersion = encodeVersionVector(recoveredDocument);
    const initialRecord = {
      accessEpoch: 1,
      containerId: "container-1",
      documentId: "document-1",
      id: "local-document",
      snapshotEndVersion: recoveredVersion,
      text: "verified base",
    };
    await sqlDocumentsPersistence.createDocumentWithHistoryCheckpoint(
      execSql,
      initialRecord,
      { endVersionVector: recoveredVersion, snapshot: recoveredSnapshot },
      undefined,
      async () => undefined,
    );

    const racingCheckpoint = await createDocument("racing-checkpoint-writer");
    importSnapshot(racingCheckpoint, recoveredSnapshotBytes);
    racingCheckpoint.getText("text").update("unverified checkpoint history");
    const racingSnapshotBytes = exportFullHistorySnapshot(racingCheckpoint);
    const racingSnapshot = bytesToBase64(racingSnapshotBytes);
    const racingVersion = encodeVersionVector(racingCheckpoint);
    const racingVectors = getUpdateVersionVectors(racingSnapshotBytes);
    expect(satisfiesVersionVector(recoveredVersion, racingVersion)).toBe(false);
    await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
      localId: initialRecord.id,
      partialEndVersionVector: racingVectors.partialEndVersionVector,
      partialStartVersionVector: racingVectors.partialStartVersionVector,
      sourceVersionVector: racingVersion,
      updateData: racingSnapshot,
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
          document: expectedRecord,
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
      await sqlDocumentsPersistence.listPendingUpdates(
        execSql,
        initialRecord.id,
      ),
    ).toEqual([]);
    const restartHistory =
      await sqlDocumentsPersistence.loadHistoryRestoreState(
        execSql,
        initialRecord.id,
      );
    expect(restartHistory).toEqual({
      snapshot: recoveredSnapshot,
      tailUpdates: [],
    });
    if (!restartHistory) throw new Error("Expected restart history");
    const restartedDocument = await createDocument("restart-reader");
    try {
      importSnapshot(restartedDocument, base64ToBytes(restartHistory.snapshot));
      expect(getTextValue(restartedDocument)).toBe("verified base");
    } finally {
      restartedDocument.free();
    }
    racingCheckpoint.free();
    recoveredDocument.free();
  } finally {
    close();
  }
});

test("recovery aborts on an unrelated tail outside the verified rebuild", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-recovery-unverified-tail-race",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const recoveredDocument = await createDocument("tail-gate-base-writer");
    recoveredDocument.getText("text").update("verified base");
    const recoveredSnapshotBytes = exportFullHistorySnapshot(recoveredDocument);
    const recoveredSnapshot = bytesToBase64(recoveredSnapshotBytes);
    const recoveredVersion = encodeVersionVector(recoveredDocument);
    const initialRecord = {
      accessEpoch: 1,
      containerId: "container-1",
      documentId: "document-1",
      id: "local-document",
      snapshotEndVersion: recoveredVersion,
      text: "verified base",
    };
    await sqlDocumentsPersistence.createDocumentWithHistoryCheckpoint(
      execSql,
      initialRecord,
      { endVersionVector: recoveredVersion, snapshot: recoveredSnapshot },
      undefined,
      async () => undefined,
    );
    const racingDocument = await createDocument("unrelated-tail-writer");
    importSnapshot(racingDocument, recoveredSnapshotBytes);
    racingDocument.getText("text").update("unverified remote tail");
    const racingUpdate = bytesToBase64(
      exportUpdatesSince(racingDocument, recoveredVersion),
    );
    await sqlDocumentsPersistence.appendHistoryUpdates(execSql, {
      localId: initialRecord.id,
      origin: "remote",
      updates: [racingUpdate],
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
          document: expectedRecord,
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
    ).rejects.toThrow("unverified history tail");
    expect(
      await sqlDocumentsPersistence.loadHistoryRestoreState(
        execSql,
        initialRecord.id,
      ),
    ).toEqual({
      snapshot: recoveredSnapshot,
      tailUpdates: [{ origin: "remote", updateData: racingUpdate }],
    });
    racingDocument.free();
    recoveredDocument.free();
  } finally {
    close();
  }
});
