import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useState
} from 'react';
import { isBiometricAvailable } from '@/db/crypto/keyManager';
import { getErrorMessage } from '@/lib/errors';
import { detectPlatform } from '@/lib/utils';

const platform = detectPlatform();
const isMobile = platform === 'ios' || platform === 'android';

interface UseInlineUnlockControllerParams {
  unlock: (password: string, persistUnlock: boolean) => Promise<boolean>;
  restoreSession: () => Promise<boolean>;
}

function getBiometricLabel(biometryType: string): string {
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
}

export function useInlineUnlockController({
  unlock,
  restoreSession
}: UseInlineUnlockControllerParams) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persistUnlock, setPersistUnlock] = useState(false);
  const [biometryType, setBiometryType] = useState<string | null>(null);

  useEffect(() => {
    if (!isMobile) {
      return;
    }

    let cancelled = false;
    void isBiometricAvailable().then((result) => {
      if (cancelled) {
        return;
      }
      if (result.isAvailable && result.biometryType) {
        setBiometryType(result.biometryType);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handlePasswordChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setPassword(event.target.value);
      setError(null);
    },
    []
  );

  const handleTogglePassword = useCallback(() => {
    setShowPassword((previous) => !previous);
  }, []);

  const handlePersistChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setPersistUnlock(event.target.checked);
    },
    []
  );

  const handleUnlock = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!password) {
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const success = await unlock(password, persistUnlock);
        if (!success) {
          setError('Wrong password');
        }
      } catch (unlockError) {
        setError(getErrorMessage(unlockError));
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
    } catch (restoreError) {
      setError(getErrorMessage(restoreError));
    } finally {
      setIsLoading(false);
    }
  }, [restoreSession]);

  return {
    password,
    showPassword,
    isLoading,
    error,
    persistUnlock,
    biometricLabel:
      isMobile && biometryType ? getBiometricLabel(biometryType) : null,
    handlePasswordChange,
    handleTogglePassword,
    handlePersistChange,
    handleUnlock,
    handleRestoreSession
  };
}
