import { expect, spyOn, test } from "bun:test";
import type { BlobAttachmentSummary } from "@tearleads/validators/response";
import {
  checkedDocumentVersion,
  createBlobAttachmentBindResponse,
  createMultipartBlobStageFixture,
} from "../../../../test/helpers/data/blobUploadFixtures";
import { createBlobAttachmentServiceFixture } from "../../../../test/helpers/workflows/blobAttachmentServiceFixture";
import {
  createBlobBytesResponse,
  createSingleAttachmentHydrationApi,
  createUploadedAttachmentFixture,
  stagedBindingSummary,
} from "../../../../test/helpers/workflows/blobHydration";
import * as contentIdentity from "../../../data/blobs/attachmentContentIdentity";
import { attachmentContentSha256 } from "../../../data/blobs/attachmentContentIdentity";
import type { BlobBytes } from "../../../data/blobs/blobContracts";

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
  const newer = await createBlobAttachmentServiceFixture({
    api: {
      ...multipart,
      bindBlobAttachment: async (_id, request) =>
        createBlobAttachmentBindResponse({
          blobId,
          documentManifest: fixture.writerProjection.documentManifest,
          request,
        }),
      getDocumentWriterProjection: async () => fixture.writerProjection,
    },
    encapsulationSecretKey: fixture.secretKey,
    execSql: fixture.execSql,
  }).uploadDocumentAttachment({
    author: fixture.author,
    bindingId,
    blobId,
    bytes,
    contentKey: crypto.getRandomValues(new Uint8Array(32)),
    documentId: fixture.writerProjection.documentId,
    expectedBindingId: fixture.bindingId,
    verifiedDocumentVersion: checkedDocumentVersion,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    signedAt: "2026-04-27T00:01:00.000Z",
    slotId: fixture.attachment.slotId,
  });
  const encryptedBytes = multipart.getAssembledBytes();
  if (!newer || !encryptedBytes) throw new Error("Expected newer upload");
  const binding: BlobAttachmentSummary = stagedBindingSummary(newer);
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
  const decrypted = await createBlobAttachmentServiceFixture({
    api: {},
    encapsulationSecretKey: fixture.secretKey,
    execSql: fixture.execSql,
  }).decryptDocumentAttachmentBlob({
    binding: newer.binding,
    encryptedBytes: newer.encryptedBytes,
    expectedDocumentId: fixture.writerProjection.documentId,
    expectedSlotId: fixture.attachment.slotId,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    writerProjection: fixture.writerProjection,
  });
  expect(decrypted).toEqual(newer.bytes);
  const stale = await createBlobAttachmentServiceFixture({
    api: createSingleAttachmentHydrationApi(fixture, async () =>
      createBlobBytesResponse({
        blobId: fixture.blobId,
        encryptedBytes: fixture.stagedBlob.encryptedBytes,
        sha256: fixture.stagedBlob.sha256,
      }),
    ),
    encapsulationSecretKey: fixture.secretKey,
    execSql: fixture.execSql,
  }).hydrateDocumentAttachmentBlobs({
    attachments: [
      { ...fixture.attachment, contentSha256: newer.contentSha256 },
    ],
    documentId: fixture.writerProjection.documentId,
    localBlobIdBySlotId: { [fixture.attachment.slotId]: newer.binding.blobId },
    localStorageKeyBySlotId: {
      [fixture.attachment.slotId]: `blob-${newer.binding.blobId}`,
    },
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
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
  const hydrated = await createBlobAttachmentServiceFixture({
    api: createServedBindingApi(fixture, served),
    encapsulationSecretKey: fixture.secretKey,
    execSql: fixture.execSql,
    log: (message) => logs.push(message),
    reportSecurityIncident: async (error) => {
      incidents.push(error);
    },
  }).hydrateDocumentAttachmentBlobs({
    attachments: [fixture.attachment],
    documentId: fixture.writerProjection.documentId,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
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
  const blobs = createBlobAttachmentServiceFixture({
    api: createServedBindingApi(fixture, served, () => {
      blobReads += 1;
    }),
    encapsulationSecretKey: fixture.secretKey,
    execSql: fixture.execSql,
  });
  const heldCopy = {
    documentId: fixture.writerProjection.documentId,
    localBlobIdBySlotId: { [fixture.attachment.slotId]: fixture.blobId },
    localStorageKeyBySlotId: {
      [fixture.attachment.slotId]: `blob-${fixture.blobId}`,
    },
    rejectedServedBindings,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
  };
  const first = await blobs.hydrateDocumentAttachmentBlobs({
    ...heldCopy,
    attachments: [fixture.attachment],
  });
  expect(first).toEqual([]);
  expect(blobReads).toBe(1);
  expect(rejectedServedBindings.size).toBe(1);

  const repeat = await blobs.hydrateDocumentAttachmentBlobs({
    ...heldCopy,
    attachments: [fixture.attachment],
  });
  expect(repeat).toEqual([]);
  expect(blobReads).toBe(1);

  // The content update carrying the served digest arrives: the same binding
  // is downloaded again and now replaces the held copy unflagged.
  const recorded = await blobs.hydrateDocumentAttachmentBlobs({
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
  const blobs = createBlobAttachmentServiceFixture({
    api: createServedBindingApi(fixture, served, () => {
      blobReads += 1;
    }),
    encapsulationSecretKey: fixture.secretKey,
    execSql: fixture.execSql,
  });
  const input = {
    attachments: [fixture.attachment],
    documentId: fixture.writerProjection.documentId,
    rejectedServedBindings,
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
  };
  const rejected = await blobs.hydrateDocumentAttachmentBlobs({
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
  const rehydrated = await blobs.hydrateDocumentAttachmentBlobs({
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

test("a binding-only repair replaces previously flagged local bytes", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const replacement = await uploadNewerBinding(fixture);
  const cached = createSingleAttachmentHydrationApi(fixture, async () => null);
  const live = createServedBindingApi(fixture, replacement);
  const blobs = createBlobAttachmentServiceFixture({
    api: {
      ...live,
      listDocumentAttachments: async (documentId, options) =>
        options?.refresh
          ? live.listDocumentAttachments()
          : cached.listDocumentAttachments(documentId),
    },
    encapsulationSecretKey: fixture.secretKey,
    execSql: fixture.execSql,
  });
  const slot = fixture.attachment.slotId;
  const result = await blobs.hydrateDocumentAttachmentBlobs({
    attachments: [
      { ...fixture.attachment, contentSha256: replacement.contentSha256 },
    ],
    documentId: fixture.writerProjection.documentId,
    localStorageKeyBySlotId: { [slot]: "held" },
    localBlobIdBySlotId: { [slot]: fixture.blobId },
    resolveProjectionUserKey: fixture.resolveProjectionUserKey,
  });
  expect(result?.[0]?.bytes).toEqual(replacement.bytes);
});

test("a reader fetches the file after its first binding list was empty", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const replacement = await uploadNewerBinding(fixture);
  const server = createServedBindingApi(fixture, replacement);
  let published = false;
  const blobs = createBlobAttachmentServiceFixture({
    api: {
      ...server,
      listDocumentAttachments: async (_document, options) =>
        published && options?.refresh ? server.listDocumentAttachments() : [],
    },
    encapsulationSecretKey: fixture.secretKey,
    execSql: fixture.execSql,
  });
  const read = () =>
    blobs.hydrateDocumentAttachmentBlobs({
      attachments: [
        { ...fixture.attachment, contentSha256: replacement.contentSha256 },
      ],
      documentId: fixture.writerProjection.documentId,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    });
  expect(await read()).toEqual([]);
  published = true;
  const result = await read();
  expect(result?.[0]?.bytes).toEqual(replacement.bytes);
});

test("a superseded read cannot reject a binding after hashing its plaintext", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const served = await uploadNewerBinding(fixture);
  const rejectedServedBindings = new Set<string>();
  let current = true;
  const digest = contentIdentity.attachmentContentSha256;
  const hash = spyOn(
    contentIdentity,
    "attachmentContentSha256",
  ).mockImplementation(async (bytes) => {
    const result = await digest(bytes);
    current = false;
    return result;
  });
  try {
    const blobs = createBlobAttachmentServiceFixture({
      api: createServedBindingApi(fixture, served),
      encapsulationSecretKey: fixture.secretKey,
      execSql: fixture.execSql,
    });
    await blobs.hydrateDocumentAttachmentBlobs({
      attachments: [fixture.attachment],
      documentId: fixture.writerProjection.documentId,
      rejectedServedBindings,
      stillCurrent: () => current,
      localBlobIdBySlotId: { [fixture.attachment.slotId]: fixture.blobId },
      localStorageKeyBySlotId: { [fixture.attachment.slotId]: "held" },
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
    });
    expect(hash).toHaveBeenCalled();
    expect(rejectedServedBindings.size).toBe(0);
  } finally {
    hash.mockRestore();
  }
});
