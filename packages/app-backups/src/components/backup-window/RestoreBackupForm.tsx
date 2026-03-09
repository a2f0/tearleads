import { Button, Input } from '@tearleads/ui';
import { useCallback, useEffect, useState } from 'react';
import {
  type BackupManifest,
  type BackupProgressEvent,
  getBackupsRuntime
} from '../../runtime/backupsRuntime';

interface BackupProgress {
  phase: string;
  percent: number;
  currentItem?: string | undefined;
}

interface RestoreBackupFormProps {
  backupName: string;
  backupData: Uint8Array;
  onClear?: () => void;
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

export function RestoreBackupForm({
  backupName,
  backupData,
  onClear
}: RestoreBackupFormProps) {
  const runtime = getBackupsRuntime();
  const [backupPassword, setBackupPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [manifest, setManifest] = useState<BackupManifest | null>(null);
  const [suggestedName, setSuggestedName] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setBackupPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setManifest(null);
    setSuggestedName(null);
    setIsValidating(false);
    setIsRestoring(false);
    setProgress(null);
    setError(null);
    setSuccess(null);
  }, []);

  const handleValidate = async () => {
    if (!backupPassword) return;

    setError(null);
    setIsValidating(true);

    try {
      const info = await runtime.getBackupInfo(backupData, backupPassword);

      if (!info) {
        setError('Invalid backup file or incorrect password');
        setManifest(null);
        setSuggestedName(null);
        return;
      }

      setManifest(info.manifest);
      setSuggestedName(info.suggestedName ?? null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to validate backup'
      );
      setManifest(null);
      setSuggestedName(null);
    } finally {
      setIsValidating(false);
    }
  };

  const handleProgressUpdate = useCallback((event: BackupProgressEvent) => {
    const phaseLabels: Record<string, string> = {
      preparing: 'Preparing',
      database: 'Restoring database',
      blobs: 'Restoring files',
      finalizing: 'Finalizing'
    };

    setProgress({
      phase: phaseLabels[event.phase] ?? event.phase,
      percent:
        event.total > 0 ? Math.round((event.current / event.total) * 100) : 0,
      currentItem: event.currentItem
    });
  }, []);

  const handleRestore = async () => {
    if (!backupPassword || !newPassword) return;

    if (newPassword !== confirmNewPassword) {
      setError('New passwords do not match');
      return;
    }

    setError(null);
    setSuccess(null);
    setIsRestoring(true);
    setProgress({ phase: 'Starting', percent: 0 });

    try {
      const result = await runtime.restoreBackup({
        backupData,
        backupPassword,
        newInstancePassword: newPassword,
        onProgress: handleProgressUpdate
      });

      await runtime.refreshInstances();

      setProgress({ phase: 'Complete', percent: 100 });
      setSuccess(
        `Backup restored successfully as "${result.instanceName}". You can now switch to this instance from the instance selector.`
      );

      setTimeout(() => {
        setProgress(null);
        if (onClear) {
          onClear();
        } else {
          setManifest(null);
          setSuggestedName(null);
          setBackupPassword('');
          setNewPassword('');
          setConfirmNewPassword('');
        }
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore backup');
      setProgress(null);
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-muted/40 p-3 text-muted-foreground text-xs">
        Restoring from <span className="text-foreground">{backupName}</span>
      </div>

      {!manifest && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void handleValidate();
          }}
        >
          <div>
            <label
              htmlFor="backup-pwd"
              className="mb-1 block text-muted-foreground text-xs"
            >
              Backup Password
            </label>
            <Input
              id="backup-pwd"
              type="password"
              autoComplete="current-password"
              value={backupPassword}
              onChange={(e) => setBackupPassword(e.target.value)}
              placeholder="Enter the backup's password"
              disabled={isValidating || isRestoring}
            />
          </div>

          <Button
            type="submit"
            disabled={!backupPassword || isValidating}
            className="w-full"
          >
            {isValidating ? 'Validating...' : 'Validate Backup'}
          </Button>
        </form>
      )}

      {manifest && (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleRestore();
          }}
        >
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created:</span>
                <span className="text-foreground">
                  {formatDate(manifest.createdAt)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Platform:</span>
                <span className="text-foreground">{manifest.platform}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Version:</span>
                <span className="text-foreground">{manifest.appVersion}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Format:</span>
                <span className="text-foreground">
                  {manifest.formatVersion}
                </span>
              </div>
              {manifest.blobCount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Files:</span>
                  <span className="text-foreground">
                    {manifest.blobCount} ({formatBytes(manifest.blobTotalSize)})
                  </span>
                </div>
              )}
              {suggestedName && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Will create:</span>
                  <span className="text-foreground">{suggestedName}</span>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label
                htmlFor="new-pwd"
                className="mb-1 block text-muted-foreground text-xs"
              >
                New Instance Password
              </label>
              <Input
                id="new-pwd"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Password for restored instance"
                disabled={isRestoring}
              />
            </div>

            <div>
              <label
                htmlFor="confirm-new-pwd"
                className="mb-1 block text-muted-foreground text-xs"
              >
                Confirm Password
              </label>
              <Input
                id="confirm-new-pwd"
                type="password"
                autoComplete="new-password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                placeholder="Confirm password"
                disabled={isRestoring}
              />
            </div>
          </div>

          {progress && (
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <div className="mb-2 flex justify-between text-xs">
                <span className="text-foreground">{progress.phase}</span>
                <span className="text-muted-foreground">
                  {progress.percent}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              {progress.currentItem && (
                <p className="mt-1 truncate text-muted-foreground text-xs">
                  {progress.currentItem}
                </p>
              )}
            </div>
          )}

          <Button
            type="submit"
            disabled={isRestoring || !newPassword || !confirmNewPassword}
            className="w-full"
          >
            {isRestoring ? 'Restoring...' : 'Restore Backup'}
          </Button>
        </form>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-destructive text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-md border border-success/40 bg-success/10 p-2 text-sm text-success">
          {success}
        </div>
      )}
    </div>
  );
}
