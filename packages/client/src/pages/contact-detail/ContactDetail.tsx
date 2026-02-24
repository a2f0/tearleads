import { Loader2 } from 'lucide-react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { BackLink } from '@/components/ui/back-link';
import { ContactDetailHeader } from './ContactDetailHeader';
import { ContactDetailsSection } from './ContactDetailsSection';
import { ContactEmailsSection } from './ContactEmailsSection';
import { ContactPhonesSection } from './ContactPhonesSection';
import { useContactDetail } from './useContactDetail';

export function ContactDetail() {
  const {
    isUnlocked,
    isLoading,
    contact,
    emails,
    phones,
    loading,
    error,
    isEditing,
    formData,
    emailsForm,
    phonesForm,
    saving,
    exporting,
    t,
    handleExport,
    handleEditClick,
    handleCancel,
    handleSave,
    handleFormChange,
    handleEmailChange,
    handleEmailPrimaryChange,
    handleDeleteEmail,
    handleAddEmail,
    handlePhoneChange,
    handlePhonePrimaryChange,
    handleDeletePhone,
    handleAddPhone
  } = useContactDetail();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackLink defaultTo="/contacts" defaultLabel={t('backToContacts')} />
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
