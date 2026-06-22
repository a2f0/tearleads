import { Readable } from "node:stream";
import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";
import {
  type BlobObjectReadChunk,
  type BlobObjectReadStream,
  BlobObjectStoreError,
  blobObjectChunkToStream,
  blobObjectChunkToUint8Array,
} from "./blobObjectStore";

async function* readBlobObjectStream(
  stream: BlobObjectReadStream,
): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        return;
      }
      yield chunk.value;
    }
  } finally {
    reader.releaseLock();
  }
}

export function nodeReadableFromBlobObjectStream(
  stream: BlobObjectReadStream,
): Readable {
  return Readable.from(readBlobObjectStream(stream));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function recordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function isAsyncIterable(
  value: unknown,
): value is AsyncIterable<string | Uint8Array> {
  return (
    isRecord(value) &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function"
  );
}

function hasTransformToWebStream(
  value: unknown,
): value is { readonly transformToWebStream: () => ReadableStream<unknown> } {
  return typeof recordValue(value, "transformToWebStream") === "function";
}

function readableStreamToBlobObjectStream(
  stream: ReadableStream<unknown>,
): BlobObjectReadStream {
  const reader = stream.getReader();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          // reader.cancel()/read-to-done do not release the lock; do it
          // explicitly so the underlying stream isn't pinned by a live reader.
          releaseReaderLock(reader);
          return;
        }

        if (typeof value === "string" || value instanceof Uint8Array) {
          controller.enqueue(blobObjectChunkToUint8Array(value));
          return;
        }

        throw new BlobObjectStoreError(
          "Unsupported S3 object body chunk type",
          "unsupported_body",
        );
      } catch (error) {
        await cancelReader(reader, error);
        controller.error(error);
      }
    },

    async cancel(reason) {
      await cancelReader(reader, reason);
    },
  });
}

function releaseReaderLock(reader: ReadableStreamDefaultReader<unknown>): void {
  try {
    reader.releaseLock();
  } catch {
    // releaseLock() throws if the lock was already released (e.g. a pending
    // read rejected and re-entered cancelReader); ignore so the original
    // stream error is preserved.
  }
}

async function cancelReader(
  reader: ReadableStreamDefaultReader<unknown>,
  reason: unknown,
): Promise<void> {
  try {
    await reader.cancel(reason);
  } catch {
    // Preserve the original stream error.
  } finally {
    // cancel() does not release the reader lock; release it so the underlying
    // stream isn't left pinned by a live reader.
    releaseReaderLock(reader);
  }
}

async function closeAsyncIterator(
  iterator: AsyncIterator<BlobObjectReadChunk>,
): Promise<void> {
  if (typeof iterator.return !== "function") {
    return;
  }

  try {
    await iterator.return();
  } catch {
    // Preserve the original iterator error.
  }
}

function asyncIterableToStream(
  value: AsyncIterable<BlobObjectReadChunk>,
): BlobObjectReadStream {
  const iterator = value[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value: chunk } = await iterator.next();
        if (done) {
          controller.close();
          // Mirror the error/cancel paths: release any resources the iterator
          // holds via return() on normal completion too.
          await closeAsyncIterator(iterator);
          return;
        }

        controller.enqueue(blobObjectChunkToUint8Array(chunk));
      } catch (error) {
        await closeAsyncIterator(iterator);
        controller.error(error);
      }
    },

    async cancel() {
      await closeAsyncIterator(iterator);
    },
  });
}

export async function responseBodyToStream(
  body: NonNullable<GetObjectCommandOutput["Body"]>,
): Promise<BlobObjectReadStream> {
  const value: unknown = body;
  if (typeof value === "string" || value instanceof Uint8Array) {
    return blobObjectChunkToStream(value);
  }
  if (hasTransformToWebStream(value)) {
    return readableStreamToBlobObjectStream(value.transformToWebStream());
  }
  if (value instanceof Blob) {
    return readableStreamToBlobObjectStream(value.stream());
  }
  if (value instanceof ReadableStream) {
    return readableStreamToBlobObjectStream(value);
  }
  if (isAsyncIterable(value)) {
    return asyncIterableToStream(value);
  }

  throw new BlobObjectStoreError(
    "Unsupported S3 object body type",
    "unsupported_body",
  );
}
