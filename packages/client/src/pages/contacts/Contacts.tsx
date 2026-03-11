import { ContactsPage } from '@tearleads/app-contacts';
import { useParams } from 'react-router-dom';
import { ClientContactsProvider } from '@/contexts/ClientContactsProvider';

export function Contacts() {
  const { groupId } = useParams<{ groupId?: string }>();
  return (
    <ClientContactsProvider>
      <ContactsPage groupId={groupId} />
    </ClientContactsProvider>
  );
}
