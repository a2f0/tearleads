// component-complexity: allow — biometric conditionals for mobile platforms
import { Eye, EyeOff, Fingerprint, Loader2 } from 'lucide-react';
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useState
} from 'react';
import { Button } from '@/components/ui/button';
import { isBiometricAvailable } from '@/db/crypto/keyManager';
import { getErrorMessage } from '@/lib/errors';
import { detectPlatform } from '@/lib/utils';

const platform = detectPlatform();
const isMobilePlatform = platform === 'ios' || platform === 'android';

interface UnlockFormProps {
  unlock: (password: string, persist: boolean) => Promise<boolean>;
  restoreSession: () => Promise<boolean>;
  hasPersistedSession: boolean;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  error: string | null;
  setError: (error: string | null) => void;
}

export function UnlockForm({
  unlock,
  restoreSession,
  hasPersistedSession,
  isLoading,
  setIsLoading,
  error,
  setError
}: UnlockFormProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [persistUnlock, setPersistUnlock] = useState(false);
  const [biometryType, setBiometryType] = useState<string | null>(null);

  useEffect(() => {
    if (isMobilePlatform) {
      isBiometricAvailable().then((result) => {
        if (result.isAvailable && result.biometryType) {
          setBiometryType(result.biometryType);
        }
      });
    }
  }, []);

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

  const handlePasswordChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setPassword(e.target.value);
      setError(null);
    },
    [setError]
  );

  const handleTogglePassword = useCallback(() => {
    setShowPassword((prev) => !prev);
  }, []);

  const handlePersistChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setPersistUnlock(e.target.checked);
    },
    []
  );

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
    [password, persistUnlock, unlock, setIsLoading, setError]
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
  }, [restoreSession, setIsLoading, setError]);

  return (
    <form onSubmit={handleUnlock} className="mx-auto mt-6 max-w-xs space-y-3">
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
          {isMobilePlatform && biometryType
            ? `Remember with ${getBiometricLabel()}`
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
            {isMobilePlatform && biometryType ? (
              <>
                <Fingerprint className="mr-1 h-4 w-4" />
                {getBiometricLabel()}
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
  );
}
