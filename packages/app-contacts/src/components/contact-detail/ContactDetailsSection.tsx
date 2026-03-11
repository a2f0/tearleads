import { Calendar } from 'lucide-react';
import { useContactsContext } from '../../context';
import type { ContactInfo } from './types';

interface ContactDetailsSectionProps {
  contact: ContactInfo;
}

export function ContactDetailsSection({ contact }: ContactDetailsSectionProps) {
  const { t, formatDate } = useContactsContext();

  return (
    <div className="rounded-lg border">
      <div className="border-b px-4 py-3">
        <h2 className="font-semibold">{t('details')}</h2>
      </div>
      <div className="divide-y">
        <div className="flex items-center gap-3 px-4 py-3">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground text-sm">{t('created')}</span>
          <span className="ml-auto text-sm">
            {formatDate(contact.createdAt)}
          </span>
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground text-sm">{t('updated')}</span>
          <span className="ml-auto text-sm">
            {formatDate(contact.updatedAt)}
          </span>
        </div>
      </div>
    </div>
  );
}
