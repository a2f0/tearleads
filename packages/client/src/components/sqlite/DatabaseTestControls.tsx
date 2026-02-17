import { Check, Copy, Eye, EyeOff, Fingerprint } from 'lucide-react';
import type { ChangeEvent, FormEvent } from 'react';
import { Button } from '@/components/ui/button';

type TestStatus = 'idle' | 'running' | 'success' | 'error';

interface TestResult {
  status: TestStatus;
  message: string;
}

interface DatabaseTestControlsProps {
  isLoading: boolean;
  isSetUp: boolean;
  isUnlocked: boolean;
  hasPersistedSession: boolean;
  testData: string | null;
  password: string;
  newPassword: string;
  showPassword: boolean;
  showChangePassword: boolean;
  persistUnlock: boolean;
  isPersistingSession: boolean;
  isMobile: boolean;
  biometryType: string | null;
  copied: boolean;
  testResult: TestResult;
  getBiometricLabel: () => string;
  getStatusColor: (status: TestStatus) => string;
  onPasswordChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onNewPasswordChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onToggleShowPassword: () => void;
  onToggleShowChangePassword: () => void;
  onPersistUnlockChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onPersistSessionChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSetup: () => void;
  onUnlock: () => void;
  onRestoreSession: () => void;
  onLock: (clearSession?: boolean) => void;
  onWriteData: () => void;
  onReadData: () => void;
  onChangePassword: () => void;
  onReset: () => void;
  onCopyError: () => void;
}

export function DatabaseTestControls({
  isLoading,
  isSetUp,
  isUnlocked,
  hasPersistedSession,
  testData,
  password,
  newPassword,
  showPassword,
  showChangePassword,
  persistUnlock,
  isPersistingSession,
  isMobile,
  biometryType,
  copied,
  testResult,
  getBiometricLabel,
  getStatusColor,
  onPasswordChange,
  onNewPasswordChange,
  onToggleShowPassword,
  onToggleShowChangePassword,
  onPersistUnlockChange,
  onPersistSessionChange,
  onSubmit,
  onRestoreSession,
  onLock,
  onWriteData,
  onReadData,
  onChangePassword,
  onReset,
  onCopyError
}: DatabaseTestControlsProps) {
  return (
    <>
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

      <form className="space-y-2" onSubmit={onSubmit}>
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
            onChange={onPasswordChange}
            data-testid="db-password-input"
            autoComplete="current-password"
            className="w-full rounded-md border bg-background px-3 py-2 pr-10 text-base [border-color:var(--soft-border)]"
          />
          <button
            type="button"
            onClick={onToggleShowPassword}
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
              onChange={onPersistUnlockChange}
              data-testid="db-persist-checkbox"
              className="h-5 w-5 rounded border [border-color:var(--soft-border)]"
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
              onChange={onPersistSessionChange}
              disabled={isPersistingSession}
              data-testid="db-persist-session-checkbox"
              className="h-5 w-5 rounded border [border-color:var(--soft-border)]"
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
                  onClick={onRestoreSession}
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
                onClick={() => onLock(false)}
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
                  onClick={() => onLock(true)}
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
                onClick={onWriteData}
                disabled={isLoading}
                data-testid="db-write-button"
              >
                Write Data
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onReadData}
                disabled={isLoading}
                data-testid="db-read-button"
              >
                Read Data
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onToggleShowChangePassword}
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
                onChange={onNewPasswordChange}
                data-testid="db-new-password-input"
                autoComplete="new-password"
                className="col-span-2 rounded-md border bg-background px-3 py-2 text-base [border-color:var(--soft-border)]"
              />
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={onChangePassword}
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
            onClick={onReset}
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
              onClick={onCopyError}
              className="shrink-0 rounded p-1 hover:bg-muted"
              aria-label="Copy error to clipboard"
            >
              {copied ? (
                <Check className="h-3 w-3 text-success" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          )}
        </div>
      )}
    </>
  );
}
