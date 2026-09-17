import { afterEach, expect, test } from "bun:test";
import type { BlobStore, DocumentAttachment } from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { FileViewer, ViewFileRequest } from "../../host/FileViewer";
import { AUTOMATIC_BLOB_PREVIEW_MAX_BYTES } from "./documentAttachmentUtils";
import { useFileDocumentPdfPreview } from "./FileDocumentPdfPreview";

const attachment: DocumentAttachment = {
  contentSha256: "1".repeat(64),
  byteLength: 4,
  mimeType: "application/pdf",
  name: "paper.pdf",
  slotId: "pdf-slot",
};
const bytes = new Uint8Array([37, 80, 68, 70]) as Uint8Array<ArrayBuffer>;

function createBlobStore(value: Uint8Array<ArrayBuffer> | null): BlobStore {
  return {
    deleteBytes: async () => undefined,
    openByteSource: async () =>
      value
        ? {
            byteLength: value.byteLength,
            read: async (offset: number, length: number) =>
              value.slice(offset, offset + length),
          }
        : null,
    readBytes: async () => value,
    writeByteSource: async () => undefined,
    writeBytes: async () => undefined,
  };
}

afterEach(cleanup);

const noopLogError = () => undefined;

test("loads local PDF bytes without a click and keeps external opening optional", async () => {
  const requests: ViewFileRequest[] = [];
  const blobStore = createBlobStore(bytes);
  const fileViewer: FileViewer = {
    viewFile: async (request) => {
      requests.push(request);
    },
  };
  const hook = renderHook(() =>
    useFileDocumentPdfPreview({
      attachments: [attachment],
      attachmentStorageKeyBySlotId: { "pdf-slot": "local-pdf" },
      blobStore,
      fileViewer,
      logError: noopLogError,
    }),
  );

  await waitFor(() => expect(hook.result.current?.bytes).toEqual(bytes));
  expect(requests).toEqual([]);
  act(() => hook.result.current?.onOpenExternal?.());
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({
    data: bytes,
    fileName: "paper.pdf",
    mimeType: "application/pdf",
  });
});

test("ignores a PDF read that resolves after unmount", async () => {
  let resolveSource:
    | ((value: Awaited<ReturnType<BlobStore["openByteSource"]>>) => void)
    | undefined;
  const blobStore = createBlobStore(bytes);
  blobStore.openByteSource = () =>
    new Promise((resolve) => {
      resolveSource = resolve;
    });
  const hook = renderHook(() =>
    useFileDocumentPdfPreview({
      attachments: [attachment],
      attachmentStorageKeyBySlotId: { "pdf-slot": "local-pdf" },
      blobStore,
      fileViewer: null,
      logError: noopLogError,
    }),
  );

  expect(hook.result.current?.loading).toBe(true);
  hook.unmount();
  resolveSource?.({
    byteLength: bytes.byteLength,
    read: async () => bytes,
  });
  await Promise.resolve();
});

test("does not show one PDF's bytes while switching to another", async () => {
  const secondBytes = new Uint8Array([1, 2, 3, 4]) as Uint8Array<ArrayBuffer>;
  const blobStore = createBlobStore(bytes);
  blobStore.openByteSource = async (key) => {
    const value = key === "first" ? bytes : secondBytes;
    return {
      byteLength: value.byteLength,
      read: async (offset: number, length: number) =>
        value.slice(offset, offset + length),
    };
  };
  const hook = renderHook(
    ({ storageKey }) =>
      useFileDocumentPdfPreview({
        attachments: [attachment],
        attachmentStorageKeyBySlotId: { "pdf-slot": storageKey },
        blobStore,
        fileViewer: null,
        logError: noopLogError,
      }),
    { initialProps: { storageKey: "first" } },
  );

  await waitFor(() => expect(hook.result.current?.bytes).toEqual(bytes));
  hook.rerender({ storageKey: "second" });
  expect(hook.result.current?.bytes).not.toEqual(bytes);
  await waitFor(() => expect(hook.result.current?.bytes).toEqual(secondBytes));
});

test("reports PDFs whose local bytes are unavailable", async () => {
  const logged: [string | Error, unknown][] = [];
  const blobStore = createBlobStore(null);
  const hook = renderHook(() =>
    useFileDocumentPdfPreview({
      attachments: [attachment],
      attachmentStorageKeyBySlotId: { "pdf-slot": "local-pdf" },
      blobStore,
      fileViewer: null,
      logError: (message, cause) => {
        logged.push([message, cause]);
      },
    }),
  );

  await waitFor(() =>
    expect(hook.result.current?.error).toBe(
      "PDF preview is unavailable or over 5 MiB. You can still download it.",
    ),
  );
  expect(logged).toEqual([]);
});

test("oversized held PDFs never read into automatic preview memory", async () => {
  let readCount = 0;
  const blobStore = createBlobStore(bytes);
  blobStore.openByteSource = async () => ({
    byteLength: AUTOMATIC_BLOB_PREVIEW_MAX_BYTES + 1,
    read: async () => {
      readCount += 1;
      return bytes;
    },
  });
  blobStore.readBytes = async () => {
    throw new Error("unbounded readBytes must not be used for PDF preview");
  };
  const hook = renderHook(() =>
    useFileDocumentPdfPreview({
      attachments: [attachment], // Intent size is small; held bytes are not.
      attachmentStorageKeyBySlotId: { "pdf-slot": "oversized" },
      blobStore,
      fileViewer: null,
      logError: noopLogError,
    }),
  );
  await waitFor(() =>
    expect(hook.result.current?.error).toBe(
      "PDF preview is unavailable or over 5 MiB. You can still download it.",
    ),
  );
  expect(hook.result.current?.bytes).toBeNull();
  expect(readCount).toBe(0);
});

test("a PDF read that lost its database shows the error without reporting", async () => {
  const logged: [string | Error, unknown][] = [];
  const blobStore = createBlobStore(bytes);
  blobStore.openByteSource = () =>
    Promise.reject(new Error("Database client is unavailable."));
  const hook = renderHook(() =>
    useFileDocumentPdfPreview({
      attachments: [attachment],
      attachmentStorageKeyBySlotId: { "pdf-slot": "local-pdf" },
      blobStore,
      fileViewer: null,
      logError: (message, cause) => {
        logged.push([message, cause]);
      },
    }),
  );

  await waitFor(() =>
    expect(hook.result.current?.error).toBe(
      "Couldn't load this PDF. You can still download it.",
    ),
  );
  expect(logged).toEqual([]);
});
