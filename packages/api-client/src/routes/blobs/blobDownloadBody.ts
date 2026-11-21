// A native HTTP bridge can have a successful buffered response with no body
// stream. Both transports retain the sign-in until the consumer reads a chunk.
export async function blobDownloadBody(
  response: Response,
  signal?: AbortSignal,
  redact = false,
  maxBytes?: number,
): Promise<ReadableStream<Uint8Array>> {
  const stream =
    response.body ?? bufferedResponseBodyStream(await response.arrayBuffer());
  if (!signal && !redact && maxBytes === undefined) return stream;
  let readBytes = 0;
  const reader = stream.getReader();
  function cancelRetired() {
    void reader.cancel().catch(() => {});
  }
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        signal?.addEventListener("abort", cancelRetired, { once: true });
        try {
          if (signal?.aborted) cancelRetired();
          signal?.throwIfAborted();
          const { done, value } = await reader.read();
          signal?.throwIfAborted();
          if (done) {
            controller.close();
            reader.releaseLock();
          } else {
            readBytes += value.byteLength;
            if (maxBytes !== undefined && readBytes > maxBytes) {
              cancelRetired();
              throw new Error("Blob stream exceeds its download limit");
            }
            controller.enqueue(value);
          }
        } catch (error) {
          controller.error(
            redact ? new Error("Blob download interrupted") : error,
          );
          reader.releaseLock();
        } finally {
          signal?.removeEventListener("abort", cancelRetired);
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } catch (error) {
          throw redact ? new Error("Blob download cancellation failed") : error;
        } finally {
          reader.releaseLock();
        }
      },
    },
    { highWaterMark: 0 },
  );
}

// Wraps a fully-buffered response body as a single-chunk ReadableStream, so a
// native HTTP bridge that only exposes the buffered bytes (no WHATWG
// `response.body` stream) can still satisfy the streaming
// `BlobBytesResponse.encryptedBytes` contract. An empty buffer yields an
// immediately-closed, zero-chunk stream.
function bufferedResponseBodyStream(
  buffer: ArrayBuffer,
): ReadableStream<Uint8Array> {
  const bytes = new Uint8Array(buffer);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytes.byteLength > 0) {
        controller.enqueue(bytes);
      }
      controller.close();
    },
  });
}
