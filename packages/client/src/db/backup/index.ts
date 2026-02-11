/**
 * Universal Backup Format (.rbu)
 *
 * Cross-platform encrypted backup system for Tearleads databases.
 *
 * Features:
 * - Works on Web, Electron, iOS, and Android
 * - User-defined encryption (PBKDF2 + AES-256-GCM)
 * - Includes database schemas, data, and blob files
 * - Compressed using gzip
 * - Supports large files via chunking
 */

export {
  compress,
  compressString,
  decompress,
  decompressString
} from './compression';
export * from './constants';
export {
  decrypt,
  deriveKey,
  encrypt,
  encryptedSize,
  generateIv,
  generateSalt,
  plaintextSize
} from './crypto';
export type { DecodedBlob, DecodeOptions, DecodeResult } from './decoder';
export {
  BackupDecodeError,
  decode,
  InvalidPasswordError,
  readHeader,
  validateBackup
} from './decoder';
export type { EncodeOptions } from './encoder';
export { encode, estimateBackupSize as estimateEncodedSize } from './encoder';
export type { CreateBackupOptions } from './exporter';
export { createBackup, estimateBackupSize } from './exporter';
export type { RestoreBackupOptions } from './importer';
export {
  getBackupInfo,
  restoreBackup,
  validateBackupFile
} from './importer';
export * from './types';
