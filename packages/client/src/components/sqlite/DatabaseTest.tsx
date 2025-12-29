/**
 * Database testing component for the SQLite page.
 * Provides UI for testing database operations across all platforms.
 */

import { eq } from 'drizzle-orm';
import { Check, Copy, Eye, EyeOff } from 'lucide-react';
import { type ChangeEvent, useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { userSettings } from '@/db/schema';
import { detectPlatform } from '@/lib/utils';

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type TestStatus = 'idle' | 'running' | 'success' | 'error';

interface TestResult {
  status: TestStatus;
  message: string;
}

export function DatabaseTest() {
  const {
    isLoading,
    isSetUp,
    isUnlocked,
    hasPersistedSession,
    setup,
    unlock,
    restoreSession,
    lock,
    reset,
    changePassword
  } = useDatabaseContext();

  const [password, setPassword] = useState('testpassword123');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [persistUnlock, setPersistUnlock] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>({
    status: 'idle',
    message: ''
  });
  const [testData, setTestData] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isWeb = detectPlatform() === 'web';

  useEffect(() => {
    if (!copied) return;

    const timerId = setTimeout(() => {
      setCopied(false);
    }, 2000);

    return () => clearTimeout(timerId);
  }, [copied]);

  const handleSetup = useCallback(async () => {
    setTestResult({ status: 'running', message: 'Setting up database...' });
    try {
      await setup(password);
      setTestResult({
        status: 'success',
        message: 'Database setup complete'
      });
    } catch (err) {
      setTestResult({
        status: 'error',
        message: `Setup error: ${(err as Error).message}`
      });
    }
  }, [password, setup]);

  const handleUnlock = useCallback(async () => {
    setTestResult({ status: 'running', message: 'Unlocking database...' });
    try {
      const startTime = performance.now();
      const success = await unlock(password, persistUnlock);
      if (success) {
        const elapsed = performance.now() - startTime;
        const persistMsg = persistUnlock ? ' (session persisted)' : '';
        setTestResult({
          status: 'success',
          message: `Database unlocked${persistMsg} (${elapsed.toFixed(0)}ms)`
        });
      } else {
        setTestResult({ status: 'error', message: 'Wrong password' });
      }
    } catch (err) {
      setTestResult({
        status: 'error',
        message: `Unlock error: ${(err as Error).message}`
      });
    }
  }, [password, persistUnlock, unlock]);

  const handleRestoreSession = useCallback(async () => {
    setTestResult({ status: 'running', message: 'Restoring session...' });
    try {
      const startTime = performance.now();
      const success = await restoreSession();
      if (success) {
        const elapsed = performance.now() - startTime;
        setTestResult({
          status: 'success',
          message: `Session restored (${elapsed.toFixed(0)}ms)`
        });
      } else {
        setTestResult({
          status: 'error',
          message: 'No persisted session found'
        });
      }
    } catch (err) {
      setTestResult({
        status: 'error',
        message: `Restore error: ${(err as Error).message}`
      });
    }
  }, [restoreSession]);

  const handleLock = useCallback(
    async (clearSession = false) => {
      setTestResult({ status: 'running', message: 'Locking database...' });
      try {
        await lock(clearSession);
        const sessionMsg = clearSession ? ' (session cleared)' : '';
        setTestResult({
          status: 'success',
          message: `Database locked${sessionMsg}`
        });
        setTestData(null);
      } catch (err) {
        setTestResult({
          status: 'error',
          message: `Lock error: ${(err as Error).message}`
        });
      }
    },
    [lock]
  );

  const handleReset = useCallback(async () => {
    setTestResult({ status: 'running', message: 'Resetting database...' });
    try {
      await reset();
      setTestResult({ status: 'success', message: 'Database reset complete' });
      setTestData(null);
    } catch (err) {
      setTestResult({
        status: 'error',
        message: `Reset error: ${(err as Error).message}`
      });
    }
  }, [reset]);

  const handleWriteData = useCallback(async () => {
    if (!isUnlocked) {
      setTestResult({ status: 'error', message: 'Database not unlocked' });
      return;
    }

    setTestResult({ status: 'running', message: 'Writing test data...' });
    try {
      const db = getDatabase();
      const testValue = `test-value-${Date.now()}`;

      // Delete existing and insert new (simulates INSERT OR REPLACE)
      await db.delete(userSettings).where(eq(userSettings.key, 'test_key'));
      await db.insert(userSettings).values({
        key: 'test_key',
        value: testValue,
        updatedAt: new Date()
      });

      setTestData(testValue);
      setTestResult({
        status: 'success',
        message: `Wrote test data: ${testValue}`
      });
    } catch (err) {
      setTestResult({
        status: 'error',
        message: `Write error: ${(err as Error).message}`
      });
    }
  }, [isUnlocked]);

  const handleReadData = useCallback(async () => {
    if (!isUnlocked) {
      setTestResult({ status: 'error', message: 'Database not unlocked' });
      return;
    }

    setTestResult({ status: 'running', message: 'Reading test data...' });
    try {
      const db = getDatabase();
      const result = await db
        .select({ value: userSettings.value })
        .from(userSettings)
        .where(eq(userSettings.key, 'test_key'))
        .limit(1);

      if (result.length > 0 && result[0]?.value) {
        const value = result[0].value;
        setTestData(value);
        setTestResult({
          status: 'success',
          message: `Read test data: ${value}`
        });
      } else {
        setTestData(null);
        setTestResult({ status: 'success', message: 'No test data found' });
      }
    } catch (err) {
      setTestResult({
        status: 'error',
        message: `Read error: ${(err as Error).message}`
      });
    }
  }, [isUnlocked]);

  const handleChangePassword = useCallback(async () => {
    if (!isUnlocked) {
      setTestResult({ status: 'error', message: 'Database not unlocked' });
      return;
    }
    if (!newPassword) {
      setTestResult({
        status: 'error',
        message: 'New password is required'
      });
      return;
    }

    setTestResult({ status: 'running', message: 'Changing password...' });
    try {
      const success = await changePassword(password, newPassword);
      if (success) {
        // Update the current password to the new one
        setPassword(newPassword);
        setNewPassword('');
        setShowChangePassword(false);
        setTestResult({
          status: 'success',
          message: 'Password changed successfully'
        });
      } else {
        setTestResult({
          status: 'error',
          message: 'Wrong current password'
        });
      }
    } catch (err) {
      setTestResult({
        status: 'error',
        message: `Change password error: ${(err as Error).message}`
      });
    }
  }, [isUnlocked, password, newPassword, changePassword]);

  const getStatusColor = (status: TestStatus) => {
    switch (status) {
      case 'success':
        return 'text-green-600';
      case 'error':
        return 'text-red-600';
      case 'running':
        return 'text-yellow-600';
      default:
        return 'text-muted-foreground';
    }
  };

  const handlePasswordChange = (e: ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
  };

  return (
    <div
      className="space-y-3 overflow-x-hidden rounded-lg border p-4"
      data-testid="database-test"
    >
      <h2 className="font-medium">Database Test</h2>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Status</span>
          <span data-testid="db-status">
            {isLoading
              ? 'Loading...'
              : isUnlocked
                ? 'Unlocked'
                : isSetUp
                  ? 'Locked'
                  : 'Not Set Up'}
          </span>
        </div>
        {isWeb && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Session Persisted</span>
            <span data-testid="db-session-status">
              {hasPersistedSession ? 'Yes' : 'No'}
            </span>
          </div>
        )}
        {testData && (
          <div className="flex justify-between gap-2">
            <span className="shrink-0 text-muted-foreground">Test Data</span>
            <span
              data-testid="db-test-data"
              className="min-w-0 truncate text-xs"
            >
              {testData}
            </span>
          </div>
        )}
      </div>

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!isSetUp) {
            handleSetup();
          } else if (!isUnlocked) {
            handleUnlock();
          }
        }}
      >
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="Password"
            value={password}
            onChange={handlePasswordChange}
            data-testid="db-password-input"
            autoComplete="current-password"
            className="w-full rounded-md border bg-background px-3 py-2 pr-10 text-sm"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>

        {isWeb && isSetUp && !isUnlocked && (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={persistUnlock}
              onChange={(e) => setPersistUnlock(e.target.checked)}
              data-testid="db-persist-checkbox"
              className="h-4 w-4 rounded border-gray-300"
            />
            <span>Keep unlocked across reloads</span>
          </label>
        )}

        <div className="grid grid-cols-2 gap-2">
          {!isSetUp && (
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={isLoading || !password}
              data-testid="db-setup-button"
            >
              Setup
            </Button>
          )}

          {isSetUp && !isUnlocked && (
            <>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={isLoading || !password}
                data-testid="db-unlock-button"
              >
                Unlock
              </Button>
              {hasPersistedSession && (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={handleRestoreSession}
                  disabled={isLoading}
                  data-testid="db-restore-session-button"
                >
                  Restore Session
                </Button>
              )}
            </>
          )}

          {isUnlocked && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleLock(false)}
                disabled={isLoading}
                data-testid="db-lock-button"
              >
                Lock
              </Button>
              {isWeb && hasPersistedSession && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleLock(true)}
                  disabled={isLoading}
                  data-testid="db-lock-clear-session-button"
                >
                  Lock & Clear Session
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleWriteData}
                disabled={isLoading}
                data-testid="db-write-button"
              >
                Write Data
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleReadData}
                disabled={isLoading}
                data-testid="db-read-button"
              >
                Read Data
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowChangePassword(!showChangePassword)}
                disabled={isLoading}
                data-testid="db-change-password-toggle"
              >
                {showChangePassword ? 'Cancel' : 'Change Password'}
              </Button>
            </>
          )}

          {showChangePassword && isUnlocked && (
            <>
              <input
                type="password"
                placeholder="New Password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                data-testid="db-new-password-input"
                autoComplete="new-password"
                className="col-span-2 rounded-md border bg-background px-3 py-2 text-sm"
              />
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={handleChangePassword}
                disabled={isLoading || !newPassword}
                data-testid="db-change-password-button"
                className="col-span-2"
              >
                Confirm Change
              </Button>
            </>
          )}

          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={handleReset}
            disabled={isLoading}
            data-testid="db-reset-button"
          >
            Reset
          </Button>
        </div>
      </form>

      {testResult.message && (
        <div
          className={`flex items-start gap-2 text-sm ${getStatusColor(testResult.status)}`}
          data-testid="db-test-result"
          data-status={testResult.status}
        >
          <span className="flex-1 break-all">{testResult.message}</span>
          {testResult.status === 'error' && (
            <button
              type="button"
              onClick={async () => {
                if (await copyToClipboard(testResult.message)) {
                  setCopied(true);
                }
              }}
              className="shrink-0 rounded p-1 hover:bg-muted"
              aria-label="Copy error to clipboard"
            >
              {copied ? (
                <Check className="h-3 w-3 text-green-600" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
