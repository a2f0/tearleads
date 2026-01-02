/**
 * Inline unlock component that displays a password input and unlock button.
 * Used on pages that require database access when the database is locked.
 */

import { Database, Eye, EyeOff, Loader2 } from 'lucide-react';
import { type ChangeEvent, type FormEvent, useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useDatabaseContext } from '@/db/hooks';
import { getErrorMessage } from '@/lib/errors';
import { detectPlatform } from '@/lib/utils';

interface InlineUnlockProps {
  /** Description of what will be accessible after unlocking */
  description?: string;
}

export function InlineUnlock({ description = 'content' }: InlineUnlockProps) {
  const { isSetUp, unlock, restoreSession, hasPersistedSession } =
    useDatabaseContext();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persistUnlock, setPersistUnlock] = useState(false);

  const isWeb = detectPlatform() === 'web';

  const handlePasswordChange = (e: ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    setError(null);
  };

  const handleUnlock = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!password) return;

      setIsLoading(true);
      setError(null);

      try {
        const success = await unlock(password, persistUnlock);
        if (!success) {
          setError('Wrong password');
        }
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setIsLoading(false);
      }
    },
    [password, persistUnlock, unlock]
  );

  const handleRestoreSession = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const success = await restoreSession();
      if (!success) {
        setError('Failed to restore session');
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [restoreSession]);

  if (!isSetUp) {
    return (
      <div
        className="rounded-lg border p-8 text-center"
        data-testid="inline-unlock"
      >
        <Database className="mx-auto h-12 w-12 text-muted-foreground/50" />
        <p className="mt-4 text-muted-foreground">
          Database is not set up. Go to the SQLite page to set up your database.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border p-8 text-center"
      data-testid="inline-unlock"
    >
      <Database className="mx-auto h-12 w-12 text-muted-foreground/50" />
      <p className="mt-4 text-muted-foreground">
        Database is locked. Enter your password to view {description}.
      </p>

      <form onSubmit={handleUnlock} className="mx-auto mt-6 max-w-xs space-y-3">
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="Password"
            value={password}
            onChange={handlePasswordChange}
            data-testid="inline-unlock-password"
            autoComplete="current-password"
            disabled={isLoading}
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

        {isWeb && (
          <label className="flex cursor-pointer items-center justify-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={persistUnlock}
              onChange={(e) => setPersistUnlock(e.target.checked)}
              data-testid="inline-unlock-persist"
              className="h-4 w-4 rounded border-gray-300"
            />
            <span>Keep unlocked across reloads</span>
          </label>
        )}

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
              Restore Session
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
    </div>
  );
}
