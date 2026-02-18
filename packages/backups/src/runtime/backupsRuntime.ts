export interface BackupManifest {
  createdAt: string;
  platform: string;
  appVersion: string;
  formatVersion: number;
  blobCount: number;
  blobTotalSize: number;
}

export interface BackupProgressEvent {
  phase: string;
  current: number;
  total: number;
  currentItem?: string | undefined;
}

export interface StoredBackup {
  name: string;
  size: number;
  lastModified: number;
}

export interface BackupInfoResult {
  manifest: BackupManifest;
  suggestedName?: string | undefined;
}

export interface RestoreBackupInput {
  backupData: Uint8Array;
  backupPassword: string;
  newInstancePassword: string;
  onProgress?: ((event: BackupProgressEvent) => void) | undefined;
}

export interface BackupsRuntime {
  estimateBackupSize: (
    includeBlobs: boolean
  ) => Promise<{ blobCount: number; blobTotalSize: number }>;
  createBackup: (input: {
    password: string;
    includeBlobs: boolean;
    onProgress?: ((event: BackupProgressEvent) => void) | undefined;
  }) => Promise<{ filename: string; destination: 'storage' | 'download' }>;
  getBackupInfo: (
    backupData: Uint8Array,
    backupPassword: string
  ) => Promise<BackupInfoResult | null>;
  restoreBackup: (
    input: RestoreBackupInput
  ) => Promise<{ instanceName: string }>;
  refreshInstances: () => Promise<void>;
  isBackupStorageSupported: () => boolean;
  listStoredBackups: () => Promise<StoredBackup[]>;
  getBackupStorageUsed: () => Promise<number>;
  readBackupFromStorage: (filename: string) => Promise<Uint8Array>;
  deleteBackupFromStorage: (filename: string) => Promise<void>;
  saveFile: (data: Uint8Array, filename: string) => Promise<void>;
}

let runtime: BackupsRuntime | null = null;

export function configureBackupsRuntime(nextRuntime: BackupsRuntime): void {
  runtime = nextRuntime;
}

export function getBackupsRuntime(): BackupsRuntime {
  if (!runtime) {
    throw new Error(
      'Backups runtime is not configured. Call configureBackupsRuntime() before rendering backups components.'
    );
  }
  return runtime;
}
