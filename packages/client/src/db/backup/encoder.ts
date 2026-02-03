/**
 * Encoder for the Universal Backup Format (.rbu)
 *
 * Writes backup files with the following structure:
 * - Header (32 bytes, plaintext): magic, version, flags, salt
 * - Chunks (variable, encrypted): manifest, database, blobs
 */

import { compress } from './compression';
import {
  CHUNK_HEADER_SIZE,
  FORMAT_VERSION,
  HEADER_SIZE,
  MAGIC_BYTES,
  MAGIC_SIZE,
  MAX_BLOB_CHUNK_SIZE
} from './constants';
import { deriveKey, encrypt, generateSalt } from './crypto';
import {
  type BackupDatabase,
  type BackupManifest,
  type BackupProgressEvent,
  type BlobEntry,
  type BlobHeader,
  ChunkType,
  type ChunkTypeValue
} from './types';

/**
 * Options for encoding a backup file.
 */
export interface EncodeOptions {
  /** Password for encryption */
  password: string;
  /** Backup manifest */
  manifest: BackupManifest;
  /** Database content (schemas and data) */
  database: BackupDatabase;
  /** Blob entries to include */
  blobs: BlobEntry[];
  /** Function to read blob data by path */
  readBlob: (path: string) => Promise<Uint8Array>;
  /** Progress callback */
  onProgress?: (event: BackupProgressEvent) => void;
}

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

  // Magic bytes (8 bytes)
  header.set(MAGIC_BYTES, 0);

  // Version (2 bytes, little-endian)
  writeUint16LE(header, FORMAT_VERSION, MAGIC_SIZE);

  // Flags (2 bytes, little-endian)
  writeUint16LE(header, flags, MAGIC_SIZE + 2);

  // Salt (16 bytes)
  header.set(salt, MAGIC_SIZE + 4);

  // Reserved (4 bytes) - already zero-filled

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
  // Compress the data
  const compressed = await compress(data);

  // Encrypt the compressed data
  const { iv, ciphertext } = await encrypt(compressed, key);

  // Create chunk: header (20 bytes) + ciphertext
  const chunk = new Uint8Array(CHUNK_HEADER_SIZE + ciphertext.length);

  // Payload length (4 bytes)
  writeUint32LE(chunk, ciphertext.length, 0);

  // Chunk type (1 byte)
  chunk[4] = chunkType;

  // Reserved (3 bytes) - already zero-filled

  // IV (12 bytes)
  chunk.set(iv, 8);

  // Ciphertext
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

    // Create blob header
    const header: BlobHeader = {
      path: blob.path,
      mimeType: blob.mimeType,
      size: blob.size,
      ...(totalParts > 1 && { partIndex, totalParts })
    };

    // Encode header as JSON + null separator + binary data
    const headerBytes = new TextEncoder().encode(JSON.stringify(header));
    const chunkData = new Uint8Array(headerBytes.length + 1 + partData.length);
    chunkData.set(headerBytes, 0);
    chunkData[headerBytes.length] = 0; // Null separator
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

  // Generate salt and derive key
  const salt = generateSalt();
  const key = await deriveKey(password, salt);

  // Create header
  const header = createHeader(salt);

  // Collect all chunks
  const chunks: Uint8Array[] = [header];

  // Progress tracking
  const totalSteps = 2 + blobs.length; // manifest + database + each blob
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

  // Encode manifest
  reportProgress('preparing', 'manifest');
  const manifestChunk = await encodeJsonChunk(
    manifest,
    ChunkType.MANIFEST,
    key
  );
  chunks.push(manifestChunk);
  currentStep++;

  // Encode database
  reportProgress('database', 'database');
  const databaseChunk = await encodeJsonChunk(
    database,
    ChunkType.DATABASE,
    key
  );
  chunks.push(databaseChunk);
  currentStep++;

  // Encode blobs
  for (const blob of blobs) {
    reportProgress('blobs', blob.path);
    const data = await readBlob(blob.path);

    for await (const blobChunk of encodeBlobChunks(blob, data, key)) {
      chunks.push(blobChunk);
    }
    currentStep++;
  }

  reportProgress('finalizing');

  // Calculate total size
  const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);

  // Concatenate all chunks
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Calculate the approximate size of a backup before encoding.
 * Useful for progress estimation.
 */
export function estimateBackupSize(
  manifest: BackupManifest,
  database: BackupDatabase,
  blobs: BlobEntry[]
): number {
  // Header
  let size = HEADER_SIZE;

  // Manifest (rough estimate: JSON + compression overhead + encryption overhead)
  const manifestJson = JSON.stringify(manifest);
  size += CHUNK_HEADER_SIZE + Math.ceil(manifestJson.length * 0.3) + 16;

  // Database (rough estimate)
  const databaseJson = JSON.stringify(database);
  size += CHUNK_HEADER_SIZE + Math.ceil(databaseJson.length * 0.3) + 16;

  // Blobs (rough estimate: most binary files don't compress well)
  for (const blob of blobs) {
    const numChunks = Math.ceil(blob.size / MAX_BLOB_CHUNK_SIZE) || 1;
    size += numChunks * (CHUNK_HEADER_SIZE + 200); // Header overhead per chunk
    size += blob.size + 16; // Data + auth tag
  }

  return size;
}
