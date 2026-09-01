import { expect, test } from "bun:test";
import { createDocumentStore } from "@tearleads/client-sdk";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createMockApiClient } from "@tearleads/test-utils";
import { DOCUMENT_NOT_FOUND_ERROR_CODE } from "@tearleads/validators/response";
import { cloneDocumentsTestRuntime } from "../../../../test/helpers/document-store/documentStoreSyncFixtures";
import { createDocumentsPersistence } from "../../../../test/helpers/document-store/documentStoreSyncPersistence";
import { createSyncRuntime } from "../../../../test/helpers/document-store/documentStoreSyncRuntime";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

async function createStoreWithPendingAttachment(localId: string) {
  const persistence = createDocumentsPersistence();
  const onlineRuntime = await createSyncRuntime(generateKemSeedAndKeyPair());
  const store = createDocumentStore(localId, onlineRuntime, persistence);
  store.updateRuntime(onlineRuntime);

  await waitForCondition(
    () =>
      persistence.getState().document?.documentId != null &&
      !store.getSnapshot().syncing,
    "Remote document did not settle before going offline.",
  );

  const offlineRuntime = cloneDocumentsTestRuntime(onlineRuntime, {
    state: { online: false },
  });
  store.updateRuntime(offlineRuntime);
  await store.attachFiles([
    {
      bytes: new TextEncoder().encode("pending attachment"),
      mimeType: "text/plain",
      name: "pending.txt",
    },
  ]);

  await waitForCondition(
    () =>
      persistence.getState().pendingAttachments.length === 1 &&
      persistence.getState().pendingUpdates.length > 0,
    "Attachment state was not queued before reconnect.",
  );

  const remoteDocumentId = persistence.getState().document?.documentId;
  if (!remoteDocumentId) {
    throw new Error("Expected a remote document before reconnect.");
  }
  return { offlineRuntime, persistence, remoteDocumentId, store };
}

function createSyncFailureRuntime(input: {
  blobStageCalls: number[];
  code?: string | undefined;
  offlineRuntime: Awaited<ReturnType<typeof createSyncRuntime>>;
  purgeProofCalls?: string[] | undefined;
  reportedErrors: string[];
  status?: number | undefined;
  syncResultCalls: string[];
}) {
  const status = input.status ?? 404;
  return cloneDocumentsTestRuntime(input.offlineRuntime, {
    apiClient: createMockApiClient({
      getDocumentPurgeProof: async (documentId) => {
        input.purgeProofCalls?.push(documentId);
        return null;
      },
      initiateMultipartBlobStage: async () => {
        input.blobStageCalls.push(1);
        return null;
      },
      syncDocumentResult: async (documentId) => {
        input.syncResultCalls.push(documentId);
        return {
          ...(input.code ? { code: input.code } : {}),
          kind: "http",
          message: `Remote document ${documentId} sync failed`,
          method: "POST",
          ok: false,
          path: `/documents/${documentId}/sync`,
          report: () => {
            input.reportedErrors.push(documentId);
          },
          status,
          statusText: status === 404 ? "Not Found" : "Server Error",
        };
      },
    }),
    state: { online: true },
  });
}

test("coded deletion without a signed proof preserves pending attachment state", async () => {
  const { offlineRuntime, persistence, remoteDocumentId, store } =
    await createStoreWithPendingAttachment("deleted-before-attachment");
  const blobStageCalls: number[] = [];
  const reportedErrors: string[] = [];
  const purgeProofCalls: string[] = [];
  const syncResultCalls: string[] = [];
  const onlineRuntime = createSyncFailureRuntime({
    blobStageCalls,
    code: DOCUMENT_NOT_FOUND_ERROR_CODE,
    offlineRuntime,
    purgeProofCalls,
    reportedErrors,
    syncResultCalls,
  });

  store.updateRuntime(onlineRuntime);
  store.requestSync();

  await waitForCondition(
    () => syncResultCalls.length === 1 && !store.getSnapshot().syncing,
    "Unproven deletion did not finish the attachment revalidation pass.",
  );

  expect(persistence.getState().document).not.toBeNull();
  expect(persistence.getState().pendingAttachments).toHaveLength(1);
  expect(persistence.getState().pendingUpdates.length).toBeGreaterThan(0);
  expect(store.getSnapshot().ready).toBe(true);
  expect(syncResultCalls).toEqual([remoteDocumentId]);
  expect(purgeProofCalls).toEqual([remoteDocumentId]);
  expect(blobStageCalls).toEqual([]);
  expect(reportedErrors).toEqual([]);
});

test("bare 404 keeps pending attachment state without attempting upload", async () => {
  const { offlineRuntime, persistence, remoteDocumentId, store } =
    await createStoreWithPendingAttachment("uncoded-before-attachment");
  const blobStageCalls: number[] = [];
  const reportedErrors: string[] = [];
  const syncResultCalls: string[] = [];
  const onlineRuntime = createSyncFailureRuntime({
    blobStageCalls,
    offlineRuntime,
    reportedErrors,
    syncResultCalls,
  });

  store.updateRuntime(onlineRuntime);
  store.requestSync();

  await waitForCondition(
    () => syncResultCalls.length === 1 && !store.getSnapshot().syncing,
    "Bare 404 did not finish the attachment revalidation pass.",
  );

  expect(persistence.getState().document).not.toBeNull();
  expect(persistence.getState().pendingAttachments).toHaveLength(1);
  expect(persistence.getState().pendingUpdates.length).toBeGreaterThan(0);
  expect(store.getSnapshot().ready).toBe(true);
  expect(blobStageCalls).toEqual([]);
  expect(reportedErrors).toEqual([remoteDocumentId]);
});

test("transient sync failure parks attachment upload without hot-looping", async () => {
  const { offlineRuntime, persistence, remoteDocumentId, store } =
    await createStoreWithPendingAttachment("transient-before-attachment");
  const blobStageCalls: number[] = [];
  const reportedErrors: string[] = [];
  const syncResultCalls: string[] = [];
  const onlineRuntime = createSyncFailureRuntime({
    blobStageCalls,
    offlineRuntime,
    reportedErrors,
    status: 500,
    syncResultCalls,
  });

  store.updateRuntime(onlineRuntime);
  store.requestSync();

  await waitForCondition(
    () => syncResultCalls.length === 1 && !store.getSnapshot().syncing,
    "Transient failure did not finish the attachment revalidation pass.",
  );
  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(syncResultCalls).toEqual([remoteDocumentId]);
  expect(persistence.getState().document).not.toBeNull();
  expect(persistence.getState().pendingAttachments).toHaveLength(1);
  expect(persistence.getState().pendingUpdates.length).toBeGreaterThan(0);
  expect(blobStageCalls).toEqual([]);
  expect(reportedErrors).toEqual([remoteDocumentId]);
});
