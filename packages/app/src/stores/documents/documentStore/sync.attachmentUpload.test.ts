import { afterEach, expect, test } from "bun:test";
import {
  type BlobBytes,
  createDocumentProjectionUserKeyResolver,
  createDocumentStore,
  createMemoryBlobStore,
  createRemoteDocument,
  decryptDocumentAttachmentBlob,
  uploadDocumentAttachment,
} from "@tearleads/client-sdk";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type { BlobAttachmentBindRequest } from "@tearleads/validators/request";
import {
  type ContentRecordFields,
  cloneDocumentsTestRuntime,
  documentProjectionRuntimeFromPatch,
} from "../../../../test/helpers/document-store/documentStoreSyncFixtures";
import { createDocumentsPersistence } from "../../../../test/helpers/document-store/documentStoreSyncPersistence";
import {
  createOfflineAttachmentRuntime,
  createSyncRuntime,
  documentWorkflowRuntimePatch,
} from "../../../../test/helpers/document-store/documentStoreSyncRuntime";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

const sqlClosers: Array<() => void> = [];

afterEach(() => {
  for (const close of sqlClosers.splice(0)) {
    close();
  }
});

async function createAttachmentTestExecSql(key: string) {
  const { close, execSql } = await createTestExecSql(key);
  sqlClosers.push(close);
  return execSql;
}

test("document store attaches files locally without authentication or network", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const blobStore = createMemoryBlobStore();
  const runtime = createOfflineAttachmentRuntime(
    encapsulationKeyPair,
    "offline-container",
  );
  const offlineRuntime = cloneDocumentsTestRuntime(runtime, {
    infra: {
      blobStore,
    },
  });
  const store = createDocumentStore(
    "offline-attachment-note",
    offlineRuntime,
    persistence,
  );
  store.updateRuntime(offlineRuntime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Offline attachment document store did not become ready.",
  );

  expect(store.getSnapshot().canAttach).toBe(true);

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("offline bytes"),
      mimeType: "image/png",
      name: "offline.png",
    },
  ]);

  await waitForCondition(
    () =>
      store.getSnapshot().attachments.length === 1 &&
      persistence.getState().pendingAttachments.length === 1 &&
      persistence.getState().pendingAttachments[0]?.name === "offline.png",
    "Offline attachment was not stored locally.",
  );

  const slotId = store.getSnapshot().attachments[0]?.slotId;
  const storageKey = slotId
    ? store.getSnapshot().attachmentStorageKeyBySlotId[slotId]
    : undefined;
  const persistedBytes = storageKey
    ? await blobStore.readBytes(storageKey)
    : null;

  expect(storageKey).toBeString();
  expect(new TextDecoder().decode(persistedBytes ?? new Uint8Array())).toBe(
    "offline bytes",
  );
});

test("document store uploads attachment bytes with signed bindings", async () => {
  const persistence = createDocumentsPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const attachmentBinds: Array<{
    blobId: string;
    request: BlobAttachmentBindRequest;
  }> = [];
  const logs: string[] = [];
  const syncCalls: Array<{
    minLsn: string | null;
    outgoingUpdateCount: number;
  }> = [];
  const runtimeInput = await createSyncRuntime(
    encapsulationKeyPair,
    "shared-container",
    {
      attachmentBinds,
      syncCalls,
    },
  );
  const runtime = cloneDocumentsTestRuntime(runtimeInput, {
    util: {
      log: (message) => logs.push(message),
    },
  });
  const store = createDocumentStore("attachment-upload", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Attachment upload document store did not become ready.",
  );

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("remote attachment bytes"),
      mimeType: "image/png",
      name: "remote.png",
    },
  ]);

  await waitForCondition(
    () =>
      persistence.getState().pendingAttachments.length === 0 &&
      persistence.getState().pendingUpdates.length === 0 &&
      typeof persistence.getState().localAttachments[0]?.blobId === "string",
    "Pending attachment was not uploaded and synced.",
  );

  expect(store.getSnapshot().attachments).toHaveLength(1);
  expect(persistence.getState().pendingAttachments).toHaveLength(0);
  expect(persistence.getState().pendingUpdates).toHaveLength(0);
  expect(persistence.getState().document?.documentId).toBeString();
  expect(persistence.getState().localAttachments[0]?.blobId).toBeString();
  expect(attachmentBinds).toHaveLength(1);
  expect(attachmentBinds[0]?.request.stagedBlob?.writeHeader).toBeDefined();
  expect(attachmentBinds[0]?.request.body).toMatchObject({
    eventType: "attachment.bind",
    documentId: persistence.getState().document?.documentId,
    slotId: store.getSnapshot().attachments[0]?.slotId,
    expectedBindingId: null,
  });
  expect(syncCalls.some((call) => call.outgoingUpdateCount === 1)).toBe(true);
  expect(logs).not.toContain(
    "Documents: attachment upload sync is waiting for attachment bindings.",
  );

  const blobId = persistence.getState().localAttachments[0]?.blobId;
  const documentId = persistence.getState().document?.documentId;
  if (!blobId || !documentId) {
    throw new Error("Expected uploaded attachment and remote document ids.");
  }
  const [blob, writerProjection] = await Promise.all([
    runtime.apiClient.getBlobBytes(blobId),
    runtime.apiClient.getDocumentWriterProjection?.(documentId),
  ]);
  if (!blob || !writerProjection) {
    throw new Error("Expected uploaded blob and writer projection fixtures.");
  }
  const encryptedBytes = await new Response(blob.encryptedBytes).text();
  const resolveProjectionUserKey =
    createDocumentProjectionUserKeyResolver(runtime);
  const bindingId = String(
    Reflect.get(attachmentBinds[0]?.request.body ?? {}, "bindingId"),
  );
  const requestContentKeyBundle = attachmentBinds[0]?.request.contentKeyBundle;
  if (!requestContentKeyBundle) {
    throw new Error("Expected attachment content-key bundle.");
  }
  const contentKeyBundle = {
    blobId,
    ...requestContentKeyBundle,
  };
  const decryptedBytes = await decryptDocumentAttachmentBlob({
    contentKeyBundle,
    encryptedBytes,
    expectedBindingId: bindingId,
    expectedBlobId: blobId,
    execSql: runtime.infra.execSql,
    resolveProjectionUserKey,
    targetSecretKey: encapsulationKeyPair.secretKey,
    writerProjection,
  });
  expect(new TextDecoder().decode(decryptedBytes)).toBe(
    "remote attachment bytes",
  );

  await expect(
    decryptDocumentAttachmentBlob({
      contentKeyBundle,
      encryptedBytes,
      expectedBindingId: "wrong-binding-id",
      expectedBlobId: blobId,
      execSql: runtime.infra.execSql,
      resolveProjectionUserKey,
      targetSecretKey: encapsulationKeyPair.secretKey,
      writerProjection,
    }),
  ).rejects.toThrow("missing attachment target");

  const tamperedEncryptedBytes = JSON.parse(encryptedBytes) as Record<
    string,
    unknown
  >;
  await expect(
    decryptDocumentAttachmentBlob({
      contentKeyBundle,
      encryptedBytes: JSON.stringify({
        ...tamperedEncryptedBytes,
        version: 2,
      }),
      expectedBindingId: bindingId,
      expectedBlobId: blobId,
      execSql: runtime.infra.execSql,
      resolveProjectionUserKey,
      targetSecretKey: encapsulationKeyPair.secretKey,
      writerProjection,
    }),
  ).rejects.toThrow("Blob encrypted bytes version 2 is invalid; expected 1");

  const [firstTarget, ...remainingTargets] = contentKeyBundle.targets;
  if (!firstTarget) {
    throw new Error("Expected uploaded blob content-key target.");
  }
  const tamperedContentKeyBundle = {
    ...contentKeyBundle,
    targets: [
      {
        ...firstTarget,
        containerKeyEpochId: "tampered-container-key-epoch",
      },
      ...remainingTargets,
    ],
  };
  await expect(
    decryptDocumentAttachmentBlob({
      contentKeyBundle: tamperedContentKeyBundle,
      encryptedBytes,
      expectedBindingId: bindingId,
      expectedBlobId: blobId,
      execSql: runtime.infra.execSql,
      resolveProjectionUserKey,
      targetSecretKey: encapsulationKeyPair.secretKey,
      writerProjection,
    }),
  ).rejects.toThrow("target hash is not canonical");
}, 10_000);

test("uploadDocumentAttachment rejects bind responses with tampered target material", async () => {
  const execSql = await createAttachmentTestExecSql(
    "app-attachment-tampered-bind-response",
  );
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const runtimePatch = await documentWorkflowRuntimePatch({
    encapsulationKeyPair,
    mapBindBlobAttachmentResponse: (response) => ({
      ...response,
      contentKeyBundle: {
        ...response.contentKeyBundle,
        targets: response.contentKeyBundle.targets.map((target, index) =>
          index === 0
            ? {
                ...target,
                wrappedKey: "tampered-wrapped-key",
              }
            : target,
        ),
      },
    }),
  });
  const author = {
    organizationId: runtimePatch.organizationId,
    signerDeviceId: "test-device-1",
    signerKeyFingerprint: runtimePatch.signingFingerprint,
    signerPrivateKey: runtimePatch.signingKeyPair.signingPrivateKey,
    signerUserId: runtimePatch.userId,
  };
  const resolveProjectionUserKey = createDocumentProjectionUserKeyResolver(
    documentProjectionRuntimeFromPatch(runtimePatch, encapsulationKeyPair),
  );
  const created = await createRemoteDocument({
    apiClient: runtimePatch.apiClient,
    author,
    containerId: "root-container",
    documentId: "document-attachment-response-verification",
    execSql,
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!created) {
    throw new Error("Expected remote document fixture.");
  }

  await expect(
    uploadDocumentAttachment({
      apiClient: runtimePatch.apiClient,
      author,
      bytes: new TextEncoder().encode("tampered response bytes") as BlobBytes,
      documentId: created.documentId,
      execSql,
      expectedBindingId: null,
      resolveProjectionUserKey,
      signedAt: "2026-04-27T00:00:01.000Z",
      slotId: "tampered-response-slot",
      targetSecretKey: encapsulationKeyPair.secretKey,
    }),
  ).rejects.toThrow("content-key bundle mismatch");
});

test("uploadDocumentAttachment rejects document writer projections with bad signatures", async () => {
  const execSql = await createAttachmentTestExecSql(
    "app-attachment-bad-projection-signature",
  );
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const runtimePatch = await documentWorkflowRuntimePatch({
    encapsulationKeyPair,
    mapDocumentWriterProjectionResponse: (projection) => {
      const tamperedProjection = structuredClone(projection);
      const signedEvent = Reflect.get(
        tamperedProjection.documentManifest.event,
        "event",
      );
      if (!isPlainObject(signedEvent)) {
        throw new Error("Expected signed document event fixture.");
      }
      const signature = Reflect.get(signedEvent, "signature");
      if (typeof signature !== "string" || signature.length === 0) {
        throw new Error("Expected signed document signature fixture.");
      }
      Reflect.set(
        signedEvent,
        "signature",
        `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`,
      );

      return tamperedProjection;
    },
  });
  const author = {
    organizationId: runtimePatch.organizationId,
    signerDeviceId: "test-device-1",
    signerKeyFingerprint: runtimePatch.signingFingerprint,
    signerPrivateKey: runtimePatch.signingKeyPair.signingPrivateKey,
    signerUserId: runtimePatch.userId,
  };
  const resolveProjectionUserKey = createDocumentProjectionUserKeyResolver(
    documentProjectionRuntimeFromPatch(runtimePatch, encapsulationKeyPair),
  );
  const created = await createRemoteDocument({
    apiClient: runtimePatch.apiClient,
    author,
    containerId: "root-container",
    documentId: "document-attachment-bad-projection-signature",
    execSql,
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!created) {
    throw new Error("Expected remote document fixture.");
  }

  await expect(
    uploadDocumentAttachment({
      apiClient: runtimePatch.apiClient,
      author,
      bytes: new TextEncoder().encode("bad projection bytes") as BlobBytes,
      documentId: created.documentId,
      execSql,
      expectedBindingId: null,
      resolveProjectionUserKey,
      signedAt: "2026-04-27T00:00:01.000Z",
      slotId: "bad-projection-slot",
      targetSecretKey: encapsulationKeyPair.secretKey,
    }),
  ).rejects.toThrow("Document writer projection signature verification failed");
});

test("uploadDocumentAttachment uses a fresh IV for same-domain blob re-encryption", async () => {
  const execSql = await createAttachmentTestExecSql("app-attachment-fresh-iv");
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const runtimePatch = await documentWorkflowRuntimePatch({
    encapsulationKeyPair,
  });
  const author = {
    organizationId: runtimePatch.organizationId,
    signerDeviceId: "test-device-1",
    signerKeyFingerprint: runtimePatch.signingFingerprint,
    signerPrivateKey: runtimePatch.signingKeyPair.signingPrivateKey,
    signerUserId: runtimePatch.userId,
  };
  const resolveProjectionUserKey = createDocumentProjectionUserKeyResolver(
    documentProjectionRuntimeFromPatch(runtimePatch, encapsulationKeyPair),
  );
  const created = await createRemoteDocument({
    apiClient: runtimePatch.apiClient,
    author,
    containerId: "root-container",
    documentId: "document-attachment-fresh-iv",
    execSql,
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!created) {
    throw new Error("Expected remote document fixture.");
  }

  const blobId = "550e8400-e29b-41d4-a716-446655440551";
  const bindingId = "550e8400-e29b-41d4-a716-446655440552";
  const contentKey = new Uint8Array(32).fill(7);
  const first = await uploadDocumentAttachment({
    apiClient: runtimePatch.apiClient,
    author,
    bindingId,
    blobId,
    bytes: new TextEncoder().encode("first blob payload") as BlobBytes,
    contentKey,
    documentId: created.documentId,
    execSql,
    expectedBindingId: null,
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:01.000Z",
    slotId: "fresh-iv-slot",
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  const second = await uploadDocumentAttachment({
    apiClient: runtimePatch.apiClient,
    author,
    bindingId,
    blobId,
    bytes: new TextEncoder().encode("second blob payload") as BlobBytes,
    contentKey,
    documentId: created.documentId,
    execSql,
    expectedBindingId: null,
    resolveProjectionUserKey,
    signedAt: "2026-04-27T00:00:02.000Z",
    slotId: "fresh-iv-slot",
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!first || !second) {
    throw new Error("Expected uploaded blob fixtures.");
  }
  const firstRecord = JSON.parse(first.encryptedBytes) as ContentRecordFields;
  const secondRecord = JSON.parse(second.encryptedBytes) as ContentRecordFields;

  expect(firstRecord.contentRecordId).toBe(blobId);
  expect(secondRecord.contentRecordId).toBe(blobId);
  expect(firstRecord.nonceDomainHash).toBe(secondRecord.nonceDomainHash);
  expect(firstRecord.iv).not.toBe(bytesToBase64(new Uint8Array(12)));
  expect(secondRecord.iv).not.toBe(bytesToBase64(new Uint8Array(12)));
  expect(firstRecord.iv).not.toBe(secondRecord.iv);
  expect(firstRecord.ciphertext).not.toBe(secondRecord.ciphertext);
}, 10_000);
