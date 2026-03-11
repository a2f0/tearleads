import { ContactDetailPage } from '@tearleads/app-contacts';
import { useLocation, useParams } from 'react-router-dom';
import { ClientContactsProvider } from '@/contexts/ClientContactsProvider';

export function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const autoEdit = (location.state as { autoEdit?: boolean } | null)?.autoEdit;

  return (
    <ClientContactsProvider>
      <ContactDetailPage contactId={id ?? ''} autoEdit={autoEdit} />
    </ClientContactsProvider>
  );
}
