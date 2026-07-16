import type { BlobObjectStore } from "../../src/adapters/blobObjectStore";
import { sha256Hex } from "../../src/utils/sha256";

export function blobObjectBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? new TextEncoder().encode(value) : value;
}

export async function uploadBlobObject(
  store: BlobObjectStore,
  key: string,
  value: string | Uint8Array,
): Promise<void> {
  const bytes = blobObjectBytes(value);
  const sha256 = await sha256Hex(bytes);
  const { uploadId } = await store.createMultipartUpload({ key });
  const part = await store.uploadPart({
    body: {
      byteLength: bytes.byteLength,
      bytes,
      sha256,
    },
    key,
    partNumber: 1,
    uploadId,
  });
  await store.completeMultipartUpload({
    expected: { byteLength: bytes.byteLength, sha256 },
    key,
    parts: [{ etag: part.etag, partNumber: 1 }],
    uploadId,
  });
}

export async function readBlobObjectText(
  store: BlobObjectStore,
  key: string,
): Promise<string | null> {
  const stream = await store.getObjectStream(key);
  return stream ? new Response(stream).text() : null;
}
