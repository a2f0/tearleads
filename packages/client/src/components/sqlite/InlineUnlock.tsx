/**
 * Inline unlock component that displays a password input and unlock button.
 * Used on pages that require database access when the database is locked.
 */

import { Database, Eye, EyeOff, Fingerprint, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useDatabaseContext } from '@/db/hooks';
import { useDesktopWindowLinkHandler } from '@/hooks/window';
import { useInlineUnlockController } from './useInlineUnlockController';

interface InlineUnlockProps {
  /** Description of what will be accessible after unlocking */
  description?: string;
}

export function InlineUnlock({ description = 'content' }: InlineUnlockProps) {
  const { isSetUp, unlock, restoreSession, hasPersistedSession } =
    useDatabaseContext();
  const handleSqliteLinkClick = useDesktopWindowLinkHandler('sqlite');
  const handleSyncLinkClick = useDesktopWindowLinkHandler('sync');
  const {
    password,
    showPassword,
    isLoading,
    error,
    persistUnlock,
    biometricLabel,
    handlePasswordChange,
    handleTogglePassword,
    handlePersistChange,
    handleUnlock,
    handleRestoreSession
  } = useInlineUnlockController({ unlock, restoreSession });

  if (!isSetUp) {
    return (
      <div
        className="rounded-lg border bg-background p-8 text-center [border-color:var(--soft-border)]"
        data-testid="inline-unlock"
      >
        <Database className="mx-auto h-12 w-12 text-muted-foreground/50" />
        <p className="mt-4 text-muted-foreground">
          Database is not set up. Go to the{' '}
          <Link
            to="/sqlite"
            onClick={handleSqliteLinkClick}
            className="text-primary underline"
          >
            SQLite page
          </Link>{' '}
          to set up your database.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border bg-background p-8 text-center [border-color:var(--soft-border)]"
      data-testid="inline-unlock"
    >
      <Database className="mx-auto h-12 w-12 text-muted-foreground/50" />
      <p className="mt-4 text-muted-foreground">
        Database is locked. Enter your password to view {description}.
      </p>

      <form onSubmit={handleUnlock} className="mx-auto mt-6 max-w-xs space-y-3">
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
            data-testid="inline-unlock-password"
            autoComplete="current-password"
            disabled={isLoading}
            className="w-full rounded-md border bg-background px-3 py-2 pr-10 text-base [border-color:var(--soft-border)]"
          />
          <button
            type="button"
            onClick={handleTogglePassword}
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

        <label className="flex cursor-pointer items-center justify-center gap-2 text-base">
          <input
            type="checkbox"
            checked={persistUnlock}
            onChange={handlePersistChange}
            data-testid="inline-unlock-persist"
            className="h-5 w-5 rounded border border-input"
          />
          <span>
            {biometricLabel
              ? `Remember with ${biometricLabel}`
              : 'Keep unlocked'}
          </span>
        </label>

        <div className="flex justify-center gap-2">
          <Button
            type="submit"
            variant="default"
            size="sm"
            disabled={isLoading || !password}
            data-testid="inline-unlock-button"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Unlocking...
              </>
            ) : (
              'Unlock'
            )}
          </Button>

          {hasPersistedSession && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRestoreSession}
              disabled={isLoading}
              data-testid="inline-unlock-restore"
            >
              {biometricLabel ? (
                <>
                  <Fingerprint className="mr-1 h-4 w-4" />
                  {biometricLabel}
                </>
              ) : (
                'Restore Session'
              )}
            </Button>
          )}
        </div>

        {error && (
          <p
            className="text-destructive text-sm"
            data-testid="inline-unlock-error"
          >
            {error}
          </p>
        )}
      </form>

      <p className="mt-4 text-center text-muted-foreground text-sm">
        Already have an account?{' '}
        <Link
          to="/sync"
          onClick={handleSyncLinkClick}
          className="font-medium text-primary hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
