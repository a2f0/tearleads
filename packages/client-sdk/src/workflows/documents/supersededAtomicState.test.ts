import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { persistDocumentState } from "./persistence";

test("a superseded settlement adopts one atomic record and history pair", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-superseded-atomic-state",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const staleDoc = await createDocument("document-atomic-stale");
    staleDoc.getText("text").update("stale page");
    staleDoc.commit();
    const staleRecord = {
      accessEpoch: 1,
      containerId: "container-old",
      documentId: "remote-old",
      id: "local-1",
      lastCommitLsn: "0/2",
      snapshotEndVersion: encodeVersionVector(staleDoc),
      text: "stale page",
    };
    const settledRecord = {
      ...staleRecord,
      lastCommitLsn: "0/3",
      text: "settled winner",
    };
    await sqlDocumentsPersistence.saveDocument(execSql, settledRecord);

    const atomicWinnerDoc = await createDocument("document-atomic-winner");
    atomicWinnerDoc.getText("text").update("atomic winner");
    atomicWinnerDoc.commit();
    const atomicWinner = {
      ...settledRecord,
      accessEpoch: 2,
      containerId: "container-new",
      documentId: "remote-new",
      lastCommitLsn: "0/4",
      snapshotEndVersion: encodeVersionVector(atomicWinnerDoc),
      text: "atomic winner",
    };
    const atomicHistory = {
      snapshot: bytesToBase64(exportFullHistorySnapshot(atomicWinnerDoc)),
      tailUpdates: [],
    };
    let atomicLoadCount = 0;
    const persistence = {
      ...sqlDocumentsPersistence,
      loadDocumentWithHistoryRestoreState: async () => {
        atomicLoadCount += 1;
        return {
          document: atomicWinner,
          historyRestoreState: atomicHistory,
        };
      },
      loadHistoryRestoreState: async () => {
        throw new Error("superseded recovery must not split its history read");
      },
    };

    const result = await persistDocumentState({
      currentDoc: staleDoc,
      currentRecord: staleRecord,
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
      expectedSyncState: { pullContinuation: null, record: staleRecord },
      localId: staleRecord.id,
      patch: { lastCommitLsn: "0/3", pullContinuation: null },
      persistence,
    });

    expect(atomicLoadCount).toBe(1);
    expect(result).toMatchObject({
      historyRestoreState: atomicHistory,
      pullContinuationSuperseded: true,
      record: atomicWinner,
      syncIdentitySuperseded: true,
    });
  } finally {
    close();
  }
});
