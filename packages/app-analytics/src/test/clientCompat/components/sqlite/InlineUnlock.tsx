import { useDatabaseContext } from '@/db/hooks';

interface InlineUnlockProps {
  description?: string;
}

export function InlineUnlock({ description = 'content' }: InlineUnlockProps) {
  const { isSetUp } = useDatabaseContext();

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
      <input data-testid="inline-unlock-password" type="password" />
      <button data-testid="inline-unlock-button" type="button">
        Unlock
      </button>
    </div>
  );
}
