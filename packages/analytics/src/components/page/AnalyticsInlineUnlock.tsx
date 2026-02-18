import { Button } from '@tearleads/ui';
import { type FormEvent, useCallback, useState } from 'react';
import { useDatabaseContext } from '@/db/hooks';

interface AnalyticsInlineUnlockProps {
  description?: string;
}

export function AnalyticsInlineUnlock({
  description = 'analytics'
}: AnalyticsInlineUnlockProps) {
  const { isSetUp, unlock } = useDatabaseContext();
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!password) {
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const success = await unlock(password, false);
        if (!success) {
          setError('Wrong password');
        }
      } catch {
        setError('Failed to unlock database');
      } finally {
        setIsLoading(false);
      }
    },
    [password, unlock]
  );

  if (!isSetUp) {
    return (
      <div data-testid="inline-unlock">
        <p>Database is not set up.</p>
      </div>
    );
  }

  return (
    <div data-testid="inline-unlock">
      <p>Database is locked. Enter your password to view {description}.</p>
      <form onSubmit={handleSubmit}>
        <input
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setError(null);
          }}
          data-testid="inline-unlock-password"
        />
        <Button
          type="submit"
          size="sm"
          disabled={isLoading || password.length === 0}
          data-testid="inline-unlock-button"
        >
          {isLoading ? 'Unlocking...' : 'Unlock'}
        </Button>
      </form>
      {error ? <p>{error}</p> : null}
    </div>
  );
}
