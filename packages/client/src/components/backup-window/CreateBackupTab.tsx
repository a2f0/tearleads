import { useCallback, useEffect, useRef, useState } from 'react';

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
  isBackupStorageSupported,
  saveBackupToStorage
} from '@/storage/backup-storage';
import {
  type FileStorage,
  getFileStorageForInstance,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';

interface BackupProgress {
  phase: string;
  percent: number;
  currentItem?: string | undefined;
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

interface CreateBackupTabProps {
  onSuccess?: ((options: { stored: boolean }) => void) | undefined;
}

export function CreateBackupTab({ onSuccess }: CreateBackupTabProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [includeBlobs, setIncludeBlobs] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isStorageSupported] = useState(() => isBackupStorageSupported());
  const [estimatedSize, setEstimatedSize] = useState<{
    blobCount: number;
    blobTotalSize: number;
  } | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Estimate backup size on mount or when includeBlobs changes
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

  // Update estimate when component mounts
  useEffect(() => {
    updateEstimate();
  }, [updateEstimate]);

  const handleProgressUpdate = useCallback((event: BackupProgressEvent) => {
    const phaseLabels: Record<string, string> = {
      preparing: 'Preparing',
      database: 'Backing up database',
      blobs: 'Backing up files',
      finalizing: 'Finalizing'
    };

    setProgress({
      phase: phaseLabels[event.phase] ?? event.phase,
      percent:
        event.total > 0 ? Math.round((event.current / event.total) * 100) : 0,
      currentItem: event.currentItem
    });
  }, []);

  const handleCreate = async () => {
    setError(null);
    setSuccess(null);

    if (!password) {
      setError('Please enter a password');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    try {
      setIsCreating(true);
      setProgress(null);

      const instanceId = getCurrentInstanceId();
      if (!instanceId) {
        throw new Error('No active database instance');
      }

      const adapter = getDatabaseAdapter();
      const fileStorage = await getOrInitFileStorage(instanceId);

      // Get instance name for the backup
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
        setSuccess(`Backup saved to local storage as "${filename}".`);
      } else {
        await saveFile(backupData, filename);
        setSuccess(`Backup downloaded as "${filename}".`);
      }

      setProgress({ phase: 'Complete', percent: 100 });
      onSuccess?.({ stored: isStorageSupported });

      // Reset form after short delay
      setTimeout(() => {
        if (isMountedRef.current) {
          setPassword('');
          setConfirmPassword('');
          setProgress(null);
          setSuccess(null);
        }
      }, 2000);
    } catch (err) {
      if (isMountedRef.current) {
        setError(
          err instanceof Error ? err.message : 'Failed to create backup'
        );
        setProgress(null);
      }
    } finally {
      if (isMountedRef.current) {
        setIsCreating(false);
      }
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void handleCreate();
      }}
    >
      <div>
        <h3 className="mb-1 font-medium text-sm text-zinc-300">
          Create Encrypted Backup
        </h3>
        <p className="text-xs text-zinc-500">
          Create a backup file that can be restored on any device.
        </p>
        {!isStorageSupported && (
          <p className="mt-1 text-xs text-zinc-500">
            Local backup storage is not supported on this platform. Backups will
            be downloaded instead.
          </p>
        )}
      </div>

      {!isCreating && (
        <div className="space-y-3">
          <div>
            <label
              htmlFor="backup-password"
              className="mb-1 block text-xs text-zinc-400"
            >
              Backup Password
            </label>
            <Input
              id="backup-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter backup password"
              disabled={isCreating}
            />
          </div>

          <div>
            <label
              htmlFor="confirm-password"
              className="mb-1 block text-xs text-zinc-400"
            >
              Confirm Password
            </label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm password"
              disabled={isCreating}
            />
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeBlobs}
              onChange={(e) => setIncludeBlobs(e.target.checked)}
              disabled={isCreating}
              className="h-4 w-4 rounded border-zinc-600 bg-zinc-800"
            />
            <span className="text-sm text-zinc-300">
              Include file attachments
              {estimatedSize && estimatedSize.blobCount > 0 && (
                <span className="ml-1 text-zinc-500">
                  ({estimatedSize.blobCount} files,{' '}
                  {formatBytes(estimatedSize.blobTotalSize)})
                </span>
              )}
            </span>
          </label>
        </div>
      )}

      {isCreating && !progress && (
        <div className="rounded-md border border-zinc-700 bg-zinc-800/50 p-3 text-sm text-zinc-300">
          Starting backup...
        </div>
      )}

      {progress && (
        <div className="rounded-md border border-zinc-700 bg-zinc-800/50 p-3">
          <div className="mb-2 flex justify-between text-xs">
            <span className="text-zinc-300">{progress.phase}</span>
            <span className="text-zinc-500">{progress.percent}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-700">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          {progress.currentItem && (
            <p className="mt-1 truncate text-xs text-zinc-500">
              {progress.currentItem}
            </p>
          )}
        </div>
      )}

      {success && (
        <div className="rounded-md border border-green-500/30 bg-green-500/10 p-2 text-green-400 text-sm">
          {success}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-red-400 text-sm">
          {error}
        </div>
      )}

      {!isCreating && (
        <Button
          type="submit"
          disabled={!password || !confirmPassword}
          className="w-full"
        >
          Create Backup
        </Button>
      )}
    </form>
  );
}
