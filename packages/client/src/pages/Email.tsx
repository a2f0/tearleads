import { Email as EmailBase } from '@rapid/email';
import { ClientEmailProvider } from '@/contexts/ClientEmailProvider';

export function Email() {
  return (
    <ClientEmailProvider>
      <EmailBase />
    </ClientEmailProvider>
  );
}
