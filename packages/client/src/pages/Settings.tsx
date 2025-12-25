import { useTheme } from '@rapid/ui';
import { AlertTriangle, Download } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dropzone } from '@/components/ui/dropzone';
import { useDatabaseContext } from '@/db/hooks';
import { useAppVersion } from '@/hooks/useAppVersion';
import {
  generateBackupFilename,
  readFileAsUint8Array,
  saveFile
} from '@/lib/file-utils';
import { cn } from '@/lib/utils';

export function Settings() {
  const { resolvedTheme, setTheme } = useTheme();
  const { exportDatabase, importDatabase, lock } = useDatabaseContext();
  const isDark = resolvedTheme === 'dark';
  const version = useAppVersion();

  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [pendingRestoreFile, setPendingRestoreFile] = useState<File | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const handleToggle = () => {
    setTheme(isDark ? 'light' : 'dark');
  };

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    setError(null);
    try {
      const data = await exportDatabase();
      const filename = generateBackupFilename();
      await saveFile(data, filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  }, [exportDatabase]);

  const handleFilesSelected = useCallback((files: File[]) => {
    const file = files[0];
    if (!file) return;

    // Validate file extension
    if (!file.name.endsWith('.db')) {
      setError('Please select a .db backup file');
      return;
    }

    setPendingRestoreFile(file);
    setShowRestoreConfirm(true);
    setError(null);
  }, []);

  const handleConfirmRestore = useCallback(async () => {
    if (!pendingRestoreFile) return;

    setIsImporting(true);
    setShowRestoreConfirm(false);
    setError(null);

    try {
      const data = await readFileAsUint8Array(pendingRestoreFile);
      await importDatabase(data);
      // Lock the database - user needs to re-enter password
      await lock();
      // Navigation to unlock screen will happen automatically
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed');
    } finally {
      setIsImporting(false);
      setPendingRestoreFile(null);
    }
  }, [pendingRestoreFile, importDatabase, lock]);

  const handleCancelRestore = useCallback(() => {
    setShowRestoreConfirm(false);
    setPendingRestoreFile(null);
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

      <div className="flex items-center justify-between rounded-lg border p-4">
        <div>
          <p className="font-medium">Dark Mode</p>
          <p className="text-sm text-muted-foreground">
            Toggle dark mode on or off
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isDark}
          aria-label="Toggle dark mode"
          data-testid="dark-mode-switch"
          onClick={handleToggle}
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            isDark ? 'bg-primary' : 'bg-input'
          )}
        >
          <span
            className={cn(
              'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow-lg ring-0 transition duration-200 ease-in-out',
              isDark ? 'translate-x-5' : 'translate-x-0'
            )}
          />
        </button>
      </div>

      {/* Backup & Restore Section */}
      <div className="space-y-4 rounded-lg border p-4">
        <div>
          <p className="font-medium">Backup & Restore</p>
          <p className="text-sm text-muted-foreground">
            Export your encrypted database or restore from a backup
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Export Button */}
        <Button
          onClick={handleExport}
          disabled={isExporting || isImporting}
          variant="outline"
          className="w-full"
          data-testid="backup-export-button"
        >
          <Download className="mr-2 h-4 w-4" />
          {isExporting ? 'Exporting...' : 'Create Backup'}
        </Button>

        {/* Restore Dropzone */}
        {!showRestoreConfirm && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Restore from Backup</p>
            <Dropzone
              onFilesSelected={handleFilesSelected}
              accept=".db"
              multiple={false}
              className={isImporting ? 'pointer-events-none opacity-50' : ''}
            />
          </div>
        )}

        {/* Restore Confirmation */}
        {showRestoreConfirm && (
          <div className="space-y-4 rounded-md border border-destructive/50 bg-destructive/5 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-destructive">
                  Warning: This will replace your current data
                </p>
                <p className="text-sm text-muted-foreground">
                  Restoring from &quot;{pendingRestoreFile?.name}&quot; will
                  overwrite all existing data. This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleConfirmRestore}
                variant="destructive"
                disabled={isImporting}
                data-testid="backup-restore-confirm"
              >
                {isImporting ? 'Restoring...' : 'Restore'}
              </Button>
              <Button
                onClick={handleCancelRestore}
                variant="outline"
                disabled={isImporting}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="text-center">
        <p
          className="text-xs text-muted-foreground/70"
          data-testid="app-version"
        >
          v{version ?? 'unknown'}
        </p>
      </div>
    </div>
  );
}
