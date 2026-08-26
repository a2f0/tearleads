import { expect, test } from "bun:test";
import type { DocumentsPersistence } from "@symcrypt/client-sdk";
import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  importSnapshot,
} from "@symcrypt/loro";
import { createDocumentsPersistence } from "../../../../test/helpers/document-store/documentStoreSyncPersistence";
import { createDocumentStorePersistence } from "../../../../test/helpers/documentStoreFixtures";

const persistenceFactories = [
  ["sync helper", createDocumentsPersistence],
  ["store helper", createDocumentStorePersistence],
] as const;

const execSql: Parameters<DocumentsPersistence["saveDocument"]>[0] =
  async () => [];

function record(localId: string, snapshotEndVersion: string, text: string) {
  return {
    accessEpoch: 1,
    containerId: "container-1",
    documentId: "document-1",
    id: localId,
    snapshotEndVersion,
    text,
  };
}

for (const [name, createPersistence] of persistenceFactories) {
  test(`${name} rejects a stale recovery checkpoint`, async () => {
    const persistence = createPersistence();
    const localId = `memory-recovery-stale-checkpoint-${name}`;
    const document = await createDocument(localId);
    document.getText("text").update("stale");
    document.commit();
    const staleVersion = encodeVersionVector(document);
    const staleSnapshot = bytesToBase64(exportFullHistorySnapshot(document));
    document.getText("text").update(" current");
    document.commit();
    const storedVersion = encodeVersionVector(document);
    const storedSnapshot = bytesToBase64(exportFullHistorySnapshot(document));
    const storedRecord = record(localId, storedVersion, "stale current");

    await persistence.createDocumentWithHistoryCheckpoint(
      execSql,
      storedRecord,
      { endVersionVector: storedVersion, snapshot: storedSnapshot },
      undefined,
      async () => undefined,
    );

    await expect(
      persistence.commitDocumentMutation(
        execSql,
        {
          acceptedPendingUpdateIds: [],
          document: storedRecord,
          expectedRecord: storedRecord,
          historyCheckpoint: {
            coveredTailIds: [],
            endVersionVector: staleVersion,
            pruneCoveredLocalState: true,
            snapshot: staleSnapshot,
          },
          settleAcceptedPendingOnConflict: false,
        },
        async () => undefined,
      ),
    ).rejects.toThrow("checkpoint was superseded");
    expect(await persistence.loadHistoryRestoreState(execSql, localId)).toEqual(
      { snapshot: storedSnapshot, tailUpdates: [] },
    );
    document.free();
  });

  test(`${name} rejects a same-frontier forked recovery checkpoint`, async () => {
    const persistence = createPersistence();
    const localId = `memory-recovery-forked-checkpoint-${name}`;
    const storedDocument = await createDocument(
      "memory-recovery-checkpoint-fork-writer",
    );
    storedDocument.getText("text").update("shared base");
    storedDocument.commit();
    const baseSnapshot = bytesToBase64(
      exportFullHistorySnapshot(storedDocument),
    );
    const candidateDocument = await createDocument(
      "memory-recovery-checkpoint-fork-writer",
    );
    importSnapshot(candidateDocument, base64ToBytes(baseSnapshot));
    storedDocument.getText("text").update(" genuine");
    storedDocument.commit();
    candidateDocument.getText("text").update(" forged!");
    candidateDocument.commit();
    const storedVersion = encodeVersionVector(storedDocument);
    const candidateVersion = encodeVersionVector(candidateDocument);
    expect(candidateVersion).toBe(storedVersion);
    const storedSnapshot = bytesToBase64(
      exportFullHistorySnapshot(storedDocument),
    );
    const candidateSnapshot = bytesToBase64(
      exportFullHistorySnapshot(candidateDocument),
    );
    const storedRecord = record(localId, storedVersion, "shared base genuine");

    await persistence.createDocumentWithHistoryCheckpoint(
      execSql,
      storedRecord,
      { endVersionVector: storedVersion, snapshot: storedSnapshot },
      undefined,
      async () => undefined,
    );

    await expect(
      persistence.commitDocumentMutation(
        execSql,
        {
          acceptedPendingUpdateIds: [],
          document: storedRecord,
          expectedRecord: storedRecord,
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
    ).rejects.toThrow("checkpoint was superseded");
    expect(await persistence.loadHistoryRestoreState(execSql, localId)).toEqual(
      { snapshot: storedSnapshot, tailUpdates: [] },
    );
    candidateDocument.free();
    storedDocument.free();
  });
}
