import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getCurrentInstanceId, getDatabaseAdapter } from '@/db';
import {
  type BackupProgressEvent,
  createBackup,
  estimateBackupSize as estimateSize
} from '@/db/backup';
import { getActiveInstance } from '@/db/instance-registry';
import { getFileStorage, isFileStorageInitialized } from '@/storage/opfs';

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

export function CreateBackupTab() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [includeBlobs, setIncludeBlobs] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estimatedSize, setEstimatedSize] = useState<{
    blobCount: number;
    blobTotalSize: number;
  } | null>(null);

  // Estimate backup size on mount or when includeBlobs changes
  const updateEstimate = useCallback(async () => {
    try {
      const instanceId = getCurrentInstanceId();
      if (!instanceId) return;

      const adapter = getDatabaseAdapter();
      const fileStorage = isFileStorageInitialized(instanceId)
        ? getFileStorage()
        : null;

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
  useState(() => {
    updateEstimate();
  });

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
      setProgress({ phase: 'Starting', percent: 0 });

      const instanceId = getCurrentInstanceId();
      if (!instanceId) {
        throw new Error('No active database instance');
      }

      const adapter = getDatabaseAdapter();
      const fileStorage = isFileStorageInitialized(instanceId)
        ? getFileStorage()
        : null;

      // Get instance name for the backup
      const instance = await getActiveInstance();
      const instanceName = instance?.name ?? 'Unknown';

      const backupData = await createBackup(adapter, fileStorage, {
        password,
        includeBlobs: includeBlobs && fileStorage !== null,
        instanceName,
        onProgress: handleProgressUpdate
      });

      // Create download - wrap in new Uint8Array to ensure proper ArrayBuffer type
      const blob = new Blob([new Uint8Array(backupData).buffer], {
        type: 'application/octet-stream'
      });
      const url = URL.createObjectURL(blob);

      const date = new Date();
      const dateStr = date.toISOString().split('T')[0];
      const filename = `backup-${dateStr}.rbu`;

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setProgress({ phase: 'Complete', percent: 100 });

      // Reset form after short delay
      setTimeout(() => {
        setPassword('');
        setConfirmPassword('');
        setProgress(null);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create backup');
      setProgress(null);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1 font-medium text-sm text-zinc-300">
          Create Encrypted Backup
        </h3>
        <p className="text-xs text-zinc-500">
          Create a backup file that can be restored on any device.
        </p>
      </div>

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

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-red-400 text-sm">
          {error}
        </div>
      )}

      <Button
        onClick={handleCreate}
        disabled={isCreating || !password || !confirmPassword}
        className="w-full"
      >
        {isCreating ? 'Creating Backup...' : 'Create Backup'}
      </Button>
    </div>
  );
}
