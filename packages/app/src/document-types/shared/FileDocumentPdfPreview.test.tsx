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

test("hands local PDF bytes to the native viewer on demand", async () => {
  const requests: ViewFileRequest[] = [];
  const fileViewer: FileViewer = {
    viewFile: async (request) => {
      requests.push(request);
    },
  };
  const hook = renderHook(() =>
    useFileDocumentPdfPreview({
      attachments: [attachment],
      attachmentStorageKeyBySlotId: { "pdf-slot": "local-pdf" },
      blobStore: createBlobStore(bytes),
      fileViewer,
      logError: noopLogError,
    }),
  );

  act(() => hook.result.current?.onOpen());
  await waitFor(() => expect(hook.result.current?.loading).toBe(false));

  expect(requests).toEqual([
    {
      data: bytes,
      fileName: "paper.pdf",
      mimeType: "application/pdf",
    },
  ]);
  expect(hook.result.current?.url).toBeNull();
});

test("ignores a second open while the first one is still loading", async () => {
  let readCount = 0;
  let resolveBytes: ((value: Uint8Array<ArrayBuffer>) => void) | undefined;
  const pendingBytes = new Promise<Uint8Array<ArrayBuffer>>((resolve) => {
    resolveBytes = resolve;
  });
  const blobStore = createBlobStore(bytes);
  blobStore.readBytes = () => {
    readCount += 1;
    return pendingBytes;
  };
  const fileViewer: FileViewer = { viewFile: async () => undefined };
  const hook = renderHook(() =>
    useFileDocumentPdfPreview({
      attachments: [attachment],
      attachmentStorageKeyBySlotId: { "pdf-slot": "local-pdf" },
      blobStore,
      fileViewer,
      logError: noopLogError,
    }),
  );

  act(() => {
    hook.result.current?.onOpen();
    hook.result.current?.onOpen();
  });
  expect(readCount).toBe(1);

  resolveBytes?.(bytes);
  await waitFor(() => expect(hook.result.current?.loading).toBe(false));
});

test("creates and revokes a browser object URL only after opening", async () => {
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  let createCount = 0;
  const revoked: string[] = [];

  try {
    URL.createObjectURL = (() => {
      createCount += 1;
      return "blob:pdf-preview";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = ((url: string) => {
      revoked.push(url);
    }) as typeof URL.revokeObjectURL;
    const hook = renderHook(() =>
      useFileDocumentPdfPreview({
        attachments: [attachment],
        attachmentStorageKeyBySlotId: { "pdf-slot": "local-pdf" },
        blobStore: createBlobStore(bytes),
        fileViewer: null,
        logError: noopLogError,
      }),
    );

    expect(hook.result.current?.url).toBeNull();
    act(() => hook.result.current?.onOpen());
    await waitFor(() =>
      expect(hook.result.current?.url).toBe("blob:pdf-preview"),
    );
    act(() => hook.result.current?.onOpen());
    expect(createCount).toBe(1);

    hook.unmount();
    expect(revoked).toEqual(["blob:pdf-preview"]);
  } finally {
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  }
});

test("reports PDFs whose local bytes are unavailable", async () => {
  const logged: [string | Error, unknown][] = [];
  const hook = renderHook(() =>
    useFileDocumentPdfPreview({
      attachments: [attachment],
      attachmentStorageKeyBySlotId: { "pdf-slot": "local-pdf" },
      blobStore: createBlobStore(null),
      fileViewer: null,
      logError: (message, cause) => {
        logged.push([message, cause]);
      },
    }),
  );

  act(() => hook.result.current?.onOpen());
  await waitFor(() =>
    expect(hook.result.current?.error).toBe(
      "Couldn't open this PDF. You can still download it.",
    ),
  );
  // The original Error reaches diagnostics alongside the user-facing message.
  expect(logged).toHaveLength(1);
  const [message, cause] = logged[0] ?? [];
  expect(message).toBe("Failed to open PDF preview");
  expect(cause).toBeInstanceOf(Error);
  expect(cause instanceof Error ? cause.message : null).toBe(
    "PDF bytes are not available locally.",
  );
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

  act(() => hook.result.current?.onOpen());
  await waitFor(() =>
    expect(hook.result.current?.error).toBe(
      "Couldn't open this PDF. You can still download it.",
    ),
  );
  expect(logged).toEqual([]);
});
