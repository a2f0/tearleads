import { DEFAULT_BLOB_CHUNK_SIZE_BYTES } from "../../data/documents/blob/shared/crypto";
import type { UploadDocumentAttachmentInput } from "../../data/documents/blob/shared/types";

export function resolveMultipartUploadOptions(
  multipart: UploadDocumentAttachmentInput["multipart"],
): NonNullable<UploadDocumentAttachmentInput["multipart"]> {
  const resolved = multipart ?? { partSize: DEFAULT_BLOB_CHUNK_SIZE_BYTES };
  if (resolved.partSize !== DEFAULT_BLOB_CHUNK_SIZE_BYTES) {
    throw new Error("Multipart blob chunk size must be exactly 5 MiB");
  }
  return resolved;
}
