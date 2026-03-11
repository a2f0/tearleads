import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import {
  ContactDetailHeader,
  ContactDetailsSection,
  ContactEmailsSection,
  ContactPhonesSection,
  useContactDetailData,
  useContactDetailForm
} from '../components/contact-detail';
import { useContactsContext, useContactsUI } from '../context';
import { useContactsExport } from '../hooks';

interface ContactDetailPageProps {
  contactId: string;
  autoEdit?: boolean | undefined;
}

export function ContactDetailPage({
  contactId,
  autoEdit
}: ContactDetailPageProps) {
  const { databaseState, navigate, t } = useContactsContext();
  const { isUnlocked, isLoading } = databaseState;
  const { BackLink, InlineUnlock } = useContactsUI();
  const { exportContact, exporting } = useContactsExport();
  const autoEditTriggered = useRef(false);

  const { contact, emails, phones, loading, error, setError, fetchContact } =
    useContactDetailData(contactId);

  const onDeleted = useCallback(() => {
    navigate('/contacts');
  }, [navigate]);

  const {
    isEditing,
    formData,
    emailsForm,
    phonesForm,
    saving,
    handleEditClick,
    handleCancel,
    handleFormChange,
    handleEmailChange,
    handleEmailPrimaryChange,
    handleDeleteEmail,
    handleAddEmail,
    handlePhoneChange,
    handlePhonePrimaryChange,
    handleDeletePhone,
    handleAddPhone,
    handleSave
  } = useContactDetailForm(
    contact,
    emails,
    phones,
    contactId,
    fetchContact,
    setError,
    onDeleted
  );

  const handleExport = useCallback(async () => {
    if (!contactId) return;
    try {
      await exportContact(contactId);
    } catch (err) {
      console.error('Failed to export contact:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [contactId, exportContact, setError]);

  useEffect(() => {
    if (autoEdit && contact && !autoEditTriggered.current && !isEditing) {
      autoEditTriggered.current = true;
      handleEditClick();
    }
  }, [autoEdit, contact, isEditing, handleEditClick]);

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
        <InlineUnlock description={t('thisContact')} />
      )}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      {isUnlocked && loading && (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          {t('loadingContact')}
        </div>
      )}

      {isUnlocked && !loading && contact && (
        <div className="space-y-6">
          <ContactDetailHeader
            contact={contact}
            isEditing={isEditing}
            formData={formData}
            saving={saving}
            exporting={exporting}
            onEditClick={handleEditClick}
            onCancel={handleCancel}
            onSave={handleSave}
            onExport={handleExport}
            onFormChange={handleFormChange}
          />

          <ContactEmailsSection
            isEditing={isEditing}
            emails={emails}
            emailsForm={emailsForm}
            onEmailChange={handleEmailChange}
            onEmailPrimaryChange={handleEmailPrimaryChange}
            onDeleteEmail={handleDeleteEmail}
            onAddEmail={handleAddEmail}
          />

          <ContactPhonesSection
            isEditing={isEditing}
            phones={phones}
            phonesForm={phonesForm}
            onPhoneChange={handlePhoneChange}
            onPhonePrimaryChange={handlePhonePrimaryChange}
            onDeletePhone={handleDeletePhone}
            onAddPhone={handleAddPhone}
          />

          <ContactDetailsSection contact={contact} />
        </div>
      )}
    </div>
  );
}
