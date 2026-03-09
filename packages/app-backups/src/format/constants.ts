/**
 * Constants for the Tearleads Backup Utility format (.tbu)
 */

/** Magic bytes identifying a valid .tbu file: "TEARLEADSBAK" */
export const MAGIC_BYTES = new Uint8Array([
  0x54, 0x45, 0x41, 0x52, 0x4c, 0x45, 0x41, 0x44, 0x53, 0x42, 0x41, 0x4b
]);

/** Current format version */
export const FORMAT_VERSION = 1;

/** Total header size in bytes */
export const HEADER_SIZE = 36;

/** Size of the magic bytes */
export const MAGIC_SIZE = 12;

/** Size of the salt for PBKDF2 */
export const SALT_SIZE = 16;

/** Size of the IV for AES-GCM */
export const IV_SIZE = 12;

/** Size of the GCM authentication tag (included in ciphertext) */
export const AUTH_TAG_SIZE = 16;

/** Chunk header size: 4 (length) + 1 (type) + 3 (reserved) + 12 (IV) = 20 bytes */
export const CHUNK_HEADER_SIZE = 20;

/** PBKDF2 iterations for key derivation */
export const PBKDF2_ITERATIONS: number = 600_000;

/** AES key size in bits */
export const AES_KEY_BITS = 256;

/** Maximum blob size before splitting into multiple chunks (10 MB) */
export const MAX_BLOB_CHUNK_SIZE = 10 * 1024 * 1024;
