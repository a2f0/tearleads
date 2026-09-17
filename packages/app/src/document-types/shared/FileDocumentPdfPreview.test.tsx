import { afterEach, expect, test } from "bun:test";
import type { BlobStore, DocumentAttachment } from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { FileViewer, ViewFileRequest } from "../../host/FileViewer";
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
    openByteSource: async () => null,
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
  let resolveBytes: ((value: Uint8Array<ArrayBuffer>) => void) | undefined;
  const blobStore = createBlobStore(bytes);
  blobStore.readBytes = () =>
    new Promise((resolve) => {
      resolveBytes = resolve;
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
  resolveBytes?.(bytes);
  await Promise.resolve();
});

test("does not show one PDF's bytes while switching to another", async () => {
  const secondBytes = new Uint8Array([1, 2, 3, 4]) as Uint8Array<ArrayBuffer>;
  const blobStore = createBlobStore(bytes);
  blobStore.readBytes = async (key) => (key === "first" ? bytes : secondBytes);
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
      "Couldn't load this PDF. You can still download it.",
    ),
  );
  expect(logged[0]?.[0]).toBe("Failed to load PDF preview");
  expect(logged[0]?.[1]).toBeInstanceOf(Error);
});

test("a PDF read that lost its database shows the error without reporting", async () => {
  const logged: [string | Error, unknown][] = [];
  const blobStore = createBlobStore(bytes);
  blobStore.readBytes = () =>
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
