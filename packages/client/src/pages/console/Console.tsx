import { AlertTriangle, Terminal } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dropzone } from '@/components/ui/dropzone';
import { Input } from '@/components/ui/input';
import { useDatabaseContext } from '@/db/hooks';
import { getErrorMessage } from '@/lib/errors';
import {
  generateBackupFilename,
  readFileAsUint8Array,
  saveFile
} from '@/lib/file-utils';

export function Console() {
  const {
    isLoading,
    isSetUp,
    isUnlocked,
    hasPersistedSession,
    currentInstanceName,
    setup,
    unlock,
    restoreSession,
    lock,
    exportDatabase,
    importDatabase,
    changePassword
  } = useDatabaseContext();

  const [logs, setLogs] = useState<Array<{ id: string; message: string }>>([]);
  const logIdRef = useRef(0);
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirm, setSetupConfirm] = useState('');
  const [unlockPassword, setUnlockPassword] = useState('');
  const [persistUnlock, setPersistUnlock] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pendingRestoreFile, setPendingRestoreFile] = useState<File | null>(
    null
  );
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [activeCommand, setActiveCommand] = useState<string | null>(null);

  const getNextLogId = useCallback(() => {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }
    logIdRef.current += 1;
    return String(logIdRef.current);
  }, []);

  const appendLog = useCallback(
    (message: string) => {
      const nextId = getNextLogId();
      setLogs((prev) => [...prev, { id: nextId, message }]);
    },
    [getNextLogId]
  );

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const ensureUnlocked = useCallback(async (): Promise<boolean> => {
    if (!isSetUp) {
      appendLog('Database not set up. Run setup first.');
      return false;
    }

    if (isUnlocked) {
      return true;
    }

    if (!hasPersistedSession) {
      appendLog('Database locked. Unlock first.');
      return false;
    }

    appendLog('Restoring session...');
    const restored = await restoreSession();
    if (!restored) {
      appendLog('Session expired. Unlock first.');
      return false;
    }

    appendLog('Session restored.');
    return true;
  }, [appendLog, hasPersistedSession, isSetUp, isUnlocked, restoreSession]);

  const handleSetup = useCallback(async () => {
    if (isSetUp) {
      appendLog('Database already set up.');
      return;
    }

    if (!setupPassword) {
      appendLog('Password cannot be empty.');
      return;
    }

    if (setupPassword !== setupConfirm) {
      appendLog('Passwords do not match.');
      return;
    }

    setActiveCommand('setup');
    appendLog('Initializing database...');
    try {
      const success = await setup(setupPassword);
      if (success) {
        appendLog('Database initialized successfully.');
        setSetupPassword('');
        setSetupConfirm('');
      } else {
        appendLog('Database setup failed.');
      }
    } catch (err) {
      appendLog(`Setup failed: ${getErrorMessage(err)}`);
    } finally {
      setActiveCommand(null);
    }
  }, [appendLog, isSetUp, setup, setupConfirm, setupPassword]);

  const handleUnlock = useCallback(async () => {
    if (!isSetUp) {
      appendLog('Database not set up. Run setup first.');
      return;
    }

    if (!unlockPassword) {
      appendLog('Password cannot be empty.');
      return;
    }

    setActiveCommand('unlock');
    appendLog('Unlocking database...');
    try {
      const success = await unlock(unlockPassword, persistUnlock);
      if (success) {
        appendLog(
          persistUnlock
            ? 'Database unlocked (session persisted).'
            : 'Database unlocked.'
        );
        setUnlockPassword('');
      } else {
        appendLog('Incorrect password.');
      }
    } catch (err) {
      appendLog(`Unlock failed: ${getErrorMessage(err)}`);
    } finally {
      setActiveCommand(null);
    }
  }, [appendLog, isSetUp, persistUnlock, unlock, unlockPassword]);

  const handleRestoreSession = useCallback(async () => {
    setActiveCommand('restore-session');
    appendLog('Restoring session...');
    try {
      const restored = await restoreSession();
      if (restored) {
        appendLog('Database unlocked (session restored).');
      } else {
        appendLog('No persisted session found.');
      }
    } catch (err) {
      appendLog(`Restore session failed: ${getErrorMessage(err)}`);
    } finally {
      setActiveCommand(null);
    }
  }, [appendLog, restoreSession]);

  const handleLock = useCallback(
    async (clearSession: boolean) => {
      setActiveCommand(clearSession ? 'lock-clear' : 'lock');
      appendLog('Locking database...');
      try {
        await lock(clearSession);
        appendLog(
          clearSession
            ? 'Database locked (session cleared).'
            : 'Database locked.'
        );
      } catch (err) {
        appendLog(`Lock failed: ${getErrorMessage(err)}`);
      } finally {
        setActiveCommand(null);
      }
    },
    [appendLog, lock]
  );

  const handleBackup = useCallback(async () => {
    if (activeCommand) {
      return;
    }

    const canProceed = await ensureUnlocked();
    if (!canProceed) {
      return;
    }

    setActiveCommand('backup');
    appendLog('Exporting database...');
    try {
      const data = await exportDatabase();
      const filename = generateBackupFilename();
      await saveFile(data, filename);
      appendLog(`Backup saved as ${filename}.`);
    } catch (err) {
      appendLog(`Backup failed: ${getErrorMessage(err)}`);
    } finally {
      setActiveCommand(null);
    }
  }, [activeCommand, appendLog, ensureUnlocked, exportDatabase]);

  const handleFilesSelected = useCallback(
    (files: File[]) => {
      const file = files[0];
      if (!file) {
        return;
      }

      if (!file.name.endsWith('.db')) {
        appendLog('Please select a .db backup file.');
        return;
      }

      setPendingRestoreFile(file);
      setShowRestoreConfirm(true);
    },
    [appendLog]
  );

  const handleConfirmRestore = useCallback(async () => {
    if (!pendingRestoreFile) {
      return;
    }

    if (!isSetUp) {
      appendLog('Database not set up. Run setup first.');
      setShowRestoreConfirm(false);
      setPendingRestoreFile(null);
      return;
    }

    setActiveCommand('restore');
    appendLog(`Restoring from ${pendingRestoreFile.name}...`);
    setShowRestoreConfirm(false);
    try {
      const data = await readFileAsUint8Array(pendingRestoreFile);
      await importDatabase(data);
      await lock();
      appendLog('Database restored successfully.');
    } catch (err) {
      appendLog(`Restore failed: ${getErrorMessage(err)}`);
    } finally {
      setActiveCommand(null);
      setPendingRestoreFile(null);
    }
  }, [appendLog, importDatabase, isSetUp, lock, pendingRestoreFile]);

  const handleCancelRestore = useCallback(() => {
    setShowRestoreConfirm(false);
    setPendingRestoreFile(null);
  }, []);

  const handleChangePassword = useCallback(async () => {
    if (!isUnlocked) {
      appendLog('Database not unlocked. Unlock first.');
      return;
    }

    if (!oldPassword) {
      appendLog('Current password cannot be empty.');
      return;
    }

    if (!newPassword) {
      appendLog('New password cannot be empty.');
      return;
    }

    if (newPassword !== confirmPassword) {
      appendLog('New passwords do not match.');
      return;
    }

    setActiveCommand('password');
    appendLog('Changing password...');
    try {
      const success = await changePassword(oldPassword, newPassword);
      if (success) {
        appendLog('Password changed successfully.');
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        appendLog('Incorrect current password.');
      }
    } catch (err) {
      appendLog(`Password change failed: ${getErrorMessage(err)}`);
    } finally {
      setActiveCommand(null);
    }
  }, [
    appendLog,
    changePassword,
    confirmPassword,
    isUnlocked,
    newPassword,
    oldPassword
  ]);

  return (
    <div className="space-y-6 overflow-x-hidden">
      <div className="flex items-center gap-3">
        <Terminal className="h-8 w-8 text-muted-foreground" />
        <h1 className="font-bold text-2xl tracking-tight">Console</h1>
      </div>
      <p className="text-muted-foreground text-sm">
        Run the same database commands as the CLI with a live output stream.
      </p>

      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">Status</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Instance</span>
            <span>{currentInstanceName ?? 'Default'}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Database</span>
            <span>
              {isLoading
                ? 'Loading...'
                : isUnlocked
                  ? 'Unlocked'
                  : isSetUp
                    ? 'Locked'
                    : 'Not set up'}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Session persisted</span>
            <span>{hasPersistedSession ? 'Yes' : 'No'}</span>
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">Setup</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            type="password"
            placeholder="New password"
            value={setupPassword}
            onChange={(e) => setSetupPassword(e.target.value)}
            data-testid="console-setup-password"
            autoComplete="new-password"
          />
          <Input
            type="password"
            placeholder="Confirm password"
            value={setupConfirm}
            onChange={(e) => setSetupConfirm(e.target.value)}
            data-testid="console-setup-confirm"
            autoComplete="new-password"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={handleSetup}
          disabled={
            isLoading ||
            activeCommand !== null ||
            !setupPassword ||
            !setupConfirm
          }
          data-testid="console-setup-button"
          className="w-full"
        >
          Initialize Database
        </Button>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">Unlock</h2>
        <div className="space-y-2">
          <Input
            type="password"
            placeholder="Password"
            value={unlockPassword}
            onChange={(e) => setUnlockPassword(e.target.value)}
            data-testid="console-unlock-password"
            autoComplete="current-password"
          />
          <label className="flex items-center gap-2 text-base">
            <input
              type="checkbox"
              checked={persistUnlock}
              onChange={(e) => setPersistUnlock(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
              data-testid="console-unlock-persist"
            />
            <span>Keep unlocked</span>
          </label>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            type="button"
            onClick={handleUnlock}
            disabled={
              isLoading || activeCommand !== null || !unlockPassword || !isSetUp
            }
            data-testid="console-unlock-button"
          >
            Unlock
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleRestoreSession}
            disabled={
              isLoading || activeCommand !== null || !hasPersistedSession
            }
            data-testid="console-restore-session-button"
          >
            Restore Session
          </Button>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">Lock</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleLock(false)}
            disabled={isLoading || activeCommand !== null || !isUnlocked}
            data-testid="console-lock-button"
          >
            Lock
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleLock(true)}
            disabled={isLoading || activeCommand !== null || !isUnlocked}
            data-testid="console-lock-clear-button"
          >
            Lock & Clear Session
          </Button>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">Backup</h2>
        <p className="text-muted-foreground text-sm">
          Export the encrypted database to a backup file.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={handleBackup}
          disabled={isLoading || activeCommand !== null}
          data-testid="console-backup-button"
          className="w-full"
        >
          Create Backup
        </Button>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">Restore</h2>
        <p className="text-muted-foreground text-sm">
          Import a backup file and replace the current database.
        </p>
        {!showRestoreConfirm && (
          <Dropzone
            onFilesSelected={handleFilesSelected}
            accept=".db"
            multiple={false}
            className={activeCommand ? 'pointer-events-none opacity-50' : ''}
          />
        )}
        {showRestoreConfirm && (
          <div className="space-y-4 rounded-md border border-destructive/50 bg-destructive/5 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-destructive">
                  Warning: This will replace your current data
                </p>
                <p className="text-muted-foreground text-sm">
                  Restoring from "{pendingRestoreFile?.name}" will overwrite
                  existing data.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleConfirmRestore}
                variant="destructive"
                disabled={activeCommand !== null}
                data-testid="console-restore-confirm"
              >
                Restore
              </Button>
              <Button
                onClick={handleCancelRestore}
                variant="outline"
                disabled={activeCommand !== null}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">Change Password</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            type="password"
            placeholder="Current password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            data-testid="console-password-current"
            autoComplete="current-password"
          />
          <Input
            type="password"
            placeholder="New password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            data-testid="console-password-new"
            autoComplete="new-password"
          />
          <Input
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            data-testid="console-password-confirm"
            autoComplete="new-password"
          />
        </div>
        <Button
          type="button"
          onClick={handleChangePassword}
          disabled={isLoading || activeCommand !== null}
          data-testid="console-password-button"
          className="w-full"
        >
          Change Password
        </Button>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium">Console Output</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearLogs}
            disabled={logs.length === 0}
            data-testid="console-clear-output"
          >
            Clear
          </Button>
        </div>
        <div
          className="min-h-32 rounded-md border bg-muted p-3 font-mono text-foreground text-xs"
          data-testid="console-output"
        >
          {logs.length === 0 ? (
            <span className="text-muted-foreground">No output yet.</span>
          ) : (
            <div className="space-y-1">
              {logs.map((entry) => (
                <div key={entry.id}>{entry.message}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
