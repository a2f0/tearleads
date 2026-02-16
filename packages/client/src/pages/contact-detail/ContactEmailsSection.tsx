import { Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ContactEditableListSection } from './ContactEditableListSection';
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

  return (
    <ContactEditableListSection
      isEditing={isEditing}
      items={emails}
      formItems={emailsForm}
      icon={Mail}
      sectionTitle={t('emailAddresses')}
      inputType="email"
      inputPlaceholder={t('emailAddress')}
      addButtonLabel={t('addEmail')}
      primaryRadioName="primaryEmail"
      valueField="email"
      getDisplayValue={(item) => item.email}
      getLinkHref={(value) => `mailto:${value}`}
      testIdPrefix="email"
      onValueChange={onEmailChange}
      onPrimaryChange={onEmailPrimaryChange}
      onDelete={onDeleteEmail}
      onAdd={onAddEmail}
    />
  );
}
