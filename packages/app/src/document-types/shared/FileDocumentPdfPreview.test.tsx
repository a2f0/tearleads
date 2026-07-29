import { afterEach, expect, test } from "bun:test";
import type { BlobStore, DocumentAttachment } from "@tearleads/client-sdk";
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

test("creates and revokes a browser object URL only after opening", async () => {
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  const revoked: string[] = [];

  try {
    URL.createObjectURL = (() =>
      "blob:pdf-preview") as typeof URL.createObjectURL;
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
