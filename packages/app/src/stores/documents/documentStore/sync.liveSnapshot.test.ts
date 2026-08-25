import { expect, test } from "bun:test";
import {
  createDocumentStore,
  createDomainScope,
  type DocumentsPersistence,
  getOrCreateDomainSyncCoordinator,
} from "@symcrypt/client-sdk";
import { generateKemSeedAndKeyPair } from "@symcrypt/crypto";
import { base64ToBytes } from "@symcrypt/encoding";
import { getImportBlobMetadata } from "@symcrypt/loro";
import type { DocumentSyncRequest } from "@symcrypt/validators/request";
import type { DocumentSyncResponse } from "@symcrypt/validators/response";
import { cloneDocumentsTestRuntime } from "../../../../test/helpers/document-store/documentStoreSyncFixtures";
import { createDocumentsPersistence } from "../../../../test/helpers/document-store/documentStoreSyncPersistence";
import { createSyncRuntime } from "../../../../test/helpers/document-store/documentStoreSyncRuntime";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

function createGate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test("streamed peer text publishes after a local write settles", async () => {
  const peerPersistence = createDocumentsPersistence();
  const receiverBasePersistence = createDocumentsPersistence();
  const postCommitGate = createGate();
  let gateReceiverPostCommit = false;
  let gatedCommitCount = 0;
  const receiverPersistence: DocumentsPersistence = {
    ...receiverBasePersistence,
    async readHistoryTailSize(...args) {
      const tailSize = await receiverBasePersistence.readHistoryTailSize(
        ...args,
      );
      if (gateReceiverPostCommit) {
        gateReceiverPostCommit = false;
        gatedCommitCount += 1;
        await postCommitGate.promise;
      }
      return tailSize;
    },
  };
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const syncCalls: Array<{
    minLsn: string | null;
    outgoingUpdateCount: number;
  }> = [];
  const baseRuntime = await createSyncRuntime(
    encapsulationKeyPair,
    "root-container",
    { syncCalls },
  );
  const committedUpdates = new Map<
    string,
    DocumentSyncResponse["updates"][number]
  >();
  const syncDocument = baseRuntime.apiClient.syncDocument.bind(
    baseRuntime.apiClient,
  );
  Object.assign(baseRuntime.apiClient, {
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

  const peerRuntime = cloneDocumentsTestRuntime(baseRuntime, {
    state: { domainScope: createDomainScope(), peerScope: "live-peer" },
  });
  const receiverRuntime = cloneDocumentsTestRuntime(baseRuntime, {
    state: { domainScope: createDomainScope(), peerScope: "live-receiver" },
  });
  const peerStore = createDocumentStore(
    "live-snapshot-note",
    peerRuntime,
    peerPersistence,
  );
  peerStore.updateRuntime(peerRuntime);
  await waitForCondition(
    () =>
      peerStore.getSnapshot().documentId !== null &&
      !peerStore.getSnapshot().syncing,
    "Peer document did not finish creating.",
  );
  await peerStore.setText("base");
  await waitForCondition(
    () =>
      peerPersistence.getState().pendingUpdates.length === 0 &&
      !peerStore.getSnapshot().syncing,
    "Peer base text did not sync.",
  );

  const baseRecord = peerPersistence.getState().document;
  if (!baseRecord) {
    throw new Error("Expected a persisted peer document.");
  }
  await receiverBasePersistence.saveDocument(
    receiverRuntime.infra.execSql,
    structuredClone(baseRecord),
  );
  // A record row alone carries no content: copy the peer's durable history
  // too, the way a real receiver's own writes would have seeded it — the
  // record and its checkpoint+tail are always written together in production.
  const peerHistory = await peerPersistence.loadHistoryRestoreState?.(
    receiverRuntime.infra.execSql,
    "live-snapshot-note",
  );
  if (!peerHistory) {
    throw new Error("Expected peer durable history to seed the receiver.");
  }
  await receiverBasePersistence.replaceHistoryCheckpoint?.(
    receiverRuntime.infra.execSql,
    {
      coveredTailIds: [],
      endVersionVector: getImportBlobMetadata(
        base64ToBytes(peerHistory.snapshot),
      ).partialEndVersionVector,
      force: true,
      localId: "live-snapshot-note",
      snapshot: peerHistory.snapshot,
    },
  );
  if (peerHistory.tailUpdates.length > 0) {
    // Seeded as remote: the receiver got this content from its peer, exactly
    // as a pull would have delivered it.
    await receiverBasePersistence.appendHistoryUpdates?.(
      receiverRuntime.infra.execSql,
      {
        localId: "live-snapshot-note",
        origin: "remote",
        updates: peerHistory.tailUpdates.map((update) => update.updateData),
      },
    );
  }
  const receiverStore = createDocumentStore(
    "live-snapshot-note",
    receiverRuntime,
    receiverPersistence,
  );
  receiverStore.updateRuntime(receiverRuntime);
  await waitForCondition(
    () =>
      receiverStore.getSnapshot().text === "base" &&
      !receiverStore.getSnapshot().syncing,
    "Receiver did not initialize with the base text.",
  );
  await getOrCreateDomainSyncCoordinator(
    receiverRuntime.state.domainScope,
  ).waitForIdle({ quietMs: 20, timeoutMs: 2_000 });

  const publishedTexts: string[] = [];
  const unsubscribe = receiverStore.subscribe(() => {
    const text = receiverStore.getSnapshot().text;
    if (publishedTexts.at(-1) !== text) {
      publishedTexts.push(text);
    }
  });
  gateReceiverPostCommit = true;
  const localWrite = receiverStore.setText("base LOCAL");

  try {
    await waitForCondition(
      () => gatedCommitCount === 1,
      "Receiver write did not reach the post-commit gate.",
    );
    await peerStore.setText("REMOTE base");
    await waitForCondition(
      () =>
        peerPersistence.getState().pendingUpdates.length === 0 &&
        !peerStore.getSnapshot().syncing,
      "Peer edit did not sync.",
    );

    const callsBeforeEvent = syncCalls.length;
    receiverStore.updateRuntime(
      cloneDocumentsTestRuntime(receiverRuntime, {
        state: {
          events: [
            {
              documentId: receiverStore.getSnapshot().documentId,
              id: "live-peer-update",
              type: "document_update_created",
            },
          ],
        },
      }),
    );
    await waitForCondition(() => {
      const persistedText =
        receiverBasePersistence.getState().document?.text ?? "";
      return (
        syncCalls.length > callsBeforeEvent &&
        persistedText.includes("LOCAL") &&
        persistedText.includes("REMOTE") &&
        !receiverStore.getSnapshot().syncing
      );
    }, "Receiver did not import the peer edit while its local write was gated.");

    expect(receiverStore.getSnapshot().text).toBe("base LOCAL");
    expect(publishedTexts.some((text) => text.includes("REMOTE"))).toBe(false);
  } finally {
    postCommitGate.release();
    await localWrite;
  }

  await getOrCreateDomainSyncCoordinator(
    receiverRuntime.state.domainScope,
  ).waitForIdle({ quietMs: 30, timeoutMs: 3_000 });
  unsubscribe();

  const persistedText = receiverBasePersistence.getState().document?.text;
  if (persistedText === undefined) {
    throw new Error("Expected the receiver's merged persisted text.");
  }
  const liveText = receiverStore.getSnapshot().text;
  expect(liveText).toBe(persistedText);
  expect(liveText).toContain("LOCAL");
  expect(liveText).toContain("REMOTE");
  expect(publishedTexts.filter((text) => text.includes("REMOTE"))).toEqual([
    liveText,
  ]);
}, 15_000);
