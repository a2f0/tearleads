/**
 * Decoder for the Tearleads Backup Utility format (.tbu)
 *
 * Reads backup files with the following structure:
 * - Header (32 bytes, plaintext): magic, version, flags, salt
 * - Chunks (variable, encrypted): manifest, database, blobs
 */

import { decompress } from './compression.js';
import {
  CHUNK_HEADER_SIZE,
  FORMAT_VERSION,
  HEADER_SIZE,
  MAGIC_BYTES,
  MAGIC_SIZE,
  PBKDF2_ITERATIONS,
  SALT_SIZE
} from './constants.js';
import { decrypt, deriveKey } from './crypto.js';
import {
  type BackupHeader,
  type BackupManifest,
  type BackupProgressEvent,
  type BlobHeader,
  ChunkType,
  type ChunkTypeValue,
  type DecodedBlob,
  type DecodeOptions,
  type DecodeResult
} from './types.js';

/**
 * Error thrown when backup file is invalid or corrupted.
 */
class BackupDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupDecodeError';
  }
}

/**
 * Error thrown when password is incorrect.
 */
class InvalidPasswordError extends Error {
  constructor() {
    super('Invalid password or corrupted backup');
    this.name = 'InvalidPasswordError';
  }
}

/**
 * Read a 32-bit unsigned integer from a buffer in little-endian format.
 */
function readUint32LE(buffer: Uint8Array, offset: number): number {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );
  return view.getUint32(offset, true);
}

/**
 * Read a 16-bit unsigned integer from a buffer in little-endian format.
 */
function readUint16LE(buffer: Uint8Array, offset: number): number {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );
  return view.getUint16(offset, true);
}

/**
 * Parse the backup file header.
 */
function parseHeader(data: Uint8Array): BackupHeader {
  if (data.length < HEADER_SIZE) {
    throw new BackupDecodeError('File too small to be a valid backup');
  }

  const magic = data.slice(0, MAGIC_SIZE);
  for (let i = 0; i < MAGIC_SIZE; i++) {
    if (magic[i] !== MAGIC_BYTES[i]) {
      throw new BackupDecodeError('Invalid backup file: wrong magic bytes');
    }
  }

  const version = readUint16LE(data, MAGIC_SIZE);
  if (version > FORMAT_VERSION) {
    throw new BackupDecodeError(
      `Unsupported backup version: ${version} (max supported: ${FORMAT_VERSION})`
    );
  }

  const flags = readUint16LE(data, MAGIC_SIZE + 2);
  const salt = data.slice(MAGIC_SIZE + 4, MAGIC_SIZE + 4 + SALT_SIZE);

  return { magic, version, flags, salt };
}

/**
 * Parse a chunk header.
 */
function parseChunkHeader(data: Uint8Array, offset: number) {
  if (offset + CHUNK_HEADER_SIZE > data.length) {
    throw new BackupDecodeError(
      'Unexpected end of file while reading chunk header'
    );
  }

  const payloadLength = readUint32LE(data, offset);
  const chunkTypeValue = data[offset + 4] ?? -1;
  if (!isChunkTypeValue(chunkTypeValue)) {
    throw new BackupDecodeError(`Unknown chunk type: ${chunkTypeValue}`);
  }
  const reserved = data.slice(offset + 5, offset + 8);
  const iv = data.slice(offset + 8, offset + CHUNK_HEADER_SIZE);

  return { payloadLength, chunkType: chunkTypeValue, reserved, iv };
}

function isChunkTypeValue(value: number): value is ChunkTypeValue {
  return (
    value === ChunkType.MANIFEST ||
    value === ChunkType.DATABASE ||
    value === ChunkType.BLOB
  );
}

/**
 * Decrypt and decompress a chunk payload.
 */
async function decryptChunk(
  data: Uint8Array,
  offset: number,
  header: { payloadLength: number; iv: Uint8Array },
  key: CryptoKey
): Promise<Uint8Array> {
  const payloadStart = offset + CHUNK_HEADER_SIZE;
  const payloadEnd = payloadStart + header.payloadLength;

  if (payloadEnd > data.length) {
    throw new BackupDecodeError(
      'Unexpected end of file while reading chunk payload'
    );
  }

  const ciphertext = data.slice(payloadStart, payloadEnd);

  try {
    const compressed = await decrypt(ciphertext, key, header.iv);
    return decompress(compressed);
  } catch {
    throw new InvalidPasswordError();
  }
}

/**
 * Parse a JSON chunk (manifest or database).
 */
function parseJsonChunk<T>(data: Uint8Array): T {
  const json = new TextDecoder().decode(data);
  return JSON.parse(json);
}

/**
 * Parse a blob chunk.
 */
function parseBlobChunk(data: Uint8Array): DecodedBlob {
  const separatorIndex = data.indexOf(0);

  if (separatorIndex === -1) {
    throw new BackupDecodeError('Invalid blob chunk: missing separator');
  }

  const headerBytes = data.slice(0, separatorIndex);
  const blobData = data.slice(separatorIndex + 1);

  const header: BlobHeader = JSON.parse(new TextDecoder().decode(headerBytes));

  return { header, data: blobData };
}

/**
 * Decode a backup file.
 *
 * @param options - Decode options
 * @returns Decoded backup content
 */
export async function decode(options: DecodeOptions): Promise<DecodeResult> {
  const { data, password, onProgress } = options;

  const header = parseHeader(data);
  const decodeWithKey = async (key: CryptoKey): Promise<DecodeResult> => {
    let offset = HEADER_SIZE;
    let manifest: BackupManifest | null = null;
    let database: DecodeResult['database'] | null = null;
    const blobs: DecodedBlob[] = [];

    const totalChunks = Math.max(
      1,
      Math.floor((data.length - HEADER_SIZE) / CHUNK_HEADER_SIZE)
    );
    let currentChunk = 0;

    const reportProgress = (
      phase: BackupProgressEvent['phase'],
      item?: string
    ) => {
      if (!onProgress) return;
      const event: BackupProgressEvent = {
        phase,
        current: currentChunk,
        total: totalChunks,
        currentItem: item
      };
      onProgress(event);
    };

    while (offset < data.length) {
      const chunkHeader = parseChunkHeader(data, offset);
      const chunkData = await decryptChunk(data, offset, chunkHeader, key);

      switch (chunkHeader.chunkType) {
        case ChunkType.MANIFEST:
          reportProgress('preparing', 'manifest');
          manifest = parseJsonChunk<BackupManifest>(chunkData);
          break;
        case ChunkType.DATABASE:
          reportProgress('database', 'database');
          database = parseJsonChunk<DecodeResult['database']>(chunkData);
          break;
        case ChunkType.BLOB:
          reportProgress('blobs', 'blob');
          blobs.push(parseBlobChunk(chunkData));
          break;
        default:
          throw new BackupDecodeError(
            `Unknown chunk type: ${chunkHeader.chunkType}`
          );
      }

      offset += CHUNK_HEADER_SIZE + chunkHeader.payloadLength;
      currentChunk++;
    }

    if (!manifest || !database) {
      throw new BackupDecodeError('Backup missing required chunks');
    }

    reportProgress('finalizing', 'complete');

    return { manifest, database, blobs };
  };

  const key = await deriveKey(password, header.salt, PBKDF2_ITERATIONS);
  return decodeWithKey(key);
}
