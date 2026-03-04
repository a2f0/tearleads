// component-complexity: allow -- debug harness keeps platform-specific DB recovery/unlock flows in one place.
/**
 * Database testing component for the SQLite page.
 * Provides UI for testing database operations across all platforms.
 */

import type { ChangeEvent, FormEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOptionalAuth } from '@/contexts/AuthContext';
import { getDatabaseAdapter, setDatabasePassword } from '@/db';
import { isBiometricAvailable } from '@/db/crypto/keyManager';
import { useDatabaseContext } from '@/db/hooks';
import { updateInstance } from '@/db/instanceRegistry';
import { useOnInstanceChange } from '@/hooks/app';
import { getErrorMessage } from '@/lib/errors';
import { detectPlatform } from '@/lib/utils';
import { DatabaseTestControls } from './DatabaseTestControls';
import type { TestResult, TestStatus } from './databaseTestUtils';
import { copyToClipboard } from './databaseTestUtils';

export function DatabaseTest() {
  const {
    isLoading,
    isSetUp,
    isUnlocked,
    hasPersistedSession,
    currentInstanceId,
    instances,
    setup,
    unlock,
    restoreSession,
    persistSession,
    clearPersistedSession,
    lock,
    reset,
    changePassword,
    refreshInstances
  } = useDatabaseContext();
  const auth = useOptionalAuth();
  const isAuthenticated = auth?.isAuthenticated ?? false;

  const [password, setPassword] = useState('');
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

  const passwordDeferred =
    instances.find((i) => i.id === currentInstanceId)?.passwordDeferred === true;

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
        if (
          isUnlocked &&
          !isAuthenticated &&
          currentInstanceId &&
          passwordDeferred
        ) {
          if (!password.trim()) {
            setTestResult({
              status: 'error',
              message: 'Set a password before locking this deferred instance'
            });
            return;
          }

          const saved = await setDatabasePassword(password, currentInstanceId);
          if (!saved) {
            setTestResult({
              status: 'error',
              message: 'Could not save password before lock'
            });
            return;
          }

          await updateInstance(currentInstanceId, { passwordDeferred: false });
          await refreshInstances();
        }

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
    [
      currentInstanceId,
      isAuthenticated,
      isUnlocked,
      lock,
      password,
      passwordDeferred,
      refreshInstances
    ]
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

  const handleSetPassword = useCallback(async () => {
    if (!password.trim() || !currentInstanceId) return;

    setTestResult({ status: 'running', message: 'Setting password...' });
    try {
      const saved = await setDatabasePassword(password, currentInstanceId);
      if (!saved) {
        setTestResult({
          status: 'error',
          message: 'Could not save password'
        });
        return;
      }

      await updateInstance(currentInstanceId, { passwordDeferred: false });
      await refreshInstances();
      setTestResult({
        status: 'success',
        message: 'Password set successfully'
      });
    } catch (err) {
      setTestResult({
        status: 'error',
        message: `Set password error: ${getErrorMessage(err)}`
      });
    }
  }, [currentInstanceId, password, refreshInstances]);

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
        passwordDeferred={passwordDeferred}
        onPersistSessionChange={handlePersistSessionChange}
        onSubmit={handleSubmit}
        onSetup={handleSetup}
        onUnlock={handleUnlock}
        onRestoreSession={handleRestoreSession}
        onLock={handleLock}
        onWriteData={handleWriteData}
        onReadData={handleReadData}
        onChangePassword={handleChangePassword}
        onSetPassword={handleSetPassword}
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
