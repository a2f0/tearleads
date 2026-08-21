import { afterEach, expect, test } from "bun:test";
import type { BlobStore, DocumentAttachment } from "@symcrypt/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { FileViewer, ViewFileRequest } from "../../host/FileViewer";
import { useFileDocumentPdfPreview } from "./FileDocumentPdfPreview";

const attachment: DocumentAttachment = {
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
  const originalConsoleError = console.error;
  try {
    console.error = () => undefined;
    const hook = renderHook(() =>
      useFileDocumentPdfPreview({
        attachments: [attachment],
        attachmentStorageKeyBySlotId: { "pdf-slot": "local-pdf" },
        blobStore: createBlobStore(null),
        fileViewer: null,
      }),
    );

    act(() => hook.result.current?.onOpen());
    await waitFor(() =>
      expect(hook.result.current?.error).toBe(
        "Couldn't open this PDF. You can still download it.",
      ),
    );
  } finally {
    console.error = originalConsoleError;
  }
});
