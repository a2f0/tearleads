/**
 * Database testing component for the SQLite page.
 * Provides UI for testing database operations across all platforms.
 */

import { Check, Copy, Eye, EyeOff, Fingerprint } from 'lucide-react';
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';
import { Button } from '@/components/ui/button';
import { getDatabaseAdapter } from '@/db';
import { isBiometricAvailable } from '@/db/crypto/key-manager';
import { useDatabaseContext } from '@/db/hooks';
import { useOnInstanceChange } from '@/hooks/useInstanceChange';
import { getErrorMessage } from '@/lib/errors';
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
    currentInstanceId,
    setup,
    unlock,
    restoreSession,
    persistSession,
    clearPersistedSession,
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
  const [isPersistingSession, setIsPersistingSession] = useState(false);
  const [biometryType, setBiometryType] = useState<string | null>(null);

  const platform = detectPlatform();
  const isMobile = platform === 'ios' || platform === 'android';

  // Check biometric availability on mobile
  useEffect(() => {
    if (isMobile) {
      isBiometricAvailable()
        .then((result) => {
          if (result.isAvailable && result.biometryType) {
            setBiometryType(result.biometryType);
          }
        })
        .catch((err) => {
          console.error('Failed to check biometric availability:', err);
        });
    }
  }, [isMobile]);

  // Track previous instance ID to detect changes
  const prevInstanceIdRef = useRef(currentInstanceId);

  // Reset test state when switching instances
  const resetTestState = useCallback(() => {
    setTestResult({ status: 'idle', message: '' });
    setTestData(null);
  }, []);

  // Primary mechanism: pub-sub notification (fires synchronously on switch)
  useOnInstanceChange(resetTestState);

  // Fallback mechanism: detect context change via useEffect
  useEffect(() => {
    if (
      prevInstanceIdRef.current !== null &&
      currentInstanceId !== prevInstanceIdRef.current
    ) {
      resetTestState();
    }
    prevInstanceIdRef.current = currentInstanceId;
  }, [currentInstanceId, resetTestState]);

  useEffect(() => {
    if (!copied) return;

    const timerId = setTimeout(() => {
      setCopied(false);
    }, 2000);

    return () => clearTimeout(timerId);
  }, [copied]);

  const getBiometricLabel = useCallback(() => {
    switch (biometryType) {
      case 'faceId':
        return 'Face ID';
      case 'touchId':
        return 'Touch ID';
      case 'fingerprint':
        return 'Fingerprint';
      case 'iris':
        return 'Iris';
      default:
        return 'Biometric';
    }
  }, [biometryType]);

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
        message: `Setup error: ${getErrorMessage(err)}`
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
        message: `Unlock error: ${getErrorMessage(err)}`
      });
    }
  }, [password, persistUnlock, unlock]);

  const handlePersistSessionChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      if (!isUnlocked) return;
      const shouldPersist = e.target.checked;

      setIsPersistingSession(true);
      setTestResult({
        status: 'running',
        message: shouldPersist ? 'Persisting session...' : 'Clearing session...'
      });

      try {
        if (shouldPersist) {
          const persisted = await persistSession();
          if (!persisted) {
            setTestResult({
              status: 'error',
              message: 'Failed to persist session'
            });
            return;
          }
          setTestResult({ status: 'success', message: 'Session persisted' });
        } else {
          await clearPersistedSession();
          setTestResult({ status: 'success', message: 'Session cleared' });
        }
      } catch (err) {
        setTestResult({
          status: 'error',
          message: `${shouldPersist ? 'Persist' : 'Clear'} session error: ${getErrorMessage(err)}`
        });
      } finally {
        setIsPersistingSession(false);
      }
    },
    [isUnlocked, persistSession, clearPersistedSession]
  );

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
        message: `Restore error: ${getErrorMessage(err)}`
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
          message: `Lock error: ${getErrorMessage(err)}`
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
        message: `Reset error: ${getErrorMessage(err)}`
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
      const adapter = getDatabaseAdapter();
      const testValue = `test-value-${Date.now()}`;

      // Use raw SQL for reliable INSERT OR REPLACE
      await adapter.execute(
        `INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, ?)`,
        ['test_key', testValue, Date.now()]
      );

      setTestData(testValue);
      setTestResult({
        status: 'success',
        message: `Wrote test data: ${testValue}`
      });
    } catch (err) {
      setTestResult({
        status: 'error',
        message: `Write error: ${getErrorMessage(err)}`
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
      const adapter = getDatabaseAdapter();
      const result = await adapter.execute(
        `SELECT value FROM user_settings WHERE key = ?`,
        ['test_key']
      );

      if (result.rows.length > 0) {
        const row = result.rows[0];
        const value =
          row && typeof row === 'object' && 'value' in row
            ? String(row['value'])
            : '';
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
        message: `Read error: ${getErrorMessage(err)}`
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
        message: `Change password error: ${getErrorMessage(err)}`
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
        <div className="flex justify-between">
          <span className="text-muted-foreground">Session Persisted</span>
          <span data-testid="db-session-status">
            {hasPersistedSession ? 'Yes' : 'No'}
          </span>
        </div>
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
        {/* Hidden username field for accessibility - suppresses browser warning */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          aria-hidden="true"
          tabIndex={-1}
          className="sr-only"
          readOnly
          value=""
        />
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="Password"
            value={password}
            onChange={handlePasswordChange}
            data-testid="db-password-input"
            autoComplete="current-password"
            className="w-full rounded-md border bg-background px-3 py-2 pr-10 text-base"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute top-1/2 right-1 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? (
              <EyeOff className="h-5 w-5" />
            ) : (
              <Eye className="h-5 w-5" />
            )}
          </button>
        </div>

        {isSetUp && !isUnlocked && (
          <label className="flex cursor-pointer items-center gap-2 text-base">
            <input
              type="checkbox"
              checked={persistUnlock}
              onChange={(e) => setPersistUnlock(e.target.checked)}
              data-testid="db-persist-checkbox"
              className="h-5 w-5 rounded border-gray-300"
            />
            <span>
              {isMobile && biometryType
                ? `Remember with ${getBiometricLabel()}`
                : 'Keep unlocked'}
            </span>
          </label>
        )}

        {isUnlocked && (
          <label className="flex cursor-pointer items-center gap-2 text-base">
            <input
              type="checkbox"
              checked={hasPersistedSession}
              onChange={handlePersistSessionChange}
              disabled={isPersistingSession}
              data-testid="db-persist-session-checkbox"
              className="h-5 w-5 rounded border-gray-300"
            />
            <span>
              {isMobile && biometryType
                ? `Remember with ${getBiometricLabel()}`
                : 'Keep unlocked'}
            </span>
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
                  {isMobile && biometryType ? (
                    <>
                      <Fingerprint className="mr-1 h-4 w-4" />
                      {getBiometricLabel()}
                    </>
                  ) : (
                    'Restore Session'
                  )}
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
              {hasPersistedSession && (
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
                className="col-span-2 rounded-md border bg-background px-3 py-2 text-base"
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
