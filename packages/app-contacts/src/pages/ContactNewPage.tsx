import { Cake, Loader2, Save, User, X } from 'lucide-react';
import { useContactsContext, useContactsUI } from '../context';
import { useContactNewForm } from '../hooks';
import { EmailAddressesSection } from '../components/contact-new';
import { PhoneNumbersSection } from '../components/contact-new';

export function ContactNewPage() {
  const { databaseState, t } = useContactsContext();
  const { isUnlocked, isLoading } = databaseState;
  const { Button, Input, BackLink, InlineUnlock } = useContactsUI();

  const {
    formData,
    emailsForm,
    phonesForm,
    saving,
    error,
    handleFormChange,
    handleEmailChange,
    handleEmailPrimaryChange,
    handleDeleteEmail,
    handleAddEmail,
    handlePhoneChange,
    handlePhonePrimaryChange,
    handleDeletePhone,
    handleAddPhone,
    handleSave,
    handleCancel
  } = useContactNewForm();

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

      {error && (
        <div className="whitespace-pre-line rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      {isUnlocked && (
        <div className="space-y-6">
          <div className="rounded-lg border p-4">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted">
                <User className="h-6 w-6 text-muted-foreground" />
              </div>
              <h1 className="font-bold text-xl tracking-tight">
                {t('newContactTitle')}
              </h1>
            </div>

            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="new-first-name"
                    className="mb-1.5 block font-medium text-sm"
                  >
                    {t('firstNameRequired')}{' '}
                    <span className="text-destructive">*</span>
                  </label>
                  <Input
                    type="text"
                    value={formData.firstName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      handleFormChange('firstName', e.target.value)
                    }
                    placeholder={t('firstNameRequired')}
                    data-testid="new-first-name"
                  />
                </div>
                <div>
                  <label
                    htmlFor="new-last-name"
                    className="mb-1.5 block font-medium text-sm"
                  >
                    {t('lastName')}
                  </label>
                  <Input
                    type="text"
                    value={formData.lastName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      handleFormChange('lastName', e.target.value)
                    }
                    placeholder={t('lastName')}
                    data-testid="new-last-name"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="new-birthday"
                  className="mb-1.5 flex items-center gap-2 font-medium text-sm"
                >
                  <Cake className="h-5 w-5 text-muted-foreground" />
                  {t('birthdayPlaceholder')}
                </label>
                <Input
                  type="date"
                  value={formData.birthday}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    handleFormChange('birthday', e.target.value)
                  }
                  className="max-w-xs"
                  data-testid="new-birthday"
                />
              </div>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={saving}
                className="w-full sm:w-auto"
                data-testid="cancel-button"
              >
                <X className="mr-2 h-4 w-4" />
                {t('cancel')}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="w-full sm:w-auto"
                data-testid="save-button"
              >
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                {t('saveContact')}
              </Button>
            </div>
          </div>

          <EmailAddressesSection
            emailsForm={emailsForm}
            onEmailChange={handleEmailChange}
            onEmailPrimaryChange={handleEmailPrimaryChange}
            onDeleteEmail={handleDeleteEmail}
            onAddEmail={handleAddEmail}
          />

          <PhoneNumbersSection
            phonesForm={phonesForm}
            onPhoneChange={handlePhoneChange}
            onPhonePrimaryChange={handlePhonePrimaryChange}
            onDeletePhone={handleDeletePhone}
            onAddPhone={handleAddPhone}
          />
        </div>
      )}
    </div>
  );
}
