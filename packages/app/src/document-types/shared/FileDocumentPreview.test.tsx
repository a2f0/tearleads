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

const noopLogError = () => undefined;

function rejectingBlobStore(failure: Error): BlobStore {
  return {
    deleteBytes: async () => undefined,
    openByteSource: async () => {
      throw failure;
    },
    readBytes: async () => null,
    writeByteSource: async () => undefined,
    writeBytes: async () => undefined,
  };
}

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
      logError: noopLogError,
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
      logError: noopLogError,
    }),
  );
  await waitFor(() => expect(calls.read).toBe(1));
  expect(calls.readBytes).toBe(0);
});

test("a failed preview read is reported with its original error", async () => {
  const failure = new Error("corrupt local bytes");
  const logged: [string | Error, unknown][] = [];
  const hook = renderHook(() =>
    useFileDocumentMediaPreview({
      attachments: [attachment],
      attachmentStorageKeyBySlotId: { "image-slot": "held-image" },
      blobStore: rejectingBlobStore(failure),
      logError: (message, cause) => {
        logged.push([message, cause]);
      },
    }),
  );
  await waitFor(() =>
    expect(logged).toEqual([["Failed to load file preview", failure]]),
  );
  expect(hook.result.current?.mediaUrl).toBeNull();
});

test("a preview read that lost its database is not reported", async () => {
  // The runtime is rebooted underneath in-flight reads on an identity switch
  // or Explorer retry; that is a benign outcome, not a defect.
  const logged: [string | Error, unknown][] = [];
  const hook = renderHook(() =>
    useFileDocumentMediaPreview({
      attachments: [attachment],
      attachmentStorageKeyBySlotId: { "image-slot": "held-image" },
      blobStore: rejectingBlobStore(new Error("DB has been closed.")),
      logError: (message, cause) => {
        logged.push([message, cause]);
      },
    }),
  );
  await waitFor(() => expect(hook.result.current?.mediaUrl).toBeNull());
  // Settle the rejected read before asserting nothing was reported.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(logged).toEqual([]);
});
