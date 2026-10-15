/**
 * Protocol ceiling for a multipart blob part. Bounds client hashing and native
 * HTTP bridge buffers for direct uploads, and API buffers for non-signing stores.
 */
export const MAX_MULTIPART_BLOB_PART_BYTES = 32 * 1024 * 1024;

/**
 * Parts a stage initiation may describe and receive upload sources for in its
 * own response: the SDK's upload concurrency, so every part it starts first
 * needs no separate authorization request. Later parts and retries authorize
 * one at a time, just before they are sent.
 */
export const MAX_INITIATE_PART_UPLOADS = 4;
