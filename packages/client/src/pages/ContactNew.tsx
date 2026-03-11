import { ContactNewPage } from '@tearleads/app-contacts';
import { ClientContactsProvider } from '@/contexts/ClientContactsProvider';

export function ContactNew() {
  return (
    <ClientContactsProvider>
      <ContactNewPage />
    </ClientContactsProvider>
  );
}
