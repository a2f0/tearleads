/**
 * Tearleads Backup Utility format (.tbu)
 *
 * Cross-platform encrypted backup format: encoder, decoder,
 * compression, and cryptographic utilities.
 */

export { compress, compressString, decompress, decompressString } from './compression';
export {
  AES_KEY_BITS,
  AUTH_TAG_SIZE,
  CHUNK_HEADER_SIZE,
  FORMAT_VERSION,
  HEADER_SIZE,
  IV_SIZE,
  MAGIC_BYTES,
  MAGIC_SIZE,
  MAX_BLOB_CHUNK_SIZE,
  PBKDF2_ITERATIONS,
  SALT_SIZE
} from './constants';
export {
  decrypt,
  deriveKey,
  encrypt,
  encryptedSize,
  generateIv,
  generateSalt,
  plaintextSize
} from './crypto';
export {
  BackupDecodeError,
  type DecodeResult,
  type DecodedBlob,
  InvalidPasswordError,
  decode,
  readHeader,
  validateBackup
} from './decoder';
export { type EncodeOptions, encode, estimateBackupSize } from './encoder';
export {
  ChunkType,
  type BackupDatabase,
  type BackupHeader,
  type BackupManifest,
  type BackupProgressEvent,
  type BlobEntry,
  type BlobHeader,
  type ChunkHeader,
  type ChunkTypeValue,
  type ImportResult,
  type IndexSchema,
  type TableSchema
} from './types';
