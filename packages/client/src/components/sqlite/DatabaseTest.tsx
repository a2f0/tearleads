/**
 * Database testing component for the SQLite page.
 * Provides UI for testing database operations across all platforms.
 */

import type { ChangeEvent, FormEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDatabaseAdapter } from '@/db';
import { isBiometricAvailable } from '@/db/crypto/keyManager';
import { useDatabaseContext } from '@/db/hooks';
import { useOnInstanceChange } from '@/hooks/app';
import { getErrorMessage } from '@/lib/errors';
import { detectPlatform } from '@/lib/utils';
import { DatabaseTestControls } from './DatabaseTestControls';

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

  const prevInstanceIdRef = useRef(currentInstanceId);

  const resetTestState = useCallback(() => {
    setTestResult({ status: 'idle', message: '' });
    setTestData(null);
  }, []);

  useOnInstanceChange(resetTestState);

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
    async (event: ChangeEvent<HTMLInputElement>) => {
      if (!isUnlocked) return;
      const shouldPersist = event.target.checked;

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
    [clearPersistedSession, isUnlocked, persistSession]
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
  }, [changePassword, isUnlocked, newPassword, password]);

  const getStatusColor = (status: TestStatus) => {
    switch (status) {
      case 'success':
        return 'text-success';
      case 'error':
        return 'text-destructive';
      case 'running':
        return 'text-warning';
      default:
        return 'text-muted-foreground';
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isSetUp) {
      handleSetup();
    } else if (!isUnlocked) {
      handleUnlock();
    }
  };

  return (
    <div
      className="space-y-3 overflow-x-hidden rounded-lg border p-4 [border-color:var(--soft-border)]"
      data-testid="database-test"
    >
      <h2 className="font-medium">Database Test</h2>
      <DatabaseTestControls
        isLoading={isLoading}
        isSetUp={isSetUp}
        isUnlocked={isUnlocked}
        hasPersistedSession={hasPersistedSession}
        testData={testData}
        password={password}
        newPassword={newPassword}
        showPassword={showPassword}
        showChangePassword={showChangePassword}
        persistUnlock={persistUnlock}
        isPersistingSession={isPersistingSession}
        isMobile={isMobile}
        biometryType={biometryType}
        copied={copied}
        testResult={testResult}
        getBiometricLabel={getBiometricLabel}
        getStatusColor={getStatusColor}
        onPasswordChange={(event) => setPassword(event.target.value)}
        onNewPasswordChange={(event) => setNewPassword(event.target.value)}
        onToggleShowPassword={() => setShowPassword((prev) => !prev)}
        onToggleShowChangePassword={() =>
          setShowChangePassword((prev) => !prev)
        }
        onPersistUnlockChange={(event) =>
          setPersistUnlock(event.target.checked)
        }
        onPersistSessionChange={handlePersistSessionChange}
        onSubmit={handleSubmit}
        onSetup={handleSetup}
        onUnlock={handleUnlock}
        onRestoreSession={handleRestoreSession}
        onLock={handleLock}
        onWriteData={handleWriteData}
        onReadData={handleReadData}
        onChangePassword={handleChangePassword}
        onReset={handleReset}
        onCopyError={async () => {
          if (await copyToClipboard(testResult.message)) {
            setCopied(true);
          }
        }}
      />
    </div>
  );
}
