import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { saveFile } from '@/lib/file-utils';
import {
  deleteBackupFromStorage,
  getBackupStorageUsed,
  isBackupStorageSupported,
  listStoredBackups,
  readBackupFromStorage
} from '@/storage/backup-storage';
import { RestoreBackupForm } from './RestoreBackupForm';

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

export function StoredBackupsTab() {
  const [backups, setBackups] = useState<BackupListItem[]>([]);
  const [selectedBackup, setSelectedBackup] = useState<BackupListItem | null>(
    null
  );
  const [selectedData, setSelectedData] = useState<Uint8Array | null>(null);
  const [storageUsed, setStorageUsed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSupported] = useState(() => isBackupStorageSupported());

  const loadBackups = useCallback(async () => {
    if (!isSupported) return;
    setIsLoading(true);
    setError(null);
    try {
      const items = await listStoredBackups();
      setBackups(items);
      setStorageUsed(await getBackupStorageUsed());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load backups');
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  const handleRestore = useCallback(async (backup: BackupListItem) => {
    setError(null);
    try {
      const data = await readBackupFromStorage(backup.name);
      setSelectedBackup(backup);
      setSelectedData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read backup');
    }
  }, []);

  const handleDelete = useCallback(
    async (backup: BackupListItem) => {
      setError(null);
      try {
        await deleteBackupFromStorage(backup.name);
        if (selectedBackup?.name === backup.name) {
          setSelectedBackup(null);
          setSelectedData(null);
        }
        await loadBackups();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to delete backup'
        );
      }
    },
    [loadBackups, selectedBackup]
  );

  const handleDownload = useCallback(async (backup: BackupListItem) => {
    setError(null);
    try {
      const data = await readBackupFromStorage(backup.name);
      await saveFile(data, backup.name);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to download backup'
      );
    }
  }, []);

  const storageSummary = useMemo(() => {
    if (storageUsed === null) return null;
    return `${formatBytes(storageUsed)} used`;
  }, [storageUsed]);

  if (!isSupported) {
    return (
      <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3 text-sm text-zinc-400">
        Local backup storage is only available on platforms that support OPFS.
        You can still restore backups by uploading a file in the Restore tab.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1 font-medium text-sm text-zinc-300">
          Stored Backups
        </h3>
        <p className="text-xs text-zinc-500">
          Backups stored locally in OPFS. Restore directly without uploading.
        </p>
      </div>

      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>{storageSummary}</span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void loadBackups()}
          disabled={isLoading}
        >
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {backups.length === 0 && !isLoading && (
        <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3 text-sm text-zinc-400">
          No stored backups yet. Create one from the Create tab.
        </div>
      )}

      {backups.length > 0 && (
        <div className="space-y-2">
          {backups.map((backup) => (
            <div
              key={backup.name}
              className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-zinc-200">
                    {backup.name}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {formatBytes(backup.size)} ·{' '}
                    {formatDate(backup.lastModified)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleRestore(backup)}
                  >
                    Restore
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleDownload(backup)}
                  >
                    Download
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => void handleDelete(backup)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedBackup && selectedData && (
        <RestoreBackupForm
          key={selectedBackup.name}
          backupName={selectedBackup.name}
          backupData={selectedData}
          onClear={() => {
            setSelectedBackup(null);
            setSelectedData(null);
          }}
        />
      )}

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-red-400 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
