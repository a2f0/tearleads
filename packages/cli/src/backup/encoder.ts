/**
 * Encoder for the Universal Backup Format (.rbu)
 *
 * Writes backup files with the following structure:
 * - Header (32 bytes, plaintext): magic, version, flags, salt
 * - Chunks (variable, encrypted): manifest, database, blobs
 */

import { compress } from './compression.js';
import {
  CHUNK_HEADER_SIZE,
  FORMAT_VERSION,
  HEADER_SIZE,
  MAGIC_BYTES,
  MAGIC_SIZE,
  MAX_BLOB_CHUNK_SIZE
} from './constants.js';
import { deriveKey, encrypt, generateSalt } from './crypto.js';
import {
  type BackupProgressEvent,
  type BlobEntry,
  type BlobHeader,
  ChunkType,
  type ChunkTypeValue,
  type EncodeOptions
} from './types.js';

/**
 * Write a 32-bit unsigned integer to a buffer in little-endian format.
 */
function writeUint32LE(
  buffer: Uint8Array,
  value: number,
  offset: number
): void {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );
  view.setUint32(offset, value, true);
}

/**
 * Write a 16-bit unsigned integer to a buffer in little-endian format.
 */
function writeUint16LE(
  buffer: Uint8Array,
  value: number,
  offset: number
): void {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );
  view.setUint16(offset, value, true);
}

/**
 * Create the backup file header.
 */
function createHeader(salt: Uint8Array, flags: number = 0): Uint8Array {
  const header = new Uint8Array(HEADER_SIZE);

  header.set(MAGIC_BYTES, 0);
  writeUint16LE(header, FORMAT_VERSION, MAGIC_SIZE);
  writeUint16LE(header, flags, MAGIC_SIZE + 2);
  header.set(salt, MAGIC_SIZE + 4);

  return header;
}

/**
 * Create a chunk with header and encrypted payload.
 */
async function createChunk(
  data: Uint8Array,
  chunkType: ChunkTypeValue,
  key: CryptoKey
): Promise<Uint8Array> {
  const compressed = await compress(data);
  const { iv, ciphertext } = await encrypt(compressed, key);
  const chunk = new Uint8Array(CHUNK_HEADER_SIZE + ciphertext.length);

  writeUint32LE(chunk, ciphertext.length, 0);
  chunk[4] = chunkType;
  chunk.set(iv, 8);
  chunk.set(ciphertext, CHUNK_HEADER_SIZE);

  return chunk;
}

/**
 * Encode JSON data as a chunk.
 */
async function encodeJsonChunk(
  data: unknown,
  chunkType: ChunkTypeValue,
  key: CryptoKey
): Promise<Uint8Array> {
  const json = JSON.stringify(data);
  const bytes = new TextEncoder().encode(json);
  return createChunk(bytes, chunkType, key);
}

/**
 * Encode a blob as one or more chunks.
 * Large blobs (>10MB) are split into multiple chunks.
 */
async function* encodeBlobChunks(
  blob: BlobEntry,
  data: Uint8Array,
  key: CryptoKey
): AsyncGenerator<Uint8Array> {
  const totalParts = Math.ceil(data.length / MAX_BLOB_CHUNK_SIZE) || 1;

  for (let partIndex = 0; partIndex < totalParts; partIndex++) {
    const start = partIndex * MAX_BLOB_CHUNK_SIZE;
    const end = Math.min(start + MAX_BLOB_CHUNK_SIZE, data.length);
    const partData = data.slice(start, end);

    const header: BlobHeader = {
      path: blob.path,
      mimeType: blob.mimeType,
      size: blob.size,
      ...(totalParts > 1 && { partIndex, totalParts })
    };

    const headerBytes = new TextEncoder().encode(JSON.stringify(header));
    const chunkData = new Uint8Array(headerBytes.length + 1 + partData.length);
    chunkData.set(headerBytes, 0);
    chunkData[headerBytes.length] = 0;
    chunkData.set(partData, headerBytes.length + 1);

    yield createChunk(chunkData, ChunkType.BLOB, key);
  }
}

/**
 * Encode a complete backup file.
 *
 * @param options - Encoding options
 * @returns Complete backup file as Uint8Array
 */
export async function encode(options: EncodeOptions): Promise<Uint8Array> {
  const { password, manifest, database, blobs, readBlob, onProgress } = options;

  const salt = generateSalt();
  const key = await deriveKey(password, salt);

  const header = createHeader(salt);
  const chunks: Uint8Array[] = [header];

  const totalSteps = 2 + blobs.length;
  let currentStep = 0;

  const reportProgress = (
    phase: BackupProgressEvent['phase'],
    item?: string
  ) => {
    onProgress?.({
      phase,
      current: currentStep,
      total: totalSteps,
      currentItem: item
    });
  };

  reportProgress('preparing', 'manifest');
  const manifestChunk = await encodeJsonChunk(
    manifest,
    ChunkType.MANIFEST,
    key
  );
  chunks.push(manifestChunk);
  currentStep++;

  reportProgress('database', 'database');
  const databaseChunk = await encodeJsonChunk(
    database,
    ChunkType.DATABASE,
    key
  );
  chunks.push(databaseChunk);
  currentStep++;

  for (const blob of blobs) {
    reportProgress('blobs', blob.path);
    const blobData = await readBlob(blob.path);

    for await (const chunk of encodeBlobChunks(blob, blobData, key)) {
      chunks.push(chunk);
    }
    currentStep++;
  }

  const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  reportProgress('finalizing', 'complete');

  return output;
}
