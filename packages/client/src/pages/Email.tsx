import { Email as EmailBase } from '@tearleads/email';
import { ClientEmailProvider } from '@/contexts/ClientEmailProvider';

export function Email() {
  return (
    <ClientEmailProvider>
      <EmailBase />
    </ClientEmailProvider>
  );
}
