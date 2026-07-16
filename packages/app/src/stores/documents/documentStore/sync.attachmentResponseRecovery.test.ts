import { expect, test } from "bun:test";
import {
  createDocumentStore,
  getDomainSyncCoordinatorSnapshot,
  requestAllDomainSyncLanes,
} from "@tearleads/client-sdk";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import type { BlobAttachmentBindRequest } from "@tearleads/validators/request";
import { createDocumentsPersistence } from "../../../../test/helpers/document-store/documentStoreSyncPersistence";
import { createSyncRuntime } from "../../../../test/helpers/document-store/documentStoreSyncRuntime";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

test("a retry adopts a blob whose bind committed before its response was lost", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const attachmentBinds: Array<{
    blobId: string;
    request: BlobAttachmentBindRequest;
  }> = [];
  const listDocumentAttachmentsCalls: string[] = [];
  let loseFirstBindResponse = true;
  const runtime = await createSyncRuntime(
    encapsulationKeyPair,
    "shared-container",
    {
      attachmentBinds,
      listDocumentAttachmentsCalls,
      onBlobAttachmentCommitted: () => {
        if (!loseFirstBindResponse) {
          return;
        }
        loseFirstBindResponse = false;
        throw new Error("connection reset after commit");
      },
    },
  );
  const store = createDocumentStore(
    "attachment-bind-response-loss",
    runtime,
    persistence,
  );
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Response-loss document store did not become ready.",
  );

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("committed attachment"),
      mimeType: "application/pdf",
      name: "committed.pdf",
    },
  ]);

  await waitForCondition(() => {
    const pending = persistence.getState().pendingAttachments[0];
    return (
      attachmentBinds.length === 1 &&
      pending?.upload?.blobId === attachmentBinds[0]?.blobId &&
      !store.getSnapshot().syncing
    );
  }, "The committed bind did not retain its pending upload identity.");

  const pendingBeforeRetry = persistence.getState().pendingAttachments[0];
  const blobId = pendingBeforeRetry?.upload?.blobId;
  const storageKey = pendingBeforeRetry?.storageKey;
  if (!blobId || !storageKey) {
    throw new Error("Expected a durable upload identity before retry.");
  }
  expect(
    getDomainSyncCoordinatorSnapshot(runtime.state.domainScope).lanes.find(
      (lane) => lane.key === `blob-upload:${blobId}`,
    ),
  ).toMatchObject({
    blobStorageKey: storageKey,
    lastError: expect.stringContaining("connection reset after commit"),
    status: "error",
  });

  requestAllDomainSyncLanes(runtime.state.domainScope);

  await waitForCondition(
    () =>
      persistence.getState().pendingAttachments.length === 0 &&
      persistence.getState().localAttachments[0]?.blobId === blobId &&
      !store.getSnapshot().syncing,
    "The retry did not adopt the already-committed blob binding.",
  );

  expect(attachmentBinds).toHaveLength(1);
  expect(listDocumentAttachmentsCalls.length).toBeGreaterThan(0);
  const documentId = persistence.getState().document?.documentId;
  if (!documentId) {
    throw new Error("Expected a remote document after attachment recovery.");
  }
  expect(new Set(listDocumentAttachmentsCalls)).toEqual(new Set([documentId]));
  expect(
    getDomainSyncCoordinatorSnapshot(runtime.state.domainScope).lanes.find(
      (lane) => lane.key === `blob-upload:${blobId}`,
    ),
  ).toMatchObject({
    blobStorageKey: storageKey,
    lastError: null,
    runCount: 2,
    status: "complete",
  });
}, 15_000);
