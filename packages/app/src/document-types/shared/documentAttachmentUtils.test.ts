import { expect, test } from "bun:test";
import type { BlobInfo } from "@tearleads/client-sdk";
import {
  createBlobByteSource,
  createMemoryBlobStore,
  readBlobByteSource,
} from "@tearleads/client-sdk";
import {
  AUTOMATIC_BLOB_PREVIEW_MAX_BYTES,
  expandAttachmentSlots,
  getDocumentAttachmentBlobName,
  getDocumentAttachmentStatusLabel,
  getLatestDocumentAttachmentBySlotId,
  isAutomaticBlobPreviewAllowed,
  isDocumentAttachmentBlobAccepted,
  isImageDocumentAttachmentBlob,
  isPdfDocumentAttachmentBlob,
  readAutomaticPreviewBlobBytes,
  readBlobDocumentAttachmentUpload,
  readDocumentAttachmentUpload,
} from "./documentAttachmentUtils";

test("attachment statuses label queued uploads and unrecorded served bytes", () => {
  expect(getDocumentAttachmentStatusLabel("syncing")).toBe("Syncing image.");
  expect(getDocumentAttachmentStatusLabel("intent-mismatch")).toBe(
    "Image differs from the document's recorded version.",
  );
  expect(getDocumentAttachmentStatusLabel("unavailable")).toBe(
    "Image missing or damaged on this device.",
  );
  expect(getDocumentAttachmentStatusLabel(undefined)).toBeNull();
});

test("a file slot's statuses call its attachment a file", () => {
  expect(getDocumentAttachmentStatusLabel("syncing", "File")).toBe(
    "Syncing file.",
  );
  expect(getDocumentAttachmentStatusLabel("unavailable", "File")).toBe(
    "File missing or damaged on this device.",
  );
});

test("a PDF is known by its type, however parameterized or cased", () => {
  expect(
    isPdfDocumentAttachmentBlob({ mimeType: "Application/PDF; version=1.7" }),
  ).toBe(true);
  // Only the upload infers a type from a name; a stored blob's type is final.
  expect(isPdfDocumentAttachmentBlob({ mimeType: null })).toBe(false);
  expect(
    isPdfDocumentAttachmentBlob({ mimeType: "application/octet-stream" }),
  ).toBe(false);
});

test("an untyped or generically typed upload takes its extension's type", async () => {
  const upload = (name: string, type: string) =>
    readDocumentAttachmentUpload(new File(["%PDF-1.7"], name, { type }));
  expect((await upload("Policy.PDF", "")).mimeType).toBe("application/pdf");
  expect(
    (await upload("policy.pdf", "application/octet-stream")).mimeType,
  ).toBe("application/pdf");
  // A declared type wins over the extension.
  expect((await upload("notes.pdf", "text/plain")).mimeType).toBe("text/plain");
  expect((await upload("blob.bin", "application/octet-stream")).mimeType).toBe(
    "application/octet-stream",
  );
  expect((await upload("blob", "")).mimeType).toBeNull();
});

test("only a file slot accepts PDF blobs, and its items keep that", () => {
  const pdf = createBlobInfo({ mimeType: "application/pdf" });
  const text = createBlobInfo({ mimeType: "text/plain" });
  expect(isDocumentAttachmentBlobAccepted("image", pdf)).toBe(false);
  expect(isDocumentAttachmentBlobAccepted("image-or-pdf", pdf)).toBe(true);
  expect(
    isDocumentAttachmentBlobAccepted("image-or-pdf", createBlobInfo()),
  ).toBe(true);
  expect(isDocumentAttachmentBlobAccepted("image-or-pdf", text)).toBe(false);
  expect(
    expandAttachmentSlots(
      [
        {
          accept: "image-or-pdf",
          itemLabel: "Statement",
          label: "Statements",
          multiple: true,
          slotId: "statements",
        },
      ],
      [
        {
          byteLength: 1,
          contentSha256: "3".repeat(64),
          mimeType: "application/pdf",
          name: "march.pdf",
          slotId: "statements:a",
        },
      ],
      { canAttach: false, isEditing: false },
    ),
  ).toEqual([
    { accept: "image-or-pdf", label: "Statement 1", slotId: "statements:a" },
  ]);
});

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
        contentSha256: "1".repeat(64),
        byteLength: 10,
        mimeType: "image/jpeg",
        name: "front-original.jpg",
        slotId: "front",
      },
      {
        contentSha256: "1".repeat(64),
        byteLength: 20,
        mimeType: "image/jpeg",
        name: "front-updated.jpg",
        slotId: "front",
      },
    ],
    "front",
  );

  expect(attachment).toEqual({
    contentSha256: "1".repeat(64),
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

test("automatic previews read held bytes only within the preview limit", async () => {
  const held = new Map<string, Uint8Array<ArrayBuffer>>([
    ["small", new Uint8Array([1, 2, 3])],
    ["large", new Uint8Array(AUTOMATIC_BLOB_PREVIEW_MAX_BYTES + 1)],
  ]);
  const blobStore = {
    openByteSource: async (storageKey: string) => {
      const bytes = held.get(storageKey);
      if (!bytes) return null;
      return {
        byteLength: bytes.byteLength,
        read: async (offset: number, byteLength: number) =>
          bytes.slice(offset, offset + byteLength),
      };
    },
  };
  expect(await readAutomaticPreviewBlobBytes(blobStore, "small")).toEqual(
    new Uint8Array([1, 2, 3]),
  );
  // The document intent may still describe a small attachment while the held
  // (flagged) bytes are larger; the held size gates the read.
  expect(await readAutomaticPreviewBlobBytes(blobStore, "large")).toBeNull();
  expect(await readAutomaticPreviewBlobBytes(blobStore, "missing")).toBeNull();
});
