import { useContactsContext, useContactsUI } from '../context';
import { useContactNewForm } from '../hooks';
import {
  ContactNewForm,
  EmailAddressesSection,
  PhoneNumbersSection
} from '../components/contact-new';

export function ContactNewPage() {
  const { databaseState, t } = useContactsContext();
  const { isUnlocked, isLoading } = databaseState;
  const { BackLink, InlineUnlock } = useContactsUI();

  const form = useContactNewForm();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackLink
          defaultTo="/contacts"
          defaultLabel={t('backToContacts')}
        />
      </div>

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          {t('loadingDatabase')}
        </div>
      )}

      {!isLoading && !isUnlocked && (
        <InlineUnlock description={t('createContact')} />
      )}

      {form.error && (
        <div className="whitespace-pre-line rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
          {form.error}
        </div>
      )}

      {isUnlocked && (
        <div className="space-y-6">
          <ContactNewForm form={form} />

          <EmailAddressesSection
            emailsForm={form.emailsForm}
            onEmailChange={form.handleEmailChange}
            onEmailPrimaryChange={form.handleEmailPrimaryChange}
            onDeleteEmail={form.handleDeleteEmail}
            onAddEmail={form.handleAddEmail}
          />

          <PhoneNumbersSection
            phonesForm={form.phonesForm}
            onPhoneChange={form.handlePhoneChange}
            onPhonePrimaryChange={form.handlePhonePrimaryChange}
            onDeletePhone={form.handleDeletePhone}
            onAddPhone={form.handleAddPhone}
          />
        </div>
      )}
    </div>
  );
}
