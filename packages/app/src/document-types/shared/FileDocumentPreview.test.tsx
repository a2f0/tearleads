import { afterEach, expect, test } from "bun:test";
import type { BlobStore, DocumentAttachment } from "@tearleads/client-sdk";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { AUTOMATIC_BLOB_PREVIEW_MAX_BYTES } from "./documentAttachmentUtils";
import { useFileDocumentMediaPreview } from "./FileDocumentPreview";

// The document intent records a small image...
const attachment: DocumentAttachment = {
  contentSha256: "1".repeat(64),
  byteLength: 4,
  mimeType: "image/png",
  name: "report.png",
  slotId: "image-slot",
};

function createBlobStore(heldByteLength: number) {
  const calls = { opened: 0, read: 0, readBytes: 0 };
  const blobStore: BlobStore = {
    deleteBytes: async () => undefined,
    openByteSource: async () => {
      calls.opened += 1;
      return {
        byteLength: heldByteLength,
        read: async (_offset: number, byteLength: number) => {
          calls.read += 1;
          return new Uint8Array(byteLength);
        },
      };
    },
    readBytes: async () => {
      calls.readBytes += 1;
      return null;
    },
    writeByteSource: async () => undefined,
    writeBytes: async () => undefined,
  };
  return { blobStore, calls };
}

afterEach(cleanup);

test("an oversized held attachment is not read for the automatic preview", async () => {
  // ...while the held (flagged, validly signed) bytes are past the limit.
  const { blobStore, calls } = createBlobStore(
    AUTOMATIC_BLOB_PREVIEW_MAX_BYTES + 1,
  );
  const hook = renderHook(() =>
    useFileDocumentMediaPreview({
      attachments: [attachment],
      attachmentStorageKeyBySlotId: { "image-slot": "held-image" },
      blobStore,
    }),
  );
  await waitFor(() => expect(calls.opened).toBe(1));
  expect(hook.result.current?.mediaUrl).toBeNull();
  expect(calls.read).toBe(0);
  expect(calls.readBytes).toBe(0);
});

test("a held attachment within the limit is read for the automatic preview", async () => {
  const { blobStore, calls } = createBlobStore(4);
  renderHook(() =>
    useFileDocumentMediaPreview({
      attachments: [attachment],
      attachmentStorageKeyBySlotId: { "image-slot": "held-image" },
      blobStore,
    }),
  );
  await waitFor(() => expect(calls.read).toBe(1));
  expect(calls.readBytes).toBe(0);
});
