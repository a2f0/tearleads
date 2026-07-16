import { expect, test } from "bun:test";
import { mapPendingAttachmentRecord } from "./attachmentRows";

const baseRow = {
  byteLength: 12,
  localId: "local-document",
  mimeType: "application/octet-stream",
  name: "attachment.bin",
  slotId: "slot-1",
  storageKey: "storage-1",
  uploadBlobId: null,
  uploadContentKey: null,
  uploadContentKeyEpoch: null,
  uploadIv: null,
  uploadPartSize: null,
  uploadPlaintextSha256: null,
  uploadStageId: null,
};

test("pending attachment rows allow an identity that has not been created", () => {
  expect(mapPendingAttachmentRecord(baseRow).upload).toBeNull();
});

test("pending attachment rows restore a complete multipart identity", () => {
  const record = mapPendingAttachmentRecord({
    ...baseRow,
    uploadBlobId: "blob-1",
    uploadContentKey: "content-key",
    uploadContentKeyEpoch: 1,
    uploadIv: "iv-seed",
    uploadPartSize: 5 * 1024 * 1024,
    uploadPlaintextSha256: "a".repeat(64),
    uploadStageId: "stage-1",
  });

  expect(record.upload).toEqual({
    blobId: "blob-1",
    contentKey: "content-key",
    contentKeyEpoch: 1,
    nonceSeed: "iv-seed",
    partSize: 5 * 1024 * 1024,
    plaintextSha256: "a".repeat(64),
    stageId: "stage-1",
  });
});

test("pending attachment rows reject partial identities", () => {
  expect(() =>
    mapPendingAttachmentRecord({
      ...baseRow,
      uploadBlobId: "blob-1",
    }),
  ).toThrow("Pending attachment upload identity is incomplete.");
  expect(() =>
    mapPendingAttachmentRecord({
      ...baseRow,
      uploadPartSize: 5 * 1024 * 1024,
      uploadStageId: "stage-1",
    }),
  ).toThrow("Pending attachment multipart identity has no upload.");
});
