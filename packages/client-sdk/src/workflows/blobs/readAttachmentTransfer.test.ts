import { expect, test } from "bun:test";
import { runBlobTransfer } from "../../data/blobs/transferPool";
import { readAttachmentTransfer } from "./readAttachmentTransfer";

test("a stalled response body is cancelled and releases its permit", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  await expect(
    runBlobTransfer(
      {},
      (signal, progress) =>
        readAttachmentTransfer(
          {
            blobId: "blob",
            byteLength: 1,
            sha256: "digest",
            encryptedBytes: body,
          },
          signal,
          progress,
        ),
      20,
    ),
  ).rejects.toThrow("Blob transfer timed out");
  expect(cancelled).toBe(true);
});

test("stream chunks retain exact bytes and report progress", async () => {
  let progress = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3]));
      controller.close();
    },
  });
  const bytes = await readAttachmentTransfer(
    {
      blobId: "blob",
      byteLength: 3,
      sha256: "digest",
      encryptedBytes: body,
    },
    new AbortController().signal,
    () => {
      progress += 1;
    },
  );
  expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  expect(progress).toBe(2);
});
