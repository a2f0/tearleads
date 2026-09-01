import { expect, test } from "bun:test";
import {
  createDocumentStore,
  createDomainScope,
  createMemoryBlobStore,
  getOrCreateDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { cloneDocumentsTestRuntime } from "../../../../test/helpers/document-store/documentStoreSyncFixtures";
import { createDocumentsPersistence } from "../../../../test/helpers/document-store/documentStoreSyncPersistence";
import { createSyncRuntime } from "../../../../test/helpers/document-store/documentStoreSyncRuntime";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

test("restarted clean remote document imports peer text and attachment without a websocket event", async () => {
  const peerPersistence = createDocumentsPersistence();
  const stalePersistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const attachmentBytes = new TextEncoder().encode("peer attachment bytes");
  const syncDocumentCalls: Array<{
    minLsn: string | null;
    outgoingUpdateCount: number;
  }> = [];
  const runtime = await createSyncRuntime(
    encapsulationKeyPair,
    "root-container",
    {
      commitLsnForSyncCount: (syncCount) => `0/${syncCount * 10}`,
      syncCalls: syncDocumentCalls,
    },
  );
  const committedUpdates = new Map<
    string,
    DocumentSyncResponse["updates"][number]
  >();
  const syncDocument = runtime.apiClient.syncDocument.bind(runtime.apiClient);
  Object.assign(runtime.apiClient, {
    async syncDocument(documentId: string, request: DocumentSyncRequest) {
      const response = await syncDocument(documentId, request);
      if (!response) return null;

      for (const update of response.updates) {
        committedUpdates.set(update.id, update);
      }
      return {
        ...response,
        updates: [...committedUpdates.values()],
      };
    },
  });
  const peerStore = createDocumentStore(
    "restart-clean-sync",
    runtime,
    peerPersistence,
  );
  peerStore.updateRuntime(runtime);

  await waitForCondition(
    () =>
      syncDocumentCalls.length === 1 &&
      peerPersistence.getState().document?.lastCommitLsn === "0/10" &&
      !peerStore.getSnapshot().syncing,
    "Initial document create did not settle.",
  );

  const staleRecord = peerPersistence.getState().document;
  if (!staleRecord) {
    throw new Error("Expected a persisted remote document before peer edits.");
  }
  await stalePersistence.saveDocument(
    runtime.infra.execSql,
    structuredClone(staleRecord),
  );

  await peerStore.setText("edited on the peer device");
  await waitForCondition(
    () =>
      syncDocumentCalls.length === 2 &&
      peerPersistence.getState().pendingUpdates.length === 0 &&
      !peerStore.getSnapshot().syncing,
    "Peer text edit did not settle.",
  );
  peerStore.attachFiles([
    {
      bytes: attachmentBytes,
      mimeType: "text/plain",
      name: "peer.txt",
    },
  ]);
  await waitForCondition(
    () =>
      peerPersistence.getState().pendingAttachments.length === 0 &&
      peerPersistence.getState().pendingUpdates.length === 0 &&
      peerStore.getSnapshot().attachments.length === 1 &&
      committedUpdates.size >= 2 &&
      !peerStore.getSnapshot().syncing,
    "Peer attachment did not upload and settle.",
  );

  const restartedBlobStore = createMemoryBlobStore();
  const restartedRuntime = cloneDocumentsTestRuntime(runtime, {
    infra: { blobStore: restartedBlobStore },
    state: {
      domainScope: createDomainScope(),
      events: [],
    },
  });
  const restartedStore = createDocumentStore(
    "restart-clean-sync",
    restartedRuntime,
    stalePersistence,
  );
  restartedStore.updateRuntime(restartedRuntime);

  await waitForCondition(
    () => restartedStore.getSnapshot().ready,
    "Restarted clean document did not initialize.",
  );
  await waitForCondition(() => {
    const snapshot = restartedStore.getSnapshot();
    const attachment = snapshot.attachments[0];
    return (
      snapshot.text === "edited on the peer device" &&
      attachment?.name === "peer.txt" &&
      snapshot.attachmentStorageKeyBySlotId[attachment.slotId] !== undefined &&
      !snapshot.syncing
    );
  }, "Restarted clean document did not import peer text and attachment state.");

  const snapshot = restartedStore.getSnapshot();
  const attachment = snapshot.attachments[0];
  if (!attachment) {
    throw new Error("Expected the peer attachment after restart revalidation.");
  }
  const storageKey = snapshot.attachmentStorageKeyBySlotId[attachment.slotId];
  if (!storageKey) {
    throw new Error("Expected hydrated peer attachment storage.");
  }
  expect(snapshot.text).toBe("edited on the peer device");
  expect(attachment).toMatchObject({
    byteLength: attachmentBytes.byteLength,
    mimeType: "text/plain",
    name: "peer.txt",
  });
  const hydratedBytes = await restartedBlobStore.readBytes(storageKey);
  if (!hydratedBytes) {
    throw new Error("Expected hydrated peer attachment bytes.");
  }
  expect(new TextDecoder().decode(hydratedBytes)).toBe("peer attachment bytes");
  expect(syncDocumentCalls.at(-1)).toEqual({
    minLsn: "0/10",
    outgoingUpdateCount: 0,
  });
}, 15_000);

test("clean open remote document revalidates after server events reconnect", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const syncDocumentCalls: Array<{
    minLsn: string | null;
    outgoingUpdateCount: number;
  }> = [];
  const runtime = await createSyncRuntime(
    encapsulationKeyPair,
    "root-container",
    {
      commitLsnForSyncCount: (syncCount) => `0/${syncCount * 10}`,
      syncCalls: syncDocumentCalls,
    },
  );
  const connectedRuntime = cloneDocumentsTestRuntime(runtime, {
    state: { serverEventsConnectionGeneration: 1 },
  });
  const store = createDocumentStore(
    "reconnect-clean-sync",
    connectedRuntime,
    persistence,
  );
  store.updateRuntime(connectedRuntime);

  await waitForCondition(
    () =>
      syncDocumentCalls.length === 1 &&
      persistence.getState().document?.lastCommitLsn === "0/10" &&
      !store.getSnapshot().syncing,
    "Initial document create did not settle before reconnect.",
  );

  // A retained store can miss the intermediate disconnected runtime while its
  // provider is unmounted (and React may coalesce false -> true). The monotonic
  // generation must still make the restored baseline observable on reopen.
  await getOrCreateDomainSyncCoordinator(
    runtime.state.domainScope,
  ).waitForIdle();
  expect(syncDocumentCalls).toHaveLength(1);

  const reconnectedRuntime = cloneDocumentsTestRuntime(connectedRuntime, {
    state: { serverEventsConnectionGeneration: 2 },
  });
  store.updateRuntime(reconnectedRuntime);

  await waitForCondition(
    () => syncDocumentCalls.length >= 2 && !store.getSnapshot().syncing,
    "Server-events reconnect did not revalidate the open document.",
  );

  expect(persistence.getState().document?.lastCommitLsn).toBe("0/20");
  expect(syncDocumentCalls[1]).toEqual({
    minLsn: "0/10",
    outgoingUpdateCount: 0,
  });
});
