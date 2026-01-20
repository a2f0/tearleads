import { AlertTriangle, ChevronRight, Download, Scale } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FontSelector,
  IconDepthToggle,
  PatternSelector,
  SettingsSection,
  ThemeSelector,
  TooltipsToggle
} from '@/components/settings';
import { LanguageSelector } from '@/components/settings/LanguageSelector';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { Dropzone } from '@/components/ui/dropzone';
import { useDatabaseContext } from '@/db/hooks';
import { useAppVersion } from '@/hooks/useAppVersion';
import { useFontEffect } from '@/hooks/useFontEffect';
import {
  generateBackupFilename,
  readFileAsUint8Array,
  saveFile
} from '@/lib/file-utils';

interface SettingsProps {
  showBackLink?: boolean;
}

export function Settings({ showBackLink = true }: SettingsProps) {
  const { exportDatabase, importDatabase, lock } = useDatabaseContext();
  const version = useAppVersion();
  useFontEffect();

  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [pendingRestoreFile, setPendingRestoreFile] = useState<File | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const handleExport = useCallback(() => {
    setIsExporting(true);
    setError(null);

    void (async () => {
      try {
        const data = await exportDatabase();
        const filename = generateBackupFilename();
        await saveFile(data, filename);
      } catch (err) {
        console.error('Export failed:', err);
        setError(err instanceof Error ? err.message : 'Export failed');
      } finally {
        setIsExporting(false);
      }
    })();
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
      console.error('Restore failed:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Restore failed. The file may be corrupt or invalid.'
      );
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
      <div className="space-y-2">
        {showBackLink && <BackLink defaultTo="/" defaultLabel="Back to Home" />}
        <h1 className="font-bold text-2xl tracking-tight">Settings</h1>
      </div>

      <SettingsSection>
        <ThemeSelector />
      </SettingsSection>

      <SettingsSection>
        <PatternSelector />
      </SettingsSection>

      <SettingsSection>
        <IconDepthToggle />
      </SettingsSection>

      <SettingsSection>
        <LanguageSelector />
      </SettingsSection>

      <SettingsSection>
        <FontSelector />
      </SettingsSection>

      <SettingsSection>
        <TooltipsToggle />
      </SettingsSection>

      {/* Backup & Restore Section */}
      <SettingsSection className="space-y-4">
        <div>
          <p className="font-medium">Backup & Restore</p>
          <p className="text-muted-foreground text-sm">
            Export your encrypted database or restore from a backup
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-destructive text-sm">
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
            <p className="font-medium text-sm">Restore from Backup</p>
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
                <p className="text-muted-foreground text-sm">
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
      </SettingsSection>

      {/* Open Source Licenses Section */}
      <Link
        to="/licenses"
        className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
        data-testid="open-source-licenses-link"
      >
        <div className="flex items-center gap-3">
          <Scale className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="font-medium">Open Source Licenses</p>
            <p className="text-muted-foreground text-sm">
              View licenses for third-party software
            </p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </Link>

      <div className="text-center">
        <p
          className="text-muted-foreground/70 text-xs"
          data-testid="app-version"
        >
          v{version ?? 'unknown'}
        </p>
      </div>
    </div>
  );
}
