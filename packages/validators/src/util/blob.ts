/**
 * Protocol ceiling for a multipart blob part. Bounds client hashing and native
 * HTTP bridge buffers for direct uploads, and API buffers for non-signing stores.
 */
export const MAX_MULTIPART_BLOB_PART_BYTES = 32 * 1024 * 1024;
