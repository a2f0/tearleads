/**
 * Compression utilities for backup data.
 *
 * Uses gzip compression with platform-appropriate implementation:
 * - Browser: Compression Streams API
 * - Node.js/Test: Native zlib module
 */

/**
 * Check if we're running in a Node.js environment (including tests).
 */
function isNodeEnvironment(): boolean {
  return (
    typeof process !== 'undefined' &&
    process.versions !== undefined &&
    process.versions.node !== undefined
  );
}

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
 * Compress data using gzip (Browser implementation using Compression Streams API).
 */
async function compressBrowser(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  // Create a proper ArrayBuffer from the Uint8Array to satisfy BufferSource type
  writer.write(new Uint8Array(data).buffer);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Decompress gzip data (Browser implementation using Decompression Streams API).
 */
async function decompressBrowser(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  // Create a proper ArrayBuffer from the Uint8Array to satisfy BufferSource type
  writer.write(new Uint8Array(data).buffer);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Compress data using gzip.
 *
 * @param data - Uncompressed data
 * @returns Compressed data
 */
export async function compress(data: Uint8Array): Promise<Uint8Array> {
  if (isNodeEnvironment()) {
    return compressNode(data);
  }
  return compressBrowser(data);
}

/**
 * Decompress gzip data.
 *
 * @param data - Compressed data
 * @returns Decompressed data
 * @throws Error if data is not valid gzip
 */
export async function decompress(data: Uint8Array): Promise<Uint8Array> {
  if (isNodeEnvironment()) {
    return decompressNode(data);
  }
  return decompressBrowser(data);
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
