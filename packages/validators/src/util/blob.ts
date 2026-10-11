/**
 * Protocol ceiling for one buffered multipart blob part. The API buffers a
 * part before uploading it, and the Workers isolate that serves uploads has
 * 128 MB of memory, so the ceiling leaves room for the copy the digest check
 * makes.
 */
export const MAX_MULTIPART_BLOB_PART_BYTES = 32 * 1024 * 1024;
