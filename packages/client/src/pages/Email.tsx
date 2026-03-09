import { Email as EmailBase } from '@tearleads/email';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { ClientEmailProvider } from '@/contexts/ClientEmailProvider';
import { useDatabaseContext } from '@/db/hooks';

export function Email() {
  const { isUnlocked, isLoading } = useDatabaseContext();

  return (
    <ClientEmailProvider>
      <EmailBase
        isUnlocked={isUnlocked}
        isLoading={isLoading}
        lockedFallback={<InlineUnlock description="email" />}
      />
    </ClientEmailProvider>
  );
}
