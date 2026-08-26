import { expect, test } from "bun:test";
import type {
  DocumentRecord,
  DocumentsPersistence,
  PendingUpdateRecord,
} from "@symcrypt/client-sdk";
import { createDocumentsPersistence } from "../../../../test/helpers/document-store/documentStoreSyncPersistence";
import { createRuntime } from "../../../../test/helpers/document-store/documentStoreSyncRuntime";
import {
  createDocumentStorePersistence,
  createDocumentStoreRuntime,
} from "../../../../test/helpers/documentStoreFixtures";

type MemoryPersistence = DocumentsPersistence & {
  getState: () => {
    document: DocumentRecord | null;
    pendingUpdates: PendingUpdateRecord[];
  };
};
type ExecSql = Parameters<DocumentsPersistence["saveDocument"]>[0];

const recoveredContainerId = "container-a";
const recoveredDocumentId = "document-a";
const recoveredRecord: DocumentRecord = {
  accessEpoch: 1,
  containerId: recoveredContainerId,
  documentId: recoveredDocumentId,
  id: "local-a",
  recoveryGeneration: 1,
  snapshotEndVersion: "",
  text: "recovered",
};
const pendingUpdate = {
  localId: recoveredRecord.id,
  partialEndVersionVector: "end",
  partialStartVersionVector: "start",
  sourceVersionVector: null,
  updateData: "current update",
};

async function expectRecoveryGenerationFence(
  persistence: MemoryPersistence,
  execSql: ExecSql,
): Promise<void> {
  await persistence.saveDocument(execSql, recoveredRecord);
  await persistence.upsertDiscoveredDocument(execSql, {
    accessEpoch: recoveredRecord.accessEpoch + 1,
    containerId: recoveredContainerId,
    createdAt: "2026-08-26T00:00:00.000Z",
    documentId: recoveredDocumentId,
    linkedContainerIds: [recoveredContainerId],
  });
  const staleRecord = {
    ...recoveredRecord,
    recoveryGeneration: 0,
    text: "stale save",
  };
  await persistence.saveDocument(execSql, staleRecord);
  expect(persistence.getState().document).toMatchObject({
    recoveryGeneration: 1,
    text: "recovered",
  });

  await expect(
    persistence.documentIdentityMatches(
      execSql,
      recoveredRecord.id,
      recoveredRecord.documentId,
      0,
    ),
  ).resolves.toBe(false);
  await expect(
    persistence.documentIdentityMatches(
      execSql,
      recoveredRecord.id,
      recoveredRecord.documentId,
      1,
    ),
  ).resolves.toBe(true);

  await expect(
    persistence.enqueuePendingUpdate(execSql, pendingUpdate, {
      expectedDocumentId: recoveredRecord.documentId,
      expectedRecoveryGeneration: 0,
    }),
  ).resolves.toBe(false);
  expect(persistence.getState().pendingUpdates).toEqual([]);
  await expect(
    persistence.loadHistoryRestoreState(execSql, recoveredRecord.id),
  ).resolves.toBeNull();

  await expect(
    persistence.enqueuePendingUpdate(execSql, pendingUpdate, {
      expectedDocumentId: recoveredRecord.documentId,
      expectedRecoveryGeneration: 1,
    }),
  ).resolves.toBe(true);
  const storedUpdate = persistence.getState().pendingUpdates[0];
  expect(storedUpdate).toBeDefined();
  if (!storedUpdate) return;

  await persistence.saveDocumentAndDeletePendingUpdates(execSql, staleRecord, [
    storedUpdate.id,
  ]);
  expect(persistence.getState().document).toMatchObject({
    recoveryGeneration: 1,
    text: "recovered",
  });
  expect(persistence.getState().pendingUpdates).toEqual([storedUpdate]);

  await persistence.settleAcceptedPendingUpdates(execSql, {
    expectedRecord: { ...recoveredRecord, recoveryGeneration: 0 },
    pendingUpdateIds: [storedUpdate.id],
  });
  expect(persistence.getState().pendingUpdates).toEqual([storedUpdate]);
}

async function expectRecoveryCasPreservesConcurrentWrite(
  persistence: MemoryPersistence,
  execSql: ExecSql,
  failProjectionSave = false,
): Promise<void> {
  const baseline = {
    ...recoveredRecord,
    recoveryGeneration: 0,
    text: "baseline",
  };
  await persistence.saveDocument(execSql, baseline);
  let releaseProjectionSave = () => {};
  const projectionSaveBlocked = new Promise<void>((resolve) => {
    releaseProjectionSave = resolve;
  });
  let signalProjectionSave = () => {};
  const projectionSaveStarted = new Promise<void>((resolve) => {
    signalProjectionSave = resolve;
  });
  const recovery = persistence.commitDocumentMutation(
    execSql,
    {
      acceptedPendingUpdateIds: [],
      document: recoveredRecord,
      expectedRecord: baseline,
      settleAcceptedPendingOnConflict: false,
    },
    async () => {
      signalProjectionSave();
      await projectionSaveBlocked;
      if (failProjectionSave) throw new Error("projection save failed");
    },
  );
  await projectionSaveStarted;

  let staleSaveCompleted = false;
  const staleSave = persistence
    .saveDocument(execSql, {
      ...baseline,
      text: "concurrent stale save",
    })
    .then(() => {
      staleSaveCompleted = true;
    });
  await staleSave;
  expect(staleSaveCompleted).toBe(true);
  releaseProjectionSave();

  if (failProjectionSave) {
    await expect(recovery).rejects.toThrow("projection save failed");
  } else {
    await expect(recovery).resolves.toMatchObject({ committed: false });
  }
  expect(persistence.getState().document).toMatchObject({
    recoveryGeneration: 0,
    text: "concurrent stale save",
  });
}

test("sync persistence fences a writer blocked behind raw recovery", async () => {
  const runtime = createRuntime();
  await expectRecoveryGenerationFence(
    createDocumentsPersistence(),
    runtime.infra.execSql,
  );
  await expectRecoveryCasPreservesConcurrentWrite(
    createDocumentsPersistence(),
    runtime.infra.execSql,
  );
  await expectRecoveryCasPreservesConcurrentWrite(
    createDocumentsPersistence(),
    runtime.infra.execSql,
    true,
  );
});

test("document-store persistence fences a writer blocked behind raw recovery", async () => {
  const runtime = createDocumentStoreRuntime();
  await expectRecoveryGenerationFence(
    createDocumentStorePersistence(),
    runtime.infra.execSql,
  );
  await expectRecoveryCasPreservesConcurrentWrite(
    createDocumentStorePersistence(),
    runtime.infra.execSql,
  );
  await expectRecoveryCasPreservesConcurrentWrite(
    createDocumentStorePersistence(),
    runtime.infra.execSql,
    true,
  );
});
