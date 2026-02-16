import { Mail, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ContactEmail, EmailFormData } from './types';

interface ContactEmailsSectionProps {
  isEditing: boolean;
  emails: ContactEmail[];
  emailsForm: EmailFormData[];
  onEmailChange: (
    emailId: string,
    field: keyof EmailFormData,
    value: string | boolean
  ) => void;
  onEmailPrimaryChange: (emailId: string) => void;
  onDeleteEmail: (emailId: string) => void;
  onAddEmail: () => void;
}

export function ContactEmailsSection({
  isEditing,
  emails,
  emailsForm,
  onEmailChange,
  onEmailPrimaryChange,
  onDeleteEmail,
  onAddEmail
}: ContactEmailsSectionProps) {
  const { t } = useTranslation('contacts');

  if (isEditing) {
    return (
      <div className="rounded-lg border">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">{t('emailAddresses')}</h2>
        </div>
        <div className="divide-y">
          {emailsForm
            .filter((e) => !e.isDeleted)
            .map((email) => (
              <div key={email.id} className="flex items-center gap-2 px-4 py-3">
                <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Input
                  type="email"
                  value={email.email}
                  onChange={(e) =>
                    onEmailChange(email.id, 'email', e.target.value)
                  }
                  placeholder={t('emailAddress')}
                  className="min-w-0 flex-1"
                  data-testid={`edit-email-${email.id}`}
                />
                <Input
                  type="text"
                  value={email.label}
                  onChange={(e) =>
                    onEmailChange(email.id, 'label', e.target.value)
                  }
                  placeholder={t('label')}
                  className="w-24"
                  data-testid={`edit-email-label-${email.id}`}
                />
                <label className="flex shrink-0 items-center gap-1 text-base">
                  <input
                    type="radio"
                    name="primaryEmail"
                    checked={email.isPrimary}
                    onChange={() => onEmailPrimaryChange(email.id)}
                    className="h-5 w-5"
                  />
                  {t('primary')}
                </label>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDeleteEmail(email.id)}
                  className="h-8 w-8 shrink-0"
                  data-testid={`delete-email-${email.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
        </div>
        <div className="border-t px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onAddEmail}
            data-testid="add-email-button"
          >
            <Plus className="mr-2 h-4 w-4" />
            {t('addEmail')}
          </Button>
        </div>
      </div>
    );
  }

  if (emails.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border">
      <div className="border-b px-4 py-3">
        <h2 className="font-semibold">{t('emailAddresses')}</h2>
      </div>
      <div className="divide-y">
        {emails.map((email) => (
          <div key={email.id} className="flex items-center gap-3 px-4 py-3">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <a
                href={`mailto:${email.email}`}
                className="text-sm hover:underline"
              >
                {email.email}
              </a>
              {email.label && (
                <span className="ml-2 text-muted-foreground text-xs">
                  ({email.label})
                </span>
              )}
            </div>
            {email.isPrimary && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary text-xs">
                {t('primary')}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
