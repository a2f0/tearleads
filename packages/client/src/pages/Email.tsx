import { Email as EmailBase } from '@tearleads/email';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { ClientEmailProvider } from '@/contexts/ClientEmailProvider';

export function Email() {
  return (
    <ClientEmailProvider>
      <EmailBase lockedFallback={<InlineUnlock description="email" />} />
    </ClientEmailProvider>
  );
}
