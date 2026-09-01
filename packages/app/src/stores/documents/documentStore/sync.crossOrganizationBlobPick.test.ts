import { expect, test } from "bun:test";
import {
  type BlobInfo,
  type BlobStore,
  createDocumentStore,
  createMemoryBlobStore,
} from "@tearleads/client-sdk";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import type { BlobAttachmentBindRequest } from "@tearleads/validators/request";
import {
  cloneDocumentsTestRuntime,
  type DocumentsTestRuntime,
} from "../../../../test/helpers/document-store/documentStoreSyncFixtures";
import { createDocumentsPersistence } from "../../../../test/helpers/document-store/documentStoreSyncPersistence";
import { createSyncRuntime } from "../../../../test/helpers/document-store/documentStoreSyncRuntime";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";
import { readBlobDocumentAttachmentUpload } from "../../../document-types/shared/documentAttachmentUtils";

interface OrganizationDocumentFixture {
  attachmentBinds: Array<{
    blobId: string;
    request: BlobAttachmentBindRequest;
  }>;
  persistence: ReturnType<typeof createDocumentsPersistence>;
  runtime: DocumentsTestRuntime;
  store: ReturnType<typeof createDocumentStore>;
}

async function createOrganizationDocument(input: {
  blobStore: BlobStore;
  containerId: string;
  documentLocalId: string;
  encapsulationKeyPair: ReturnType<typeof generateKemSeedAndKeyPair>;
  organizationId: string;
}): Promise<OrganizationDocumentFixture> {
  const attachmentBinds: OrganizationDocumentFixture["attachmentBinds"] = [];
  const runtimeInput = await createSyncRuntime(
    input.encapsulationKeyPair,
    input.containerId,
    { attachmentBinds, organizationId: input.organizationId },
  );
  const runtime = cloneDocumentsTestRuntime(runtimeInput, {
    infra: { blobStore: input.blobStore },
  });
  const persistence = createDocumentsPersistence();
  const store = createDocumentStore(
    input.documentLocalId,
    runtime,
    persistence,
  );
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    `Document ${input.documentLocalId} did not become ready.`,
  );

  return { attachmentBinds, persistence, runtime, store };
}

async function waitForUploadedAttachment(fixture: OrganizationDocumentFixture) {
  await waitForCondition(
    () =>
      fixture.persistence.getState().pendingAttachments.length === 0 &&
      typeof fixture.persistence.getState().localAttachments[0]?.blobId ===
        "string",
    "Attachment did not finish uploading.",
  );

  const attachment = fixture.persistence.getState().localAttachments[0];
  if (!attachment?.blobId) {
    throw new Error("Expected an uploaded attachment fixture.");
  }
  return { ...attachment, blobId: attachment.blobId };
}

function createPersonalOrganizationBlob(input: {
  attachment: Awaited<ReturnType<typeof waitForUploadedAttachment>>;
  containerId: string;
  documentId: string;
  organizationId: string;
}): BlobInfo {
  const { attachment, containerId, documentId, organizationId } = input;
  return {
    blobId: attachment.blobId,
    byteLength: attachment.byteLength,
    createdAt: null,
    documentCount: 1,
    key: `blob:${attachment.blobId}`,
    mimeType: attachment.mimeType,
    name: null,
    organizationId,
    referenceCount: 1,
    references: [
      {
        attachmentKind: "local",
        blobId: attachment.blobId,
        byteLength: attachment.byteLength,
        containerId,
        createdAt: null,
        documentId,
        documentKind: "note",
        documentTitle: "Personal note",
        localId: "personal-document",
        mimeType: attachment.mimeType,
        name: null,
        slotId: attachment.slotId,
        storageKey: attachment.storageKey,
        updatedAt: null,
      },
    ],
    storageKey: attachment.storageKey,
    updatedAt: null,
  };
}

test("picking a personal-org blob copies and re-encrypts it for the target organization", async () => {
  const personalOrganizationId = "personal-organization";
  const personalContainerId = "personal-container";
  const customOrganizationId = "custom-organization";
  const customContainerId = "custom-container";
  const bytes = new TextEncoder().encode("cross-organization image bytes");
  const blobStore = createMemoryBlobStore();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const personal = await createOrganizationDocument({
    blobStore,
    containerId: personalContainerId,
    documentLocalId: "personal-document",
    encapsulationKeyPair,
    organizationId: personalOrganizationId,
  });

  personal.store.attachFiles([
    { bytes, mimeType: "image/png", name: "personal-image.png" },
  ]);
  const personalAttachment = await waitForUploadedAttachment(personal);
  const personalDocumentId =
    personal.persistence.getState().document?.documentId;
  if (!personalDocumentId) {
    throw new Error("Expected a synced personal document fixture.");
  }
  const pickedBlob = createPersonalOrganizationBlob({
    attachment: personalAttachment,
    containerId: personalContainerId,
    documentId: personalDocumentId,
    organizationId: personalOrganizationId,
  });

  const custom = await createOrganizationDocument({
    blobStore,
    containerId: customContainerId,
    documentLocalId: "custom-document",
    encapsulationKeyPair,
    organizationId: customOrganizationId,
  });
  const pickedUpload = await readBlobDocumentAttachmentUpload({
    blob: pickedBlob,
    blobStore,
  });
  custom.store.replaceAttachment("front-image", pickedUpload);
  const customAttachment = await waitForUploadedAttachment(custom);

  expect(customAttachment.blobId).not.toBe(personalAttachment.blobId);
  expect(customAttachment.storageKey).not.toBe(personalAttachment.storageKey);
  expect(await blobStore.readBytes(personalAttachment.storageKey)).toEqual(
    bytes,
  );
  expect(await blobStore.readBytes(customAttachment.storageKey)).toEqual(bytes);

  const personalBind = personal.attachmentBinds[0];
  const customBind = custom.attachmentBinds[0];
  expect(personalBind).toBeDefined();
  expect(customBind).toBeDefined();
  if (!personalBind || !customBind) {
    throw new Error("Expected attachment binds for both organizations.");
  }

  expect(personalBind.request.event).toMatchObject({
    objectId: personalAttachment.blobId,
    organizationId: personalOrganizationId,
  });
  expect(customBind.request.event).toMatchObject({
    objectId: customAttachment.blobId,
    organizationId: customOrganizationId,
  });
  expect(customBind.request.stagedBlob?.writeHeader).toMatchObject({
    objectId: customAttachment.blobId,
    organizationId: customOrganizationId,
  });
  expect(
    customBind.request.contentKeyBundle.targets.map(
      (target) => target.containerId,
    ),
  ).toEqual([customContainerId]);
  expect(JSON.stringify(customBind.request)).not.toContain(
    personalAttachment.blobId,
  );

  const [personalRemoteBlob, customRemoteBlob] = await Promise.all([
    personal.runtime.apiClient.getBlobBytes(personalAttachment.blobId),
    custom.runtime.apiClient.getBlobBytes(customAttachment.blobId),
  ]);
  if (!personalRemoteBlob || !customRemoteBlob) {
    throw new Error("Expected both remote blob byte streams");
  }
  const [personalRemoteBytes, customRemoteBytes] = await Promise.all([
    new Response(personalRemoteBlob.encryptedBytes).arrayBuffer(),
    new Response(customRemoteBlob.encryptedBytes).arrayBuffer(),
  ]);
  expect(new Uint8Array(customRemoteBytes)).not.toEqual(
    new Uint8Array(personalRemoteBytes),
  );
}, 20_000);
