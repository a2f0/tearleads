/**
 * Universal Backup Format Types
 *
 * Defines the structure of .rbu backup files that work across
 * all platforms (Web, Electron, iOS, Android).
 */

/** Chunk types in the backup file */
export const ChunkType = {
  MANIFEST: 0,
  DATABASE: 1,
  BLOB: 2
} as const;

export type ChunkTypeValue = (typeof ChunkType)[keyof typeof ChunkType];

/** Backup file header (plaintext, 32 bytes) */
export interface BackupHeader {
  /** Magic bytes: "RAPIDBAK" */
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
  platform: 'web' | 'electron' | 'ios' | 'android';
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

/** Chunk header structure (20 bytes) */
export interface ChunkHeader {
  /** Length of the encrypted payload */
  payloadLength: number;
  /** Type of chunk (manifest, database, blob) */
  chunkType: ChunkTypeValue;
  /** Reserved bytes for future use */
  reserved: Uint8Array;
  /** Initialization vector for AES-GCM */
  iv: Uint8Array;
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

/** Result of a successful import */
export interface ImportResult {
  /** ID of the newly created instance */
  instanceId: string;
  /** Name of the new instance */
  instanceName: string;
  /** Manifest from the backup */
  manifest: BackupManifest;
}

/** Blob provider interface for platform-specific blob access */
export interface BlobProvider {
  /** List all blobs in storage */
  listBlobs(): Promise<BlobEntry[]>;
  /** Read a blob by path */
  readBlob(path: string): Promise<Uint8Array>;
  /** Write a blob to storage */
  writeBlob(path: string, data: Uint8Array, mimeType: string): Promise<void>;
  /** Delete a blob */
  deleteBlob(path: string): Promise<void>;
}

/** Entry in the blob listing */
export interface BlobEntry {
  /** Relative path */
  path: string;
  /** MIME type */
  mimeType: string;
  /** Size in bytes */
  size: number;
}
