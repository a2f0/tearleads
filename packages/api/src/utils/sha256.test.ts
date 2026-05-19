import { expect, test } from "bun:test";
import { summarizeSha256Stream } from "./sha256";

test("summarizeSha256Stream hashes stream chunks and counts bytes", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("hello "));
      controller.enqueue(new TextEncoder().encode("world"));
      controller.close();
    },
  });

  await expect(summarizeSha256Stream(stream)).resolves.toEqual({
    byteLength: 11,
    sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
  });
});

test("summarizeSha256Stream cancels streams after chunk processing errors", async () => {
  let cancelReason: unknown;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue({ byteLength: 1 } as Uint8Array);
    },
    cancel(reason) {
      cancelReason = reason;
    },
  });

  await expect(summarizeSha256Stream(stream)).rejects.toThrow();
  expect(cancelReason).toBeInstanceOf(Error);
});
