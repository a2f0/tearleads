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
  getState: () => { pendingUpdates: PendingUpdateRecord[] };
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

  await persistence.settleAcceptedPendingUpdates(execSql, {
    expectedRecord: { ...recoveredRecord, recoveryGeneration: 0 },
    pendingUpdateIds: [storedUpdate.id],
  });
  expect(persistence.getState().pendingUpdates).toEqual([storedUpdate]);
}

test("sync persistence fences a writer blocked behind raw recovery", async () => {
  const runtime = createRuntime();
  await expectRecoveryGenerationFence(
    createDocumentsPersistence(),
    runtime.infra.execSql,
  );
});

test("document-store persistence fences a writer blocked behind raw recovery", async () => {
  const runtime = createDocumentStoreRuntime();
  await expectRecoveryGenerationFence(
    createDocumentStorePersistence(),
    runtime.infra.execSql,
  );
});
