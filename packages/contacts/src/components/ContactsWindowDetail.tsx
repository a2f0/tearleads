import {
  Cake,
  Calendar,
  Loader2,
  Mail,
  Pencil,
  Phone,
  Plus,
  Save,
  Trash2,
  User,
  X
} from 'lucide-react';
import { useContactsContext, useContactsUI } from '../context';
import {
  type ContactsWindowDetailProps,
  useContactDetailData,
  useContactDetailForm
} from './contact-detail';

export function ContactsWindowDetail({
  contactId,
  onDeleted
}: ContactsWindowDetailProps) {
  const { databaseState, formatDate, t } = useContactsContext();
  const { isUnlocked, isLoading } = databaseState;
  const { Button, Input, InlineUnlock } = useContactsUI();

  const { contact, emails, phones, loading, error, setError, fetchContact } =
    useContactDetailData(contactId);

  const {
    isEditing,
    formData,
    emailsForm,
    phonesForm,
    saving,
    deleting,
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
    handleSave,
    handleDelete
  } = useContactDetailForm(
    contact,
    emails,
    phones,
    contactId,
    fetchContact,
    setError,
    onDeleted
  );

  const displayName = contact
    ? `${contact.firstName}${contact.lastName ? ` ${contact.lastName}` : ''}`
    : '';

  return (
    <div className="flex h-full flex-col overflow-auto p-3">
      <div className="flex items-center gap-2">
        {contact && !isEditing && (
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleEditClick}
              className="h-7 px-2"
              data-testid="window-contact-edit"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
              className="h-7 px-2 text-destructive hover:text-destructive"
              data-testid="window-contact-delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
        {isEditing && (
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={saving}
              className="h-7 px-2"
              data-testid="window-contact-cancel"
            >
              <X className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving}
              className="h-7 px-2"
              data-testid="window-contact-save"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
            </Button>
          </div>
        )}
      </div>

      {isLoading && (
        <div className="mt-3 rounded-lg border p-4 text-center text-muted-foreground text-xs">
          {t('loadingDatabase')}
        </div>
      )}

      {!isLoading && !isUnlocked && (
        <div className="mt-3">
          <InlineUnlock description={t('thisContact')} />
        </div>
      )}

      {error && (
        <div className="mt-3 whitespace-pre-line rounded-lg border border-destructive bg-destructive/10 p-2 text-destructive text-xs">
          {error}
        </div>
      )}

      {isUnlocked && loading && (
        <div className="mt-3 flex items-center justify-center gap-2 rounded-lg border p-4 text-muted-foreground text-xs">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('loadingContact')}
        </div>
      )}

      {isUnlocked && !loading && !error && contact && (
        <div className="mt-3 space-y-3">
          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
              <User className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              {isEditing && formData ? (
                <div className="space-y-2">
                  <Input
                    type="text"
                    value={formData.firstName}
                    onChange={(e) =>
                      handleFormChange('firstName', e.target.value)
                    }
                    placeholder={t('firstNameRequired')}
                    className="h-8 text-base"
                    data-testid="window-edit-first-name"
                  />
                  <Input
                    type="text"
                    value={formData.lastName}
                    onChange={(e) =>
                      handleFormChange('lastName', e.target.value)
                    }
                    placeholder={t('lastName')}
                    className="h-8 text-base"
                    data-testid="window-edit-last-name"
                  />
                  <div className="flex items-center gap-2">
                    <Cake className="h-4 w-4 text-muted-foreground" />
                    <Input
                      type="text"
                      value={formData.birthday}
                      onChange={(e) =>
                        handleFormChange('birthday', e.target.value)
                      }
                      placeholder={t('birthdayPlaceholder')}
                      className="h-8 flex-1 text-base"
                      data-testid="window-edit-birthday"
                    />
                  </div>
                </div>
              ) : (
                <>
                  <h2 className="font-semibold text-sm">{displayName}</h2>
                  {contact.birthday && (
                    <p className="flex items-center gap-1 text-muted-foreground text-xs">
                      <Cake className="h-3 w-3" />
                      {contact.birthday}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Emails */}
          {isEditing ? (
            <div className="rounded-lg border text-xs">
              <div className="border-b px-3 py-2">
                <h3 className="font-medium">{t('emailAddresses')}</h3>
              </div>
              <div className="divide-y">
                {emailsForm
                  .filter((e) => !e.isDeleted)
                  .map((email) => (
                    <div
                      key={email.id}
                      className="flex items-center gap-2 px-3 py-2"
                    >
                      <Mail className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <Input
                        type="email"
                        value={email.email}
                        onChange={(e) =>
                          handleEmailChange(email.id, 'email', e.target.value)
                        }
                        placeholder={t('email')}
                        className="h-7 min-w-0 flex-1 text-base"
                      />
                      <Input
                        type="text"
                        value={email.label}
                        onChange={(e) =>
                          handleEmailChange(email.id, 'label', e.target.value)
                        }
                        placeholder={t('label')}
                        className="h-7 w-16 text-base"
                      />
                      <label className="flex shrink-0 items-center gap-1">
                        <input
                          type="radio"
                          name="primaryEmail"
                          checked={email.isPrimary}
                          onChange={() => handleEmailPrimaryChange(email.id)}
                          className="h-4 w-4"
                        />
                      </label>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteEmail(email.id)}
                        className="h-6 w-6 shrink-0"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
              </div>
              <div className="border-t px-3 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleAddEmail}
                  className="h-6 px-2 text-xs"
                >
                  <Plus className="mr-1 h-3 w-3" />
                  {t('add')}
                </Button>
              </div>
            </div>
          ) : (
            emails.length > 0 && (
              <div className="rounded-lg border text-xs">
                <div className="border-b px-3 py-2">
                  <h3 className="font-medium">{t('emailAddresses')}</h3>
                </div>
                <div className="divide-y">
                  {emails.map((email) => (
                    <div
                      key={email.id}
                      className="flex items-center gap-2 px-3 py-2"
                    >
                      <Mail className="h-3 w-3 text-muted-foreground" />
                      <a
                        href={`mailto:${email.email}`}
                        className="hover:underline"
                      >
                        {email.email}
                      </a>
                      {email.label && (
                        <span className="text-muted-foreground">
                          ({email.label})
                        </span>
                      )}
                      {email.isPrimary && (
                        <span className="ml-auto rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                          {t('primary')}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          )}

          {/* Phones */}
          {isEditing ? (
            <div className="rounded-lg border text-xs">
              <div className="border-b px-3 py-2">
                <h3 className="font-medium">{t('phoneNumbers')}</h3>
              </div>
              <div className="divide-y">
                {phonesForm
                  .filter((p) => !p.isDeleted)
                  .map((phone) => (
                    <div
                      key={phone.id}
                      className="flex items-center gap-2 px-3 py-2"
                    >
                      <Phone className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <Input
                        type="tel"
                        value={phone.phoneNumber}
                        onChange={(e) =>
                          handlePhoneChange(
                            phone.id,
                            'phoneNumber',
                            e.target.value
                          )
                        }
                        placeholder={t('phone')}
                        className="h-7 min-w-0 flex-1 text-base"
                      />
                      <Input
                        type="text"
                        value={phone.label}
                        onChange={(e) =>
                          handlePhoneChange(phone.id, 'label', e.target.value)
                        }
                        placeholder={t('label')}
                        className="h-7 w-16 text-base"
                      />
                      <label className="flex shrink-0 items-center gap-1">
                        <input
                          type="radio"
                          name="primaryPhone"
                          checked={phone.isPrimary}
                          onChange={() => handlePhonePrimaryChange(phone.id)}
                          className="h-4 w-4"
                        />
                      </label>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeletePhone(phone.id)}
                        className="h-6 w-6 shrink-0"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
              </div>
              <div className="border-t px-3 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleAddPhone}
                  className="h-6 px-2 text-xs"
                >
                  <Plus className="mr-1 h-3 w-3" />
                  {t('add')}
                </Button>
              </div>
            </div>
          ) : (
            phones.length > 0 && (
              <div className="rounded-lg border text-xs">
                <div className="border-b px-3 py-2">
                  <h3 className="font-medium">{t('phoneNumbers')}</h3>
                </div>
                <div className="divide-y">
                  {phones.map((phone) => (
                    <div
                      key={phone.id}
                      className="flex items-center gap-2 px-3 py-2"
                    >
                      <Phone className="h-3 w-3 text-muted-foreground" />
                      <a
                        href={`tel:${phone.phoneNumber}`}
                        className="hover:underline"
                      >
                        {phone.phoneNumber}
                      </a>
                      {phone.label && (
                        <span className="text-muted-foreground">
                          ({phone.label})
                        </span>
                      )}
                      {phone.isPrimary && (
                        <span className="ml-auto rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                          {t('primary')}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          )}

          {/* Details */}
          {!isEditing && (
            <div className="rounded-lg border text-xs">
              <div className="border-b px-3 py-2">
                <h3 className="font-medium">{t('details')}</h3>
              </div>
              <div className="divide-y">
                <div className="flex items-center gap-2 px-3 py-2">
                  <Calendar className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground">{t('created')}</span>
                  <span className="ml-auto">
                    {formatDate(contact.createdAt)}
                  </span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2">
                  <Calendar className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground">{t('updated')}</span>
                  <span className="ml-auto">
                    {formatDate(contact.updatedAt)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
