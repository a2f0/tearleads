/**
 * Decoder for the Tearleads Backup Utility format (.tbu)
 *
 * Reads backup files with the following structure:
 * - Header (32 bytes, plaintext): magic, version, flags, salt
 * - Chunks (variable, encrypted): manifest, database, blobs
 */

import { decompress } from './compression';
import {
  CHUNK_HEADER_SIZE,
  FORMAT_VERSION,
  HEADER_SIZE,
  MAGIC_BYTES,
  MAGIC_SIZE,
  PBKDF2_ITERATIONS,
  SALT_SIZE
} from './constants';
import { decrypt, deriveKey } from './crypto';
import {
  type BackupDatabase,
  type BackupHeader,
  type BackupManifest,
  type BackupProgressEvent,
  type BlobHeader,
  type ChunkHeader,
  ChunkType,
  type ChunkTypeValue
} from './types';

/**
 * Error thrown when backup file is invalid or corrupted.
 */
export class BackupDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupDecodeError';
  }
}

/**
 * Error thrown when password is incorrect.
 */
export class InvalidPasswordError extends Error {
  constructor() {
    super('Invalid password or corrupted backup');
    this.name = 'InvalidPasswordError';
  }
}

/**
 * Decoded blob data from a backup.
 */
export interface DecodedBlob {
  header: BlobHeader;
  data: Uint8Array;
}

/**
 * Result of decoding a backup file.
 */
export interface DecodeResult {
  /** Backup manifest */
  manifest: BackupManifest;
  /** Database content */
  database: BackupDatabase;
  /** Decoded blobs */
  blobs: DecodedBlob[];
}

/**
 * Options for decoding a backup file.
 */
interface DecodeOptions {
  /** Backup file data */
  data: Uint8Array;
  /** Password for decryption */
  password: string;
  /** Progress callback */
  onProgress?: (event: BackupProgressEvent) => void;
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

  // Check magic bytes
  const magic = data.slice(0, MAGIC_SIZE);
  for (let i = 0; i < MAGIC_SIZE; i++) {
    if (magic[i] !== MAGIC_BYTES[i]) {
      throw new BackupDecodeError('Invalid backup file: wrong magic bytes');
    }
  }

  // Read version
  const version = readUint16LE(data, MAGIC_SIZE);
  if (version > FORMAT_VERSION) {
    throw new BackupDecodeError(
      `Unsupported backup version: ${version} (max supported: ${FORMAT_VERSION})`
    );
  }

  // Read flags
  const flags = readUint16LE(data, MAGIC_SIZE + 2);

  // Read salt
  const salt = data.slice(MAGIC_SIZE + 4, MAGIC_SIZE + 4 + SALT_SIZE);

  return { magic, version, flags, salt };
}

/**
 * Parse a chunk header.
 */
function parseChunkHeader(data: Uint8Array, offset: number): ChunkHeader {
  if (offset + CHUNK_HEADER_SIZE > data.length) {
    throw new BackupDecodeError(
      'Unexpected end of file while reading chunk header'
    );
  }

  const payloadLength = readUint32LE(data, offset);
  const chunkType = data[offset + 4] as ChunkTypeValue;
  const reserved = data.slice(offset + 5, offset + 8);
  const iv = data.slice(offset + 8, offset + CHUNK_HEADER_SIZE);

  return { payloadLength, chunkType, reserved, iv };
}

/**
 * Decrypt and decompress a chunk payload.
 */
async function decryptChunk(
  data: Uint8Array,
  offset: number,
  header: ChunkHeader,
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
 * @param options - Decoding options
 * @returns Decoded backup content
 * @throws BackupDecodeError if file is invalid
 * @throws InvalidPasswordError if password is wrong
 */
export async function decode(options: DecodeOptions): Promise<DecodeResult> {
  const { data, password, onProgress } = options;

  // Parse header
  const header = parseHeader(data);

  const decodeWithKey = async (key: CryptoKey): Promise<DecodeResult> => {
    let manifest: BackupManifest | null = null;
    let database: BackupDatabase | null = null;
    const blobs: DecodedBlob[] = [];
    const partialBlobs = new Map<
      string,
      { parts: Map<number, Uint8Array>; header: BlobHeader }
    >();

    let offset = HEADER_SIZE;
    let chunkIndex = 0;

    let tempOffset = HEADER_SIZE;
    let totalChunks = 0;
    while (tempOffset < data.length) {
      const chunkHeader = parseChunkHeader(data, tempOffset);
      tempOffset += CHUNK_HEADER_SIZE + chunkHeader.payloadLength;
      totalChunks++;
    }

    const reportProgress = (
      phase: BackupProgressEvent['phase'],
      item?: string
    ) => {
      onProgress?.({
        phase,
        current: chunkIndex,
        total: totalChunks,
        currentItem: item
      });
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
          database = parseJsonChunk<BackupDatabase>(chunkData);
          break;

        case ChunkType.BLOB: {
          const decoded = parseBlobChunk(chunkData);
          reportProgress('blobs', decoded.header.path);

          if (decoded.header.totalParts && decoded.header.totalParts > 1) {
            const path = decoded.header.path;
            if (!partialBlobs.has(path)) {
              partialBlobs.set(path, {
                parts: new Map(),
                header: decoded.header
              });
            }
            const partial = partialBlobs.get(path);
            if (!partial) continue;
            partial.parts.set(decoded.header.partIndex ?? 0, decoded.data);

            if (partial.parts.size === decoded.header.totalParts) {
              const totalSize = Array.from(partial.parts.values()).reduce(
                (sum, part) => sum + part.length,
                0
              );
              const assembled = new Uint8Array(totalSize);
              let assembleOffset = 0;
              for (let i = 0; i < decoded.header.totalParts; i++) {
                const part = partial.parts.get(i);
                if (!part) {
                  throw new BackupDecodeError(
                    `Missing blob part ${i} for ${path}`
                  );
                }
                assembled.set(part, assembleOffset);
                assembleOffset += part.length;
              }
              const {
                partIndex: _,
                totalParts: __,
                ...headerWithoutParts
              } = partial.header;
              blobs.push({
                header: headerWithoutParts,
                data: assembled
              });
              partialBlobs.delete(path);
            }
          } else {
            blobs.push(decoded);
          }
          break;
        }

        default:
          break;
      }

      offset += CHUNK_HEADER_SIZE + chunkHeader.payloadLength;
      chunkIndex++;
    }

    reportProgress('finalizing');

    if (partialBlobs.size > 0) {
      const incomplete = Array.from(partialBlobs.keys()).join(', ');
      throw new BackupDecodeError(`Incomplete split blobs: ${incomplete}`);
    }

    if (!manifest) {
      throw new BackupDecodeError('Missing manifest chunk');
    }
    if (!database) {
      throw new BackupDecodeError('Missing database chunk');
    }

    return { manifest, database, blobs };
  };

  const key = await deriveKey(password, header.salt, PBKDF2_ITERATIONS);
  return decodeWithKey(key);
}

/**
 * Read just the header from a backup file without decrypting.
 * Useful for quick validation and metadata extraction.
 */
export function readHeader(data: Uint8Array): BackupHeader {
  return parseHeader(data);
}

/**
 * Validate a backup file without fully decoding it.
 * Attempts to decrypt the first chunk to verify the password.
 */
export async function validateBackup(
  data: Uint8Array,
  password: string
): Promise<{ valid: boolean; manifest?: BackupManifest; error?: string }> {
  try {
    const header = parseHeader(data);
    if (data.length <= HEADER_SIZE) {
      return { valid: false, error: 'No chunks in backup' };
    }

    const key = await deriveKey(password, header.salt, PBKDF2_ITERATIONS);
    const chunkHeader = parseChunkHeader(data, HEADER_SIZE);
    const chunkData = await decryptChunk(data, HEADER_SIZE, chunkHeader, key);

    if (chunkHeader.chunkType === ChunkType.MANIFEST) {
      const manifest = parseJsonChunk<BackupManifest>(chunkData);
      return { valid: true, manifest };
    }

    return { valid: true };
  } catch (error) {
    if (error instanceof InvalidPasswordError) {
      return { valid: false, error: 'Invalid password' };
    }
    if (error instanceof BackupDecodeError) {
      return { valid: false, error: error.message };
    }
    return { valid: false, error: 'Unknown error' };
  }
}
