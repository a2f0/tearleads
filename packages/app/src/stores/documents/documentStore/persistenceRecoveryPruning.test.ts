import { expect, test } from "bun:test";
import type { DocumentsPersistence } from "@tearleads/client-sdk";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  getUpdateVersionVectors,
  importSnapshot,
} from "@tearleads/loro";
import { createDocumentsPersistence } from "../../../../test/helpers/document-store/documentStoreSyncPersistence";
import { createDocumentStorePersistence } from "../../../../test/helpers/documentStoreFixtures";

const persistenceFactories = [
  ["sync helper", createDocumentsPersistence],
  ["store helper", createDocumentStorePersistence],
] as const;

for (const [name, createPersistence] of persistenceFactories) {
  test(`${name} atomically prunes recovery-covered local history`, async () => {
    const persistence = createPersistence();
    const execSql: Parameters<DocumentsPersistence["saveDocument"]>[0] =
      async () => [];
    const localId = `recovery-pruning-${name}`;
    const loroDocument = await createDocument(localId);
    const initialVersion = encodeVersionVector(loroDocument);
    loroDocument.getText("text").update("covered local edit");
    const recoveredVersion = encodeVersionVector(loroDocument);
    const updateData = bytesToBase64(
      exportUpdatesSince(loroDocument, initialVersion),
    );
    const recoveredSnapshot = bytesToBase64(
      exportFullHistorySnapshot(loroDocument),
    );
    const initialRecord = {
      accessEpoch: 1,
      containerId: "container-1",
      documentId: "document-1",
      id: localId,
      snapshotEndVersion: initialVersion,
      text: "",
    };

    await persistence.saveDocument(execSql, initialRecord);
    await persistence.enqueuePendingUpdate(execSql, {
      localId,
      partialEndVersionVector: recoveredVersion,
      partialStartVersionVector: initialVersion,
      sourceVersionVector: recoveredVersion,
      updateData,
    });

    const mutation = {
      acceptedPendingUpdateIds: [],
      document: {
        ...initialRecord,
        snapshotEndVersion: recoveredVersion,
        text: "covered local edit",
      },
      expectedRecord: initialRecord,
      historyCheckpoint: {
        coveredTailIds: [],
        endVersionVector: recoveredVersion,
        pruneCoveredLocalState: true,
        snapshot: recoveredSnapshot,
      },
      settleAcceptedPendingOnConflict: false,
    };

    await expect(
      persistence.commitDocumentMutation(execSql, mutation, async () => {
        throw new Error("projection failed");
      }),
    ).rejects.toThrow("projection failed");
    expect(persistence.getState().pendingUpdates).toHaveLength(1);
    expect(
      (await persistence.loadHistoryRestoreState(execSql, localId))
        ?.tailUpdates,
    ).toHaveLength(1);
    expect(await persistence.loadDocument(execSql, localId)).toEqual(
      initialRecord,
    );

    await expect(
      persistence.commitDocumentMutation(execSql, mutation, async () => {}),
    ).resolves.toMatchObject({ committed: true });
    expect(persistence.getState().pendingUpdates).toHaveLength(0);
    expect(await persistence.loadHistoryRestoreState(execSql, localId)).toEqual(
      { snapshot: recoveredSnapshot, tailUpdates: [] },
    );
  });

  test(`${name} rejects an ordinary row appended before recovery install`, async () => {
    const persistence = createPersistence();
    const execSql: Parameters<DocumentsPersistence["saveDocument"]>[0] =
      async () => [];
    const localId = `recovery-ordinary-race-${name}`;
    const loroDocument = await createDocument(localId);
    loroDocument.getText("text").update("verified base");
    const recoveredVersion = encodeVersionVector(loroDocument);
    const recoveredSnapshot = bytesToBase64(
      exportFullHistorySnapshot(loroDocument),
    );
    const initialRecord = {
      accessEpoch: 1,
      containerId: "container-1",
      documentId: "document-1",
      id: localId,
      snapshotEndVersion: recoveredVersion,
      text: "verified base",
    };
    await persistence.saveDocument(execSql, initialRecord);
    loroDocument.getText("text").update("late ordinary edit");
    const updateBytes = exportUpdatesSince(loroDocument, recoveredVersion);
    const vectors = getUpdateVersionVectors(updateBytes);
    await persistence.enqueuePendingUpdate(execSql, {
      localId,
      partialEndVersionVector: vectors.partialEndVersionVector,
      partialStartVersionVector: vectors.partialStartVersionVector,
      sourceVersionVector: null,
      updateData: bytesToBase64(updateBytes),
    });

    await expect(
      persistence.commitDocumentMutation(
        execSql,
        {
          acceptedPendingUpdateIds: [],
          document: initialRecord,
          expectedRecord: initialRecord,
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
    ).rejects.toThrow("unproven pending updates");
    expect(persistence.getState().pendingUpdates).toHaveLength(1);
    expect(
      (await persistence.loadHistoryRestoreState(execSql, localId))
        ?.tailUpdates,
    ).toHaveLength(1);
    expect(await persistence.loadDocument(execSql, localId)).toEqual(
      initialRecord,
    );
  });

  test(`${name} quarantines an unverified checkpoint artifact`, async () => {
    const persistence = createPersistence();
    const execSql: Parameters<DocumentsPersistence["saveDocument"]>[0] =
      async () => [];
    const localId = `recovery-checkpoint-race-${name}`;
    const loroDocument = await createDocument(localId);
    loroDocument.getText("text").update("verified base");
    const recoveredVersion = encodeVersionVector(loroDocument);
    const recoveredSnapshot = bytesToBase64(
      exportFullHistorySnapshot(loroDocument),
    );
    const initialRecord = {
      accessEpoch: 1,
      containerId: "container-1",
      documentId: "document-1",
      id: localId,
      snapshotEndVersion: recoveredVersion,
      text: "verified base",
    };
    await persistence.saveDocument(execSql, initialRecord);
    loroDocument.getText("text").update("unverified checkpoint history");
    const checkpointBytes = exportFullHistorySnapshot(loroDocument);
    const vectors = getUpdateVersionVectors(checkpointBytes);
    await persistence.enqueuePendingUpdate(execSql, {
      localId,
      partialEndVersionVector: vectors.partialEndVersionVector,
      partialStartVersionVector: vectors.partialStartVersionVector,
      sourceVersionVector: vectors.partialEndVersionVector,
      updateData: bytesToBase64(checkpointBytes),
    });

    await expect(
      persistence.commitDocumentMutation(
        execSql,
        {
          acceptedPendingUpdateIds: [],
          document: initialRecord,
          expectedRecord: initialRecord,
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
    expect(persistence.getState().pendingUpdates).toEqual([]);
    expect(await persistence.loadHistoryRestoreState(execSql, localId)).toEqual(
      { snapshot: recoveredSnapshot, tailUpdates: [] },
    );
  });

  test(`${name} rejects a same-frontier forged history tail`, async () => {
    const persistence = createPersistence();
    const execSql: Parameters<DocumentsPersistence["saveDocument"]>[0] =
      async () => [];
    const localId = `recovery-same-frontier-tail-${name}`;
    const genuineDocument = await createDocument("memory-tail-fork-writer");
    genuineDocument.getText("text").update("verified base");
    genuineDocument.commit();
    const baseVersion = encodeVersionVector(genuineDocument);
    const baseSnapshot = bytesToBase64(
      exportFullHistorySnapshot(genuineDocument),
    );
    const forgedDocument = await createDocument("memory-tail-fork-writer");
    importSnapshot(forgedDocument, base64ToBytes(baseSnapshot));
    genuineDocument.getText("text").update("genuine suffix");
    genuineDocument.commit();
    const recoveredVersion = encodeVersionVector(genuineDocument);
    const recoveredSnapshot = bytesToBase64(
      exportFullHistorySnapshot(genuineDocument),
    );
    forgedDocument.getText("text").update("forged! suffix");
    forgedDocument.commit();
    expect(encodeVersionVector(forgedDocument)).toBe(recoveredVersion);
    const forgedUpdate = bytesToBase64(
      exportUpdatesSince(forgedDocument, baseVersion),
    );
    const initialRecord = {
      accessEpoch: 1,
      containerId: "container-1",
      documentId: "document-1",
      id: localId,
      snapshotEndVersion: baseVersion,
      text: "verified base",
    };
    await persistence.createDocumentWithHistoryCheckpoint(
      execSql,
      initialRecord,
      { endVersionVector: baseVersion, snapshot: baseSnapshot },
      undefined,
      async () => undefined,
    );
    await persistence.appendHistoryUpdates(execSql, {
      localId,
      origin: "remote",
      updates: [forgedUpdate],
    });

    await expect(
      persistence.commitDocumentMutation(
        execSql,
        {
          acceptedPendingUpdateIds: [],
          document: {
            ...initialRecord,
            snapshotEndVersion: recoveredVersion,
            text: "verified basegenuine suffix",
          },
          expectedRecord: initialRecord,
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
    expect(await persistence.loadHistoryRestoreState(execSql, localId)).toEqual(
      {
        snapshot: baseSnapshot,
        tailUpdates: [{ origin: "remote", updateData: forgedUpdate }],
      },
    );
    forgedDocument.free();
    genuineDocument.free();
  });

  test(`${name} rolls back recovery when its generation changes`, async () => {
    const persistence = createPersistence();
    const execSql: Parameters<DocumentsPersistence["saveDocument"]>[0] =
      async () => [];
    const localId = `recovery-generation-change-${name}`;
    const document = await createDocument("memory-generation-change");
    document.getText("text").update("verified base");
    document.commit();
    const snapshot = bytesToBase64(exportFullHistorySnapshot(document));
    const version = encodeVersionVector(document);
    const initialRecord = {
      accessEpoch: 1,
      containerId: "container-1",
      documentId: "document-1",
      id: localId,
      snapshotEndVersion: version,
      text: "verified base",
    };
    await persistence.createDocumentWithHistoryCheckpoint(
      execSql,
      initialRecord,
      { endVersionVector: version, snapshot },
      undefined,
      async () => undefined,
    );
    let generationCurrent = true;

    await expect(
      persistence.commitDocumentMutation(
        execSql,
        {
          acceptedPendingUpdateIds: [],
          document: initialRecord,
          expectedRecord: initialRecord,
          historyCheckpoint: {
            coveredTailIds: [],
            endVersionVector: version,
            pruneCoveredLocalState: true,
            snapshot,
          },
          settleAcceptedPendingOnConflict: false,
          stillCurrent: () => generationCurrent,
        },
        async () => {
          generationCurrent = false;
        },
      ),
    ).resolves.toEqual({ committed: false, currentRecord: initialRecord });
    expect(await persistence.loadHistoryRestoreState(execSql, localId)).toEqual(
      { snapshot, tailUpdates: [] },
    );
    expect(await persistence.loadDocument(execSql, localId)).toEqual(
      initialRecord,
    );
    document.free();
  });
}
