/**
 * Compression utilities for backup data.
 *
 * Uses gzip compression with platform-appropriate implementation:
 * - Node.js: Native zlib module
 */

/**
 * Compress data using gzip (Node.js implementation).
 */
async function compressNode(data: Uint8Array): Promise<Uint8Array> {
  const { gzipSync } = await import('node:zlib');
  return new Uint8Array(gzipSync(data));
}

/**
 * Decompress gzip data (Node.js implementation).
 */
async function decompressNode(data: Uint8Array): Promise<Uint8Array> {
  const { gunzipSync } = await import('node:zlib');
  return new Uint8Array(gunzipSync(data));
}

/**
 * Compress data using gzip.
 *
 * @param data - Uncompressed data
 * @returns Compressed data
 */
export async function compress(data: Uint8Array): Promise<Uint8Array> {
  return compressNode(data);
}

/**
 * Decompress gzip data.
 *
 * @param data - Compressed data
 * @returns Decompressed data
 * @throws Error if data is not valid gzip
 */
export async function decompress(data: Uint8Array): Promise<Uint8Array> {
  return decompressNode(data);
}

/**
 * Compress a string (UTF-8 encoded) using gzip.
 *
 * @param text - String to compress
 * @returns Compressed data
 */
export async function compressString(text: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  return compress(encoder.encode(text));
}

/**
 * Decompress gzip data to a string (UTF-8 decoded).
 *
 * @param data - Compressed data
 * @returns Decompressed string
 */
export async function decompressString(data: Uint8Array): Promise<string> {
  const decompressed = await decompress(data);
  const decoder = new TextDecoder();
  return decoder.decode(decompressed);
}
