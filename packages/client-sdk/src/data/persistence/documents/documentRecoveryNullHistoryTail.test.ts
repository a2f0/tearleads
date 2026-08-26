import { expect, test } from "bun:test";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import { sqlDocumentsPersistence } from "./documentsPersistence";

test("recovery rejects a matching history tail without a durable id", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-recovery-null-history-tail-id",
  );
  const recoveredDocument = await createDocument("null-tail-base-writer");
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    recoveredDocument.getText("text").update("verified base");
    const recoveredSnapshot = bytesToBase64(
      exportFullHistorySnapshot(recoveredDocument),
    );
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
    await execSql(
      `INSERT INTO document_history_updates (
        id, app_kind, local_id, update_data, origin, created_at
      ) VALUES (NULL, 'documents', ?, ?, 'remote', ?)`,
      [initialRecord.id, recoveredSnapshot, "2026-08-26T00:00:00.000Z"],
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
      tailUpdates: [{ origin: "remote", updateData: recoveredSnapshot }],
    });
  } finally {
    recoveredDocument.free();
    close();
  }
});
