import { Button } from '@client/components/ui/button';
import { getCurrentInstanceId, getDatabaseAdapter } from '@client/db';
import {
  type BackupProgressEvent,
  createBackup,
  estimateBackupSize as estimateSize
} from '@client/db/backup';
import { getActiveInstance } from '@client/db/instanceRegistry';
import { saveFile } from '@client/lib/fileUtils';
import {
  deleteBackupFromStorage,
  getBackupStorageUsed,
  isBackupStorageSupported,
  listStoredBackups,
  readBackupFromStorage,
  saveBackupToStorage
} from '@client/storage/backupStorage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CreateBackupSection } from './CreateBackupSection';
import { StoredBackupsSection } from './StoredBackupsSection';
import { RestoreBackupForm } from '../RestoreBackupForm';
import {
  BackupListItem,
  BackupProgress,
  formatBackupFilename,
  formatBytes,
  formatDate,
  getOrInitFileStorage
} from './utils';

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
      <CreateBackupSection
        password={password}
        confirmPassword={confirmPassword}
        includeBlobs={includeBlobs}
        isCreating={isCreating}
        createProgress={createProgress}
        createSuccess={createSuccess}
        createError={createError}
        estimatedSize={estimatedSize}
        onPasswordChange={setPassword}
        onConfirmPasswordChange={setConfirmPassword}
        onIncludeBlobsChange={setIncludeBlobs}
        onCreate={handleCreate}
      />

      {isStorageSupported && (
        <StoredBackupsSection
          backups={backups}
          isLoadingBackups={isLoadingBackups}
          storedError={storedError}
          storageSummary={storageSummary}
          loadBackups={loadBackups}
          handleRestoreStored={handleRestoreStored}
          handleDownload={handleDownload}
          handleDelete={handleDelete}
        />
      )}

      {/* Restore from File Section */}
      <section>
        <h3 className="mb-2 font-medium text-foreground text-sm">
          Restore from File
        </h3>
        <input
          ref={fileInputRef}
          type="file"
          accept=".tbu"
          onChange={handleFileInputChange}
          className="hidden"
        />
        {!isRestoring && (
          <Button
            variant="secondary"
            onClick={handleSelectFile}
            className="w-full"
          >
            Select Backup File (.tbu)
          </Button>
        )}

        {restoreError && (
          <div className="mt-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-destructive text-xs">
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
