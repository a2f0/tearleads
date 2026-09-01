import { expect, test } from "bun:test";
import type { BlobInfo } from "@tearleads/client-sdk";
import {
  createBlobByteSource,
  createMemoryBlobStore,
  readBlobByteSource,
} from "@tearleads/client-sdk";
import {
  AUTOMATIC_BLOB_PREVIEW_MAX_BYTES,
  getDocumentAttachmentBlobName,
  getLatestDocumentAttachmentBySlotId,
  isAutomaticBlobPreviewAllowed,
  isImageDocumentAttachmentBlob,
  readBlobDocumentAttachmentUpload,
  readDocumentAttachmentUpload,
} from "./documentAttachmentUtils";

test("automatic blob previews have a fixed memory bound", () => {
  expect(
    isAutomaticBlobPreviewAllowed({
      byteLength: AUTOMATIC_BLOB_PREVIEW_MAX_BYTES,
    }),
  ).toBe(true);
  expect(
    isAutomaticBlobPreviewAllowed({
      byteLength: AUTOMATIC_BLOB_PREVIEW_MAX_BYTES + 1,
    }),
  ).toBe(false);
});

function createBlobInfo(patch: Partial<BlobInfo> = {}): BlobInfo {
  return {
    blobId: "blob-1",
    byteLength: 11,
    createdAt: null,
    documentCount: 1,
    key: "blob:blob-1",
    mimeType: "image/png",
    name: null,
    organizationId: null,
    referenceCount: 1,
    references: [],
    storageKey: "storage-1",
    updatedAt: null,
    ...patch,
  };
}

test("attachment lookup returns the latest slot binding", () => {
  const attachment = getLatestDocumentAttachmentBySlotId(
    [
      {
        byteLength: 10,
        mimeType: "image/jpeg",
        name: "front-original.jpg",
        slotId: "front",
      },
      {
        byteLength: 20,
        mimeType: "image/jpeg",
        name: "front-updated.jpg",
        slotId: "front",
      },
    ],
    "front",
  );

  expect(attachment).toEqual({
    byteLength: 20,
    mimeType: "image/jpeg",
    name: "front-updated.jpg",
    slotId: "front",
  });
});

test("blob attachment helpers identify images and choose a stable name", () => {
  expect(isImageDocumentAttachmentBlob(createBlobInfo())).toBe(true);
  expect(
    isImageDocumentAttachmentBlob(createBlobInfo({ mimeType: "text/plain" })),
  ).toBe(false);
  expect(
    getDocumentAttachmentBlobName(createBlobInfo({ name: "front.png" })),
  ).toBe("front.png");
  expect(
    getDocumentAttachmentBlobName(
      createBlobInfo({
        blobId: null,
        references: [
          {
            attachmentKind: "local",
            blobId: null,
            byteLength: 11,
            containerId: null,
            createdAt: null,
            documentId: null,
            documentKind: "drivers_license",
            documentTitle: "License",
            localId: "local-1",
            mimeType: "image/png",
            name: "reference.png",
            slotId: "front",
            storageKey: "storage-1",
            updatedAt: null,
          },
        ],
      }),
    ),
  ).toBe("reference.png");
  expect(
    getDocumentAttachmentBlobName(
      createBlobInfo({ blobId: null, storageKey: "storage-only" }),
    ),
  ).toBe("storage-only");
});

test("file attachment upload preserves the lazy File source", async () => {
  const file = new File(["file bytes"], "file.txt", { type: "text/plain" });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => {
      throw new Error("File should not be materialized during selection");
    },
  });

  const upload = await readDocumentAttachmentUpload(file);

  expect(upload.bytes).toBe(file);
  expect(upload.mimeType).toBe(file.type);
  expect(upload.name).toBe("file.txt");
});

test("blob attachment upload opens the existing local blob source", async () => {
  const blobStore = createMemoryBlobStore();
  await blobStore.writeBytes("storage-1", new TextEncoder().encode("blob"));

  const upload = await readBlobDocumentAttachmentUpload({
    blob: createBlobInfo({ name: "blob.png" }),
    blobStore,
  });

  const bytes = await readBlobByteSource(createBlobByteSource(upload.bytes));
  expect(new TextDecoder().decode(bytes)).toBe("blob");
  expect(upload.mimeType).toBe("image/png");
  expect(upload.name).toBe("blob.png");
});
