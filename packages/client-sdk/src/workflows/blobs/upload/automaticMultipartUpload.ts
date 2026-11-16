import { DEFAULT_BLOB_CHUNK_SIZE_BYTES } from "../../../data/blobs/attachments/crypto";
import type { MultipartBlobUploadOptions } from "../../../data/blobs/attachments/types";

export function resolveMultipartUploadOptions(
  multipart: MultipartBlobUploadOptions | undefined,
): MultipartBlobUploadOptions {
  const resolved = multipart ?? { partSize: DEFAULT_BLOB_CHUNK_SIZE_BYTES };
  if (resolved.partSize !== DEFAULT_BLOB_CHUNK_SIZE_BYTES) {
    throw new Error("Multipart blob chunk size must be exactly 5 MiB");
  }
  return resolved;
}
