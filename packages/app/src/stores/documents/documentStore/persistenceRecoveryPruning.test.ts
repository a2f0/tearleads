import { expect, test } from "bun:test";
import type { DocumentsPersistence } from "@symcrypt/client-sdk";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
} from "@symcrypt/loro";
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
}
