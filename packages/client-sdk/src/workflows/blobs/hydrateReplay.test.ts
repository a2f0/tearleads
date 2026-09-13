import { expect, test } from "bun:test";
import type { BlobAttachmentSummary } from "@tearleads/validators/response";
import {
  createBlobBytesResponse,
  createSingleAttachmentHydrationApi,
  createUploadedAttachmentFixture,
} from "../../../test/helpers/blobHydration";
import {
  createBlobAttachmentBindResponse,
  createMultipartBlobStageFixture,
} from "../../../test/helpers/blobUploadFixtures";
import type { BlobBytes } from "../../data/blobContracts";
import { attachmentContentSha256 } from "../../data/documents/attachmentContentIdentity";
import { decryptDocumentAttachmentBlob } from "./decrypt";
import { hydrateDocumentAttachmentBlobs } from "./hydrate";
import { uploadDocumentAttachment } from "./upload";

type UploadedFixture = Awaited<
  ReturnType<typeof createUploadedAttachmentFixture>
>;

/** Sign and upload a replacement binding for the fixture's slot. */
async function uploadNewerBinding(fixture: UploadedFixture) {
  const blobId = crypto.randomUUID();
  const bindingId = crypto.randomUUID();
  const bytes = new TextEncoder().encode(
    "newer attachment payload",
  ) as BlobBytes;
  const multipart = createMultipartBlobStageFixture();
  const newer = await uploadDocumentAttachment({
    apiClient: {
      ...multipart,
      bindBlobAttachment: async (_id, request) =>
        createBlobAttachmentBindResponse({
          blobId,
          documentManifest: fixture.writerProjection.documentManifest,
          request,
        }),
      getDocumentWriterProjection: async () => fixture.writerProjection,
    },
    author: fixture.author,
    bindingId,
    blobId,
    bytes,
    contentKey: crypto.getRandomValues(new Uint8Array(32)),
    documentId: fixture.writerProjection.documentId,
    execSql: fixture.execSql,
    expectedBindingId: fixture.bindingId,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    signedAt: "2026-04-27T00:01:00.000Z",
    slotId: fixture.attachment.slotId,
    targetSecretKey: fixture.secretKey,
  });
  const encryptedBytes = multipart.getAssembledBytes();
  if (!newer || !encryptedBytes) throw new Error("Expected newer upload");
  const binding: BlobAttachmentSummary = {
    ...newer.response,
    blobId,
    bindingId,
    slotId: fixture.attachment.slotId,
  };
  return {
    binding,
    bytes,
    contentSha256: await attachmentContentSha256(bytes),
    encryptedBytes,
    sha256: newer.sha256,
  };
}

function createServedBindingApi(
  fixture: UploadedFixture,
  served: Awaited<ReturnType<typeof uploadNewerBinding>>,
  onBlobRead: () => void = () => {},
) {
  return {
    getBlobBytes: async () => {
      onBlobRead();
      return createBlobBytesResponse({
        blobId: served.binding.blobId,
        encryptedBytes: served.encryptedBytes,
        sha256: served.sha256,
      });
    },
    getDocumentWriterProjection: async () => fixture.writerProjection,
    listDocumentAttachments: async () => [served.binding],
  };
}

test("hydration does not replace newer local bytes with a valid older binding", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const newer = await uploadNewerBinding(fixture);
  expect(newer.binding.previousBindingId).toBe(fixture.bindingId);
  const decrypted = await decryptDocumentAttachmentBlob({
    binding: newer.binding,
    encryptedBytes: newer.encryptedBytes,
    expectedDocumentId: fixture.writerProjection.documentId,
    expectedSlotId: fixture.attachment.slotId,
    execSql: fixture.execSql,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetSecretKey: fixture.secretKey,
    writerProjection: fixture.writerProjection,
  });
  expect(decrypted).toEqual(newer.bytes);
  const stale = await hydrateDocumentAttachmentBlobs({
    apiClient: createSingleAttachmentHydrationApi(fixture, async () =>
      createBlobBytesResponse({
        blobId: fixture.blobId,
        encryptedBytes: fixture.stagedBlob.encryptedBytes,
        sha256: fixture.stagedBlob.sha256,
      }),
    ),
    attachments: [
      { ...fixture.attachment, contentSha256: newer.contentSha256 },
    ],
    documentId: fixture.writerProjection.documentId,
    execSql: fixture.execSql,
    localBlobIdBySlotId: { [fixture.attachment.slotId]: newer.binding.blobId },
    localStorageKeyBySlotId: {
      [fixture.attachment.slotId]: `blob-${newer.binding.blobId}`,
    },
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetSecretKey: fixture.secretKey,
  });
  expect(stale).toEqual([]);
});

// The uploader binds first and pushes the content digest in a later request. A
// cold peer that reads between them sees the old digest against the new
// binding; the validly signed bytes are shown flagged, never hidden.
test("hydration shows a served binding whose digest the document has not recorded yet", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const served = await uploadNewerBinding(fixture);
  const incidents: unknown[] = [];
  const logs: string[] = [];
  const hydrated = await hydrateDocumentAttachmentBlobs({
    apiClient: createServedBindingApi(fixture, served),
    attachments: [fixture.attachment],
    documentId: fixture.writerProjection.documentId,
    execSql: fixture.execSql,
    log: (message) => logs.push(message),
    reportSecurityIncident: async (error) => {
      incidents.push(error);
    },
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetSecretKey: fixture.secretKey,
  });
  expect(hydrated).toHaveLength(1);
  expect(hydrated?.[0]).toMatchObject({
    attachment: fixture.attachment,
    contentSha256: served.contentSha256,
    intentMismatch: true,
    storageKey: `blob-${served.binding.blobId}`,
  });
  expect(Array.from(hydrated?.[0]?.bytes ?? [])).toEqual(
    Array.from(served.bytes),
  );
  expect(incidents).toEqual([]);
  expect(logs).toEqual([
    "Documents: served attachment bytes differ from the current document content; showing them flagged.",
  ]);
});

test("hydration keeps a held copy matching the intent and downloads a rejected binding once", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const served = await uploadNewerBinding(fixture);
  let blobReads = 0;
  const rejectedServedBindings = new Set<string>();
  const heldCopy = {
    apiClient: createServedBindingApi(fixture, served, () => {
      blobReads += 1;
    }),
    documentId: fixture.writerProjection.documentId,
    execSql: fixture.execSql,
    localBlobIdBySlotId: { [fixture.attachment.slotId]: fixture.blobId },
    localStorageKeyBySlotId: {
      [fixture.attachment.slotId]: `blob-${fixture.blobId}`,
    },
    rejectedServedBindings,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetSecretKey: fixture.secretKey,
  };
  const first = await hydrateDocumentAttachmentBlobs({
    ...heldCopy,
    attachments: [fixture.attachment],
  });
  expect(first).toEqual([]);
  expect(blobReads).toBe(1);
  expect(rejectedServedBindings.size).toBe(1);

  const repeat = await hydrateDocumentAttachmentBlobs({
    ...heldCopy,
    attachments: [fixture.attachment],
  });
  expect(repeat).toEqual([]);
  expect(blobReads).toBe(1);

  // The content update carrying the served digest arrives: the same binding
  // is downloaded again and now replaces the held copy unflagged.
  const recorded = await hydrateDocumentAttachmentBlobs({
    ...heldCopy,
    attachments: [
      { ...fixture.attachment, contentSha256: served.contentSha256 },
    ],
  });
  expect(blobReads).toBe(2);
  expect(recorded?.[0]).toMatchObject({
    contentSha256: served.contentSha256,
    intentMismatch: false,
    storageKey: `blob-${served.binding.blobId}`,
  });
});

test("a rejected binding hydrates once the held copy is gone", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const served = await uploadNewerBinding(fixture);
  let blobReads = 0;
  const rejectedServedBindings = new Set<string>();
  const input = {
    apiClient: createServedBindingApi(fixture, served, () => {
      blobReads += 1;
    }),
    attachments: [fixture.attachment],
    documentId: fixture.writerProjection.documentId,
    execSql: fixture.execSql,
    rejectedServedBindings,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    targetSecretKey: fixture.secretKey,
  };
  const rejected = await hydrateDocumentAttachmentBlobs({
    ...input,
    localBlobIdBySlotId: { [fixture.attachment.slotId]: fixture.blobId },
    localStorageKeyBySlotId: {
      [fixture.attachment.slotId]: `blob-${fixture.blobId}`,
    },
  });
  expect(rejected).toEqual([]);
  expect(rejectedServedBindings.size).toBe(1);
  expect(blobReads).toBe(1);

  // The held copy is removed (e.g. blob storage reclaimed): the slot is empty,
  // so the same served binding is downloaded again and shown flagged.
  const rehydrated = await hydrateDocumentAttachmentBlobs({
    ...input,
    localBlobIdBySlotId: {},
    localStorageKeyBySlotId: {},
  });
  expect(blobReads).toBe(2);
  expect(rehydrated?.[0]).toMatchObject({
    contentSha256: served.contentSha256,
    intentMismatch: true,
    storageKey: `blob-${served.binding.blobId}`,
  });
});
