/**
 * Universal Backup Format Types
 *
 * Defines the structure of .tbu backup files that work across
 * all platforms (Web, Electron, iOS, Android, CLI).
 */

export type ChunkTypeValue = 0 | 1 | 2;

/** Chunk types in the backup file */
export const ChunkType: {
  MANIFEST: ChunkTypeValue;
  DATABASE: ChunkTypeValue;
  BLOB: ChunkTypeValue;
} = {
  MANIFEST: 0,
  DATABASE: 1,
  BLOB: 2
};

/** Backup file header (plaintext, 32 bytes) */
export interface BackupHeader {
  /** Magic bytes from file header */
  magic: Uint8Array;
  /** Format version (currently 1) */
  version: number;
  /** Flags for future use */
  flags: number;
  /** Salt for PBKDF2 key derivation */
  salt: Uint8Array;
}

/** Manifest chunk - metadata about the backup */
export interface BackupManifest {
  /** ISO timestamp when backup was created */
  createdAt: string;
  /** Platform that created the backup */
  platform: 'web' | 'electron' | 'ios' | 'android' | 'cli';
  /** App version that created the backup */
  appVersion: string;
  /** Total number of blob chunks */
  blobCount: number;
  /** Total size of all blobs in bytes */
  blobTotalSize: number;
  /** Instance name from source */
  instanceName?: string;
}

/** Database chunk - schema and row data */
export interface BackupDatabase {
  /** Table definitions from sqlite_master */
  tables: TableSchema[];
  /** Index definitions from sqlite_master */
  indexes: IndexSchema[];
  /** Row data keyed by table name */
  data: Record<string, unknown[]>;
}

/** Table schema extracted from sqlite_master */
export interface TableSchema {
  name: string;
  sql: string;
}

/** Index schema extracted from sqlite_master */
export interface IndexSchema {
  name: string;
  tableName: string;
  sql: string;
}

/** Blob entry header (stored before binary data in blob chunks) */
export interface BlobHeader {
  /** Relative path within the blob storage */
  path: string;
  /** MIME type of the blob */
  mimeType: string;
  /** Original size in bytes */
  size: number;
  /** For split blobs: which part this is (0-indexed) */
  partIndex?: number;
  /** For split blobs: total number of parts */
  totalParts?: number;
}

/** Progress event during backup/restore */
export interface BackupProgressEvent {
  /** Current phase of the operation */
  phase: 'preparing' | 'database' | 'blobs' | 'finalizing';
  /** Current item number */
  current: number;
  /** Total items in this phase */
  total: number;
  /** Current item being processed */
  currentItem?: string | undefined;
}

/** Decoded blob data from a backup. */
export interface DecodedBlob {
  header: BlobHeader;
  data: Uint8Array;
}

/** Result of decoding a backup file. */
export interface DecodeResult {
  manifest: BackupManifest;
  database: BackupDatabase;
  blobs: DecodedBlob[];
}

/** Options for decoding a backup file. */
export interface DecodeOptions {
  data: Uint8Array;
  password: string;
  onProgress?: (event: BackupProgressEvent) => void;
}

/** Options for encoding a backup file. */
export interface EncodeOptions {
  password: string;
  manifest: BackupManifest;
  database: BackupDatabase;
  blobs: BlobEntry[];
  readBlob: (path: string) => Promise<Uint8Array>;
  onProgress?: (event: BackupProgressEvent) => void;
}

/** Entry in the blob listing */
export interface BlobEntry {
  path: string;
  mimeType: string;
  size: number;
}
