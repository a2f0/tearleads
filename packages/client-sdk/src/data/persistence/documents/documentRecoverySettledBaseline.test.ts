import { expect, test } from "bun:test";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import { sqlDocumentsPersistence } from "./documentsPersistence";

test("later recovery accepts an exact settled rotation baseline in the tail", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-recovery-settled-baseline-tail",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const recoveredDocument = await createDocument(
      "settled-baseline-history-writer",
    );
    recoveredDocument.getText("text").update("first rotation");
    recoveredDocument.commit();
    const baselineVersion = encodeVersionVector(recoveredDocument);
    const baselineSnapshot = bytesToBase64(
      exportFullHistorySnapshot(recoveredDocument),
    );
    const initialRecord = {
      accessEpoch: 1,
      containerId: "container-1",
      documentId: "document-1",
      id: "settled-baseline-local-document",
      snapshotEndVersion: baselineVersion,
      text: "first rotation",
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
      updates: [baselineSnapshot],
    });

    recoveredDocument.getText("text").update(" then later recovery");
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
            text: "first rotation then later recovery",
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
