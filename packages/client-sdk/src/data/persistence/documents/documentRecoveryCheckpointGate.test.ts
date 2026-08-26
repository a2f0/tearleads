import { expect, test } from "bun:test";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  getUpdateVersionVectors,
  importSnapshot,
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

test("stale-pane compaction cannot replace recovered operation history", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-recovery-operation-identity-gate",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const baseDocument = await createDocument("checkpoint-base-writer");
    baseDocument.getText("text").update("base");
    const baseSnapshotBytes = exportFullHistorySnapshot(baseDocument);
    const baseSnapshot = bytesToBase64(baseSnapshotBytes);
    const baseVersion = encodeVersionVector(baseDocument);
    const recoveredDocument = await createDocument("checkpoint-fork-writer");
    const staleDocument = await createDocument("checkpoint-fork-writer");
    importSnapshot(recoveredDocument, baseSnapshotBytes);
    importSnapshot(staleDocument, baseSnapshotBytes);
    recoveredDocument.getText("text").update("verified");
    staleDocument.getText("text").update("tampered");
    const recoveredSnapshot = bytesToBase64(
      exportFullHistorySnapshot(recoveredDocument),
    );
    const staleSnapshot = bytesToBase64(
      exportFullHistorySnapshot(staleDocument),
    );
    const recoveredVersion = encodeVersionVector(recoveredDocument);
    const staleVersion = encodeVersionVector(staleDocument);
    expect(staleVersion).toBe(recoveredVersion);

    const initialRecord = {
      accessEpoch: 1,
      containerId: "container-1",
      documentId: "document-1",
      id: "local-document",
      snapshotEndVersion: baseVersion,
      text: "base",
    };
    await sqlDocumentsPersistence.createDocumentWithHistoryCheckpoint(
      execSql,
      initialRecord,
      { endVersionVector: baseVersion, snapshot: baseSnapshot },
      undefined,
      async () => undefined,
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
            text: "verified",
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

    await sqlDocumentsPersistence.replaceHistoryCheckpoint(execSql, {
      coveredTailIds: [],
      endVersionVector: staleVersion,
      localId: initialRecord.id,
      snapshot: staleSnapshot,
    });
    expect(
      await sqlDocumentsPersistence.loadHistoryRestoreState(
        execSql,
        initialRecord.id,
      ),
    ).toEqual({ snapshot: recoveredSnapshot, tailUpdates: [] });
  } finally {
    close();
  }
});

test("recovery install rejects an ordinary row appended after settlement", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-recovery-pending-install-gate",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const storedDocument = await createDocument("pending-gate-base-writer");
    storedDocument.getText("text").update("base");
    const storedSnapshotBytes = exportFullHistorySnapshot(storedDocument);
    const storedSnapshot = bytesToBase64(storedSnapshotBytes);
    const storedVersion = encodeVersionVector(storedDocument);
    const initialRecord = {
      accessEpoch: 1,
      containerId: "container-1",
      documentId: "document-1",
      id: "local-document",
      snapshotEndVersion: storedVersion,
      text: "base",
    };
    await sqlDocumentsPersistence.createDocumentWithHistoryCheckpoint(
      execSql,
      initialRecord,
      { endVersionVector: storedVersion, snapshot: storedSnapshot },
      undefined,
      async () => undefined,
    );
    const siblingDocument = await createDocument("pending-gate-sibling-writer");
    importSnapshot(siblingDocument, storedSnapshotBytes);
    siblingDocument.getText("text").update("base plus sibling edit");
    const siblingUpdateBytes = exportUpdatesSince(
      siblingDocument,
      storedVersion,
    );
    const siblingVectors = getUpdateVersionVectors(siblingUpdateBytes);
    const siblingUpdate = bytesToBase64(siblingUpdateBytes);
    await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
      localId: initialRecord.id,
      partialEndVersionVector: siblingVectors.partialEndVersionVector,
      partialStartVersionVector: siblingVectors.partialStartVersionVector,
      sourceVersionVector: null,
      updateData: siblingUpdate,
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
            endVersionVector: storedVersion,
            pruneCoveredLocalState: true,
            snapshot: storedSnapshot,
          },
          settleAcceptedPendingOnConflict: false,
        },
        async () => undefined,
      ),
    ).rejects.toThrow("unproven pending updates");
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
      tailUpdates: [{ origin: "local", updateData: siblingUpdate }],
    });
  } finally {
    close();
  }
});

test("recovery install rolls back when its generation changes during projection", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-recovery-generation-install-gate",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const recoveredDocument = await createDocument(
      "generation-install-gate-writer",
    );
    recoveredDocument.getText("text").update("verified base");
    recoveredDocument.commit();
    const baseSnapshot = bytesToBase64(
      exportFullHistorySnapshot(recoveredDocument),
    );
    const baseVersion = encodeVersionVector(recoveredDocument);
    recoveredDocument.getText("text").update("verified recovery");
    recoveredDocument.commit();
    const recoveredSnapshotBytes = exportFullHistorySnapshot(recoveredDocument);
    const recoveredSnapshot = bytesToBase64(recoveredSnapshotBytes);
    const recoveredVersion = encodeVersionVector(recoveredDocument);
    const recoveredVectors = getUpdateVersionVectors(recoveredSnapshotBytes);
    const initialRecord = {
      accessEpoch: 1,
      containerId: "container-1",
      documentId: "document-1",
      id: "local-document",
      snapshotEndVersion: baseVersion,
      text: "verified base",
    };
    await sqlDocumentsPersistence.createDocumentWithHistoryCheckpoint(
      execSql,
      initialRecord,
      { endVersionVector: baseVersion, snapshot: baseSnapshot },
      undefined,
      async () => undefined,
    );
    await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
      localId: initialRecord.id,
      partialEndVersionVector: recoveredVectors.partialEndVersionVector,
      partialStartVersionVector: recoveredVectors.partialStartVersionVector,
      sourceVersionVector: recoveredVersion,
      updateData: recoveredSnapshot,
    });
    const expectedRecord = await sqlDocumentsPersistence.loadDocument(
      execSql,
      initialRecord.id,
    );
    if (!expectedRecord) throw new Error("Expected the stored document");
    let generationCurrent = true;

    await expect(
      sqlDocumentsPersistence.commitDocumentMutation(
        execSql,
        {
          acceptedPendingUpdateIds: [],
          document: {
            ...expectedRecord,
            snapshotEndVersion: recoveredVersion,
            text: "verified recovery",
          },
          expectedRecord,
          historyCheckpoint: {
            coveredTailIds: [],
            endVersionVector: recoveredVersion,
            pruneCoveredLocalState: true,
            snapshot: recoveredSnapshot,
          },
          settleAcceptedPendingOnConflict: false,
          stillCurrent: () => generationCurrent,
        },
        async () => {
          generationCurrent = false;
        },
      ),
    ).resolves.toEqual({ committed: false, currentRecord: expectedRecord });
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
      snapshot: baseSnapshot,
      tailUpdates: [{ origin: "local", updateData: recoveredSnapshot }],
    });
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, initialRecord.id),
    ).toEqual(expectedRecord);
    recoveredDocument.free();
  } finally {
    close();
  }
});
