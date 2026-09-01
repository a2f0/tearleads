import { expect, test } from "bun:test";
import { createDocument, encodeVersionVector } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { persistDocumentState } from "./persistence";

test("a stale recovery pane cannot restore an intermediate document cursor", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-recovery-settlement-race",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const document = await createDocument("document-recovery-stale-pane");
    document.getText("text").update("recovered content");
    const version = encodeVersionVector(document);
    const staleRecoveryRecord = {
      accessEpoch: 1,
      containerId: "container-1",
      documentId: "document-1",
      effectiveAccessLevel: "write" as const,
      id: "local-1",
      lastCommitLsn: "0/2",
      pendingBaseVersion: version,
      pullContinuationRecoveryRequired: true as const,
      snapshotEndVersion: version,
      text: "recovered content",
    };
    const {
      pullContinuationRecoveryRequired: _completedRecovery,
      ...completedRecoveryRecord
    } = staleRecoveryRecord;
    await sqlDocumentsPersistence.saveDocument(
      execSql,
      completedRecoveryRecord,
    );
    const staleIntermediateContinuation = {
      commitLsn: "0/3",
      commitLsnMode: "tracked" as const,
      cursor: "stale-recovery-page-2",
    };

    const settled = await persistDocumentState({
      currentDoc: document,
      currentRecord: staleRecoveryRecord,
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
      expectedSyncState: {
        pullContinuation: null,
        record: staleRecoveryRecord,
      },
      localId: staleRecoveryRecord.id,
      patch: {
        lastCommitLsn: "0/3",
        pullContinuation: staleIntermediateContinuation,
      },
      persistence: sqlDocumentsPersistence,
    });

    expect(settled?.pullContinuationSuperseded).toBe(true);
    expect(settled?.record.lastCommitLsn).toBe("0/2");
    expect(settled?.record.pullContinuation).toBeUndefined();
    expect(settled?.record.pullContinuationRecoveryRequired).toBeUndefined();
    const restarted = await sqlDocumentsPersistence.loadDocument(
      execSql,
      staleRecoveryRecord.id,
    );
    expect(restarted?.lastCommitLsn).toBe("0/2");
    expect(restarted?.pullContinuation).toBeUndefined();
    expect(restarted?.pullContinuationRecoveryRequired).toBeUndefined();
  } finally {
    close();
  }
});

test("an ordinary save reloads after raw recovery advances its fence", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-recovery-save-fence",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const document = await createDocument("document-recovery-save-fence");
    document.getText("text").update("stale pane");
    const version = encodeVersionVector(document);
    const staleRecord = {
      accessEpoch: 1,
      containerId: "container-1",
      documentId: "document-1",
      effectiveAccessLevel: "write" as const,
      id: "local-1",
      recoveryGeneration: 0,
      snapshotEndVersion: version,
      text: "before recovery",
    };
    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...staleRecord,
      recoveryGeneration: 1,
      text: "recovered winner",
    });
    await sqlDocumentsPersistence.saveDocument(execSql, {
      ...staleRecord,
      text: "unconditional stale save",
    });
    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, staleRecord.id),
    ).resolves.toMatchObject({
      recoveryGeneration: 1,
      text: "recovered winner",
    });

    const settled = await persistDocumentState({
      currentDoc: document,
      currentRecord: staleRecord,
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
      localId: staleRecord.id,
      patch: { text: "stale pane" },
      persistence: sqlDocumentsPersistence,
    });

    expect(settled).toMatchObject({
      pullContinuationSuperseded: true,
      record: { recoveryGeneration: 1, text: "recovered winner" },
    });
    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, staleRecord.id),
    ).resolves.toMatchObject({
      recoveryGeneration: 1,
      text: "recovered winner",
    });
  } finally {
    close();
  }
});

test("a stale response cannot settle pending rows across the fence", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-recovery-response-fence",
  );
  const recoveredDocument = {
    accessEpoch: 1,
    containerId: "container-1",
    documentId: "remote-document-1",
    id: "local-document-1",
    recoveryGeneration: 1,
    snapshotEndVersion: "recovered-version",
    text: "recovered winner",
  };

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(execSql, recoveredDocument);
    await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
      localId: recoveredDocument.id,
      partialEndVersionVector: "pending-end",
      partialStartVersionVector: "pending-start",
      sourceVersionVector: null,
      updateData: "pending-update",
    });
    const pendingUpdates = await sqlDocumentsPersistence.listPendingUpdates(
      execSql,
      recoveredDocument.id,
    );
    const acceptedUpdate = pendingUpdates[0];
    if (!acceptedUpdate) throw new Error("Expected a pending update");

    await sqlDocumentsPersistence.saveDocumentAndDeletePendingUpdates(
      execSql,
      {
        ...recoveredDocument,
        recoveryGeneration: 0,
        snapshotEndVersion: "stale-version",
        text: "stale response",
      },
      [acceptedUpdate.id],
    );

    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, recoveredDocument.id),
    ).resolves.toMatchObject(recoveredDocument);
    await expect(
      sqlDocumentsPersistence.listPendingUpdates(execSql, recoveredDocument.id),
    ).resolves.toEqual(pendingUpdates);
  } finally {
    close();
  }
});
