import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WINDOW_TABLE_TYPOGRAPHY, WindowTableRow } from '@rapid/window-manager';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getCurrentInstanceId, getDatabaseAdapter } from '@/db';
import {
  type BackupProgressEvent,
  createBackup,
  estimateBackupSize as estimateSize
} from '@/db/backup';
import { getKeyManager } from '@/db/crypto';
import { getActiveInstance } from '@/db/instance-registry';
import { saveFile } from '@/lib/file-utils';
import {
  deleteBackupFromStorage,
  getBackupStorageUsed,
  isBackupStorageSupported,
  listStoredBackups,
  readBackupFromStorage,
  saveBackupToStorage
} from '@/storage/backup-storage';
import {
  type FileStorage,
  getFileStorageForInstance,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';
import { RestoreBackupForm } from './RestoreBackupForm';

interface BackupProgress {
  phase: string;
  percent: number;
  currentItem?: string | undefined;
}

interface BackupListItem {
  name: string;
  size: number;
  lastModified: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

function formatBackupFilename(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `rapid-backup-${year}-${month}-${day}-${hours}${minutes}${seconds}.rbu`;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

async function getOrInitFileStorage(
  instanceId: string
): Promise<FileStorage | null> {
  if (isFileStorageInitialized(instanceId)) {
    return getFileStorageForInstance(instanceId);
  }
  const keyManager = getKeyManager();
  const encryptionKey = keyManager.getCurrentKey();
  if (!encryptionKey) return null;
  return initializeFileStorage(encryptionKey, instanceId);
}

export function BackupManagerView() {
  // Create backup state
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [includeBlobs, setIncludeBlobs] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState<BackupProgress | null>(
    null
  );
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [isStorageSupported] = useState(() => isBackupStorageSupported());
  const [estimatedSize, setEstimatedSize] = useState<{
    blobCount: number;
    blobTotalSize: number;
  } | null>(null);
  const isMountedRef = useRef(true);

  // Stored backups state
  const [backups, setBackups] = useState<BackupListItem[]>([]);
  const [storageUsed, setStorageUsed] = useState<number | null>(null);
  const [storedError, setStoredError] = useState<string | null>(null);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);

  // Restore state
  const [selectedBackup, setSelectedBackup] = useState<BackupListItem | null>(
    null
  );
  const [selectedBackupData, setSelectedBackupData] =
    useState<Uint8Array | null>(null);
  const [externalFile, setExternalFile] = useState<File | null>(null);
  const [externalFileData, setExternalFileData] = useState<Uint8Array | null>(
    null
  );
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Estimate backup size
  const updateEstimate = useCallback(async () => {
    try {
      const instanceId = getCurrentInstanceId();
      if (!instanceId) return;

      const adapter = getDatabaseAdapter();
      const fileStorage = await getOrInitFileStorage(instanceId);

      const estimate = await estimateSize(adapter, fileStorage, includeBlobs);
      setEstimatedSize({
        blobCount: estimate.blobCount,
        blobTotalSize: estimate.blobTotalSize
      });
    } catch {
      // Ignore estimation errors
    }
  }, [includeBlobs]);

  useEffect(() => {
    void updateEstimate();
  }, [updateEstimate]);

  // Load stored backups
  const loadBackups = useCallback(async () => {
    if (!isStorageSupported) return;
    setIsLoadingBackups(true);
    setStoredError(null);
    try {
      const items = await listStoredBackups();
      setBackups(items);
      setStorageUsed(await getBackupStorageUsed());
    } catch (err) {
      setStoredError(
        err instanceof Error ? err.message : 'Failed to load backups'
      );
    } finally {
      setIsLoadingBackups(false);
    }
  }, [isStorageSupported]);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  const handleProgressUpdate = useCallback((event: BackupProgressEvent) => {
    const phaseLabels: Record<string, string> = {
      preparing: 'Preparing',
      database: 'Backing up database',
      blobs: 'Backing up files',
      finalizing: 'Finalizing'
    };

    setCreateProgress({
      phase: phaseLabels[event.phase] ?? event.phase,
      percent:
        event.total > 0 ? Math.round((event.current / event.total) * 100) : 0,
      currentItem: event.currentItem
    });
  }, []);

  const handleCreate = async () => {
    setCreateError(null);
    setCreateSuccess(null);

    if (!password) {
      setCreateError('Please enter a password');
      return;
    }

    if (password !== confirmPassword) {
      setCreateError('Passwords do not match');
      return;
    }

    try {
      setIsCreating(true);
      setCreateProgress(null);

      const instanceId = getCurrentInstanceId();
      if (!instanceId) {
        throw new Error('No active database instance');
      }

      const adapter = getDatabaseAdapter();
      const fileStorage = await getOrInitFileStorage(instanceId);

      const instance = await getActiveInstance();
      const instanceName = instance?.name ?? 'Unknown';

      const backupData = await createBackup(adapter, fileStorage, {
        password,
        includeBlobs: includeBlobs && fileStorage !== null,
        instanceName,
        onProgress: handleProgressUpdate
      });

      const filename = formatBackupFilename(new Date());

      if (isStorageSupported) {
        await saveBackupToStorage(backupData, filename);
        setCreateSuccess(`Backup saved as "${filename}".`);
        await loadBackups();
      } else {
        await saveFile(backupData, filename);
        setCreateSuccess(`Backup downloaded as "${filename}".`);
      }

      setCreateProgress({ phase: 'Complete', percent: 100 });

      setTimeout(() => {
        if (isMountedRef.current) {
          setPassword('');
          setConfirmPassword('');
          setCreateProgress(null);
          setCreateSuccess(null);
        }
      }, 2000);
    } catch (err) {
      if (isMountedRef.current) {
        setCreateError(
          err instanceof Error ? err.message : 'Failed to create backup'
        );
        setCreateProgress(null);
      }
    } finally {
      if (isMountedRef.current) {
        setIsCreating(false);
      }
    }
  };

  const handleRestoreStored = useCallback(async (backup: BackupListItem) => {
    setStoredError(null);
    try {
      const data = await readBackupFromStorage(backup.name);
      setSelectedBackup(backup);
      setSelectedBackupData(data);
      setExternalFile(null);
      setExternalFileData(null);
    } catch (err) {
      setStoredError(
        err instanceof Error ? err.message : 'Failed to read backup'
      );
    }
  }, []);

  const handleDelete = useCallback(
    async (backup: BackupListItem) => {
      setStoredError(null);
      try {
        await deleteBackupFromStorage(backup.name);
        if (selectedBackup?.name === backup.name) {
          setSelectedBackup(null);
          setSelectedBackupData(null);
        }
        await loadBackups();
      } catch (err) {
        setStoredError(
          err instanceof Error ? err.message : 'Failed to delete backup'
        );
      }
    },
    [loadBackups, selectedBackup]
  );

  const handleDownload = useCallback(async (backup: BackupListItem) => {
    setStoredError(null);
    try {
      const data = await readBackupFromStorage(backup.name);
      await saveFile(data, backup.name);
    } catch (err) {
      setStoredError(
        err instanceof Error ? err.message : 'Failed to download backup'
      );
    }
  }, []);

  const handleFileSelect = useCallback(async (file: File) => {
    setRestoreError(null);
    setExternalFile(file);
    setSelectedBackup(null);
    setSelectedBackupData(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      setExternalFileData(new Uint8Array(arrayBuffer));
    } catch {
      setRestoreError('Failed to read backup file');
    }
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        void handleFileSelect(file);
      }
    },
    [handleFileSelect]
  );

  const handleSelectFile = () => {
    fileInputRef.current?.click();
  };

  const clearRestore = useCallback(() => {
    setSelectedBackup(null);
    setSelectedBackupData(null);
    setExternalFile(null);
    setExternalFileData(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const storageSummary = useMemo(() => {
    if (storageUsed === null) return null;
    return `${formatBytes(storageUsed)} used`;
  }, [storageUsed]);

  const isRestoring = selectedBackup !== null || externalFile !== null;

  return (
    <div className="space-y-6">
      {/* Create Backup Section */}
      <section>
        <h3 className="mb-2 font-medium text-sm text-zinc-300">
          Create Backup
        </h3>
        <form
          className="space-y-3 rounded-md border border-zinc-800 bg-zinc-900/30 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreate();
          }}
        >
          {!isCreating && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="backup-password"
                    className="mb-1 block text-xs text-zinc-400"
                  >
                    Password
                  </label>
                  <Input
                    id="backup-password"
                    data-testid="backup-password-input"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Backup password"
                    disabled={isCreating}
                  />
                </div>
                <div>
                  <label
                    htmlFor="confirm-password"
                    className="mb-1 block text-xs text-zinc-400"
                  >
                    Confirm
                  </label>
                  <Input
                    id="confirm-password"
                    data-testid="backup-confirm-password-input"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    disabled={isCreating}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    data-testid="backup-include-blobs"
                    checked={includeBlobs}
                    onChange={(e) => setIncludeBlobs(e.target.checked)}
                    disabled={isCreating}
                    className="h-4 w-4 rounded border-zinc-600 bg-zinc-800"
                  />
                  <span className="text-xs text-zinc-300">
                    Include files
                    {estimatedSize && estimatedSize.blobCount > 0 && (
                      <span className="ml-1 text-zinc-500">
                        ({estimatedSize.blobCount},{' '}
                        {formatBytes(estimatedSize.blobTotalSize)})
                      </span>
                    )}
                  </span>
                </label>
                <Button
                  type="submit"
                  size="sm"
                  data-testid="backup-create-button"
                  disabled={!password || !confirmPassword}
                >
                  Create Backup
                </Button>
              </div>
            </>
          )}

          {isCreating && !createProgress && (
            <div className="text-sm text-zinc-300">Starting backup...</div>
          )}

          {createProgress && (
            <div>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-zinc-300">{createProgress.phase}</span>
                <span className="text-zinc-500">{createProgress.percent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-700">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${createProgress.percent}%` }}
                />
              </div>
              {createProgress.currentItem && (
                <p className="mt-1 truncate text-xs text-zinc-500">
                  {createProgress.currentItem}
                </p>
              )}
            </div>
          )}

          {createSuccess && (
            <div
              data-testid="backup-success"
              className="rounded border border-green-500/30 bg-green-500/10 p-2 text-green-400 text-xs"
            >
              {createSuccess}
            </div>
          )}

          {createError && (
            <div
              data-testid="backup-error"
              className="rounded border border-red-500/30 bg-red-500/10 p-2 text-red-400 text-xs"
            >
              {createError}
            </div>
          )}
        </form>
      </section>

      {/* Stored Backups Section */}
      {isStorageSupported && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-medium text-sm text-zinc-300">
              Stored Backups
            </h3>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              {storageSummary && <span>{storageSummary}</span>}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void loadBackups()}
                disabled={isLoadingBackups}
                className="h-6 px-2 text-xs"
              >
                {isLoadingBackups ? '...' : 'Refresh'}
              </Button>
            </div>
          </div>

          {backups.length === 0 && !isLoadingBackups && (
            <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-3 text-xs text-zinc-500">
              No stored backups yet.
            </div>
          )}

          {backups.length > 0 && (
            <div className="overflow-hidden rounded-md border border-zinc-800">
              <table className={WINDOW_TABLE_TYPOGRAPHY.table}>
                <thead className="bg-zinc-900/60 text-zinc-500">
                  <tr>
                    <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>Name</th>
                    <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>Size</th>
                    <th
                      className={`${WINDOW_TABLE_TYPOGRAPHY.headerCell} text-right`}
                    >
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((backup) => (
                    <WindowTableRow
                      key={backup.name}
                      className="cursor-default border-zinc-800 border-t hover:bg-zinc-900/40"
                    >
                      <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                        <div className="text-zinc-200">{backup.name}</div>
                        <div className="text-zinc-500">
                          {formatDate(backup.lastModified)}
                        </div>
                      </td>
                      <td className={`${WINDOW_TABLE_TYPOGRAPHY.cell} text-zinc-500`}>
                        {formatBytes(backup.size)}
                      </td>
                      <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => void handleRestoreStored(backup)}
                          >
                            Restore
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => void handleDownload(backup)}
                          >
                            Download
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => void handleDelete(backup)}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </WindowTableRow>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {storedError && (
            <div className="mt-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-red-400 text-xs">
              {storedError}
            </div>
          )}
        </section>
      )}

      {/* Restore from File Section */}
      <section>
        <h3 className="mb-2 font-medium text-sm text-zinc-300">
          Restore from File
        </h3>
        <input
          ref={fileInputRef}
          type="file"
          accept=".rbu"
          onChange={handleFileInputChange}
          className="hidden"
        />
        {!isRestoring && (
          <Button
            variant="secondary"
            onClick={handleSelectFile}
            className="w-full"
          >
            Select Backup File (.rbu)
          </Button>
        )}

        {restoreError && (
          <div className="mt-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-red-400 text-xs">
            {restoreError}
          </div>
        )}
      </section>

      {/* Restore Form (shown when backup selected) */}
      {selectedBackup && selectedBackupData && (
        <section>
          <RestoreBackupForm
            key={selectedBackup.name}
            backupName={selectedBackup.name}
            backupData={selectedBackupData}
            onClear={clearRestore}
          />
        </section>
      )}

      {externalFile && externalFileData && (
        <section>
          <RestoreBackupForm
            key={externalFile.name}
            backupName={externalFile.name}
            backupData={externalFileData}
            onClear={clearRestore}
          />
        </section>
      )}
    </div>
  );
}
