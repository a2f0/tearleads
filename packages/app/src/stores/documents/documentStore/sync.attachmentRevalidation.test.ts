import { expect, test } from "bun:test";
import { createDocumentStore } from "@tearleads/client-sdk";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createMockApiClient } from "@tearleads/test-utils";
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
  attachmentProjectionCalls: string[];
  code?: string | undefined;
  offlineRuntime: Awaited<ReturnType<typeof createSyncRuntime>>;
  reportedErrors: string[];
  syncResultCalls: string[];
}) {
  return cloneDocumentsTestRuntime(input.offlineRuntime, {
    apiClient: createMockApiClient({
      getDocumentWriterProjection: async (documentId) => {
        input.attachmentProjectionCalls.push(documentId);
        return null;
      },
      syncDocumentResult: async (documentId) => {
        input.syncResultCalls.push(documentId);
        return {
          ...(input.code ? { code: input.code } : {}),
          kind: "http",
          message: `Remote document ${documentId} was not found`,
          method: "POST",
          ok: false,
          path: `/documents/${documentId}/sync`,
          report: () => {
            input.reportedErrors.push(documentId);
          },
          status: 404,
          statusText: "Not Found",
        };
      },
    }),
    state: { online: true },
  });
}

test("coded deletion clears a document before pending attachment upload", async () => {
  const { offlineRuntime, persistence, remoteDocumentId, store } =
    await createStoreWithPendingAttachment("deleted-before-attachment");
  const attachmentProjectionCalls: string[] = [];
  const reportedErrors: string[] = [];
  const syncResultCalls: string[] = [];
  const onlineRuntime = createSyncFailureRuntime({
    attachmentProjectionCalls,
    code: "document_not_found",
    offlineRuntime,
    reportedErrors,
    syncResultCalls,
  });

  store.updateRuntime(onlineRuntime);
  store.requestSync();

  await waitForCondition(
    () =>
      persistence.getState().document === null &&
      !store.getSnapshot().ready &&
      !store.getSnapshot().syncing,
    "Coded deletion did not clear the document before attachment upload.",
  );

  expect(persistence.getState().pendingAttachments).toEqual([]);
  expect(persistence.getState().pendingUpdates).toEqual([]);
  expect(syncResultCalls).toEqual([remoteDocumentId]);
  expect(attachmentProjectionCalls).toEqual([]);
  expect(reportedErrors).toEqual([]);
});

test("bare 404 keeps pending attachment state without attempting upload", async () => {
  const { offlineRuntime, persistence, remoteDocumentId, store } =
    await createStoreWithPendingAttachment("uncoded-before-attachment");
  const attachmentProjectionCalls: string[] = [];
  const reportedErrors: string[] = [];
  const syncResultCalls: string[] = [];
  const onlineRuntime = createSyncFailureRuntime({
    attachmentProjectionCalls,
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
  expect(attachmentProjectionCalls).toEqual([]);
  expect(reportedErrors).toEqual([remoteDocumentId]);
});
