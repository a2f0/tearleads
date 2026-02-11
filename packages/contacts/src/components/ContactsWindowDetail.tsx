import { contactEmails, contactPhones, contacts } from '@tearleads/db/sqlite';
import { and, asc, desc, eq } from 'drizzle-orm';
import {
  ArrowLeft,
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
import { useCallback, useEffect, useState } from 'react';
import { useContactsContext, useContactsUI } from '../context';
import { useContactSave } from '../hooks';
import { validateContactForm } from '../lib';

interface ContactInfo {
  id: string;
  firstName: string;
  lastName: string | null;
  birthday: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ContactEmail {
  id: string;
  contactId: string;
  email: string;
  label: string | null;
  isPrimary: boolean;
}

interface ContactPhone {
  id: string;
  contactId: string;
  phoneNumber: string;
  label: string | null;
  isPrimary: boolean;
}

interface ContactFormData {
  firstName: string;
  lastName: string;
  birthday: string;
}

interface EmailFormData {
  id: string;
  email: string;
  label: string;
  isPrimary: boolean;
  isNew?: boolean;
  isDeleted?: boolean;
}

interface PhoneFormData {
  id: string;
  phoneNumber: string;
  label: string;
  isPrimary: boolean;
  isNew?: boolean;
  isDeleted?: boolean;
}

interface ContactsWindowDetailProps {
  contactId: string;
  onBack: () => void;
  onDeleted: () => void;
}

export function ContactsWindowDetail({
  contactId,
  onBack,
  onDeleted
}: ContactsWindowDetailProps) {
  const { databaseState, getDatabase, formatDate } = useContactsContext();
  const { isUnlocked, isLoading } = databaseState;
  const { Button, Input, InlineUnlock } = useContactsUI();
  const { updateContact, saving } = useContactSave();

  const [contact, setContact] = useState<ContactInfo | null>(null);
  const [emails, setEmails] = useState<ContactEmail[]>([]);
  const [phones, setPhones] = useState<ContactPhone[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<ContactFormData | null>(null);
  const [emailsForm, setEmailsForm] = useState<EmailFormData[]>([]);
  const [phonesForm, setPhonesForm] = useState<PhoneFormData[]>([]);

  const fetchContact = useCallback(async () => {
    if (!isUnlocked || !contactId) return;

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();

      const [contactResult, emailsResult, phonesResult] = await Promise.all([
        db
          .select()
          .from(contacts)
          .where(and(eq(contacts.id, contactId), eq(contacts.deleted, false)))
          .limit(1),
        db
          .select()
          .from(contactEmails)
          .where(eq(contactEmails.contactId, contactId))
          .orderBy(desc(contactEmails.isPrimary), asc(contactEmails.email)),
        db
          .select()
          .from(contactPhones)
          .where(eq(contactPhones.contactId, contactId))
          .orderBy(
            desc(contactPhones.isPrimary),
            asc(contactPhones.phoneNumber)
          )
      ]);

      const foundContact = contactResult[0];
      if (!foundContact) {
        setError('Contact not found');
        return;
      }

      setContact(foundContact);
      setEmails(emailsResult);
      setPhones(phonesResult);
    } catch (err) {
      console.error('Failed to fetch contact:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, contactId, getDatabase]);

  useEffect(() => {
    if (isUnlocked && contactId) {
      fetchContact();
    }
  }, [isUnlocked, contactId, fetchContact]);

  const displayName = contact
    ? `${contact.firstName}${contact.lastName ? ` ${contact.lastName}` : ''}`
    : '';

  const handleEditClick = useCallback(() => {
    if (!contact) return;
    setFormData({
      firstName: contact.firstName,
      lastName: contact.lastName ?? '',
      birthday: contact.birthday ?? ''
    });
    setEmailsForm(
      emails.map((e) => ({
        id: e.id,
        email: e.email,
        label: e.label ?? '',
        isPrimary: e.isPrimary
      }))
    );
    setPhonesForm(
      phones.map((p) => ({
        id: p.id,
        phoneNumber: p.phoneNumber,
        label: p.label ?? '',
        isPrimary: p.isPrimary
      }))
    );
    setIsEditing(true);
    setError(null);
  }, [contact, emails, phones]);

  const handleCancel = useCallback(() => {
    setFormData(null);
    setEmailsForm([]);
    setPhonesForm([]);
    setIsEditing(false);
    setError(null);
  }, []);

  const handleFormChange = useCallback(
    (field: keyof ContactFormData, value: string) => {
      setFormData((prev) => (prev ? { ...prev, [field]: value } : null));
    },
    []
  );

  const handleEmailChange = useCallback(
    (emailId: string, field: keyof EmailFormData, value: string | boolean) => {
      setEmailsForm((prev) =>
        prev.map((e) => (e.id === emailId ? { ...e, [field]: value } : e))
      );
    },
    []
  );

  const handleEmailPrimaryChange = useCallback((emailId: string) => {
    setEmailsForm((prev) =>
      prev.map((e) => ({
        ...e,
        isPrimary: e.id === emailId
      }))
    );
  }, []);

  const handleDeleteEmail = useCallback((emailId: string) => {
    setEmailsForm((prev) => {
      const isPrimaryDeleted = prev.find((e) => e.id === emailId)?.isPrimary;
      const updatedEmails = prev.map((e) =>
        e.id === emailId ? { ...e, isDeleted: true } : e
      );

      if (isPrimaryDeleted) {
        const firstVisible = updatedEmails.find((e) => !e.isDeleted);
        if (firstVisible) {
          return updatedEmails.map((e) => ({
            ...e,
            isPrimary: e.id === firstVisible.id
          }));
        }
      }

      return updatedEmails;
    });
  }, []);

  const handleAddEmail = useCallback(() => {
    setEmailsForm((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        email: '',
        label: '',
        isPrimary: prev.filter((e) => !e.isDeleted).length === 0,
        isNew: true
      }
    ]);
  }, []);

  const handlePhoneChange = useCallback(
    (phoneId: string, field: keyof PhoneFormData, value: string | boolean) => {
      setPhonesForm((prev) =>
        prev.map((p) => (p.id === phoneId ? { ...p, [field]: value } : p))
      );
    },
    []
  );

  const handlePhonePrimaryChange = useCallback((phoneId: string) => {
    setPhonesForm((prev) =>
      prev.map((p) => ({
        ...p,
        isPrimary: p.id === phoneId
      }))
    );
  }, []);

  const handleDeletePhone = useCallback((phoneId: string) => {
    setPhonesForm((prev) => {
      const isPrimaryDeleted = prev.find((p) => p.id === phoneId)?.isPrimary;
      const updatedPhones = prev.map((p) =>
        p.id === phoneId ? { ...p, isDeleted: true } : p
      );

      if (isPrimaryDeleted) {
        const firstVisible = updatedPhones.find((p) => !p.isDeleted);
        if (firstVisible) {
          return updatedPhones.map((p) => ({
            ...p,
            isPrimary: p.id === firstVisible.id
          }));
        }
      }

      return updatedPhones;
    });
  }, []);

  const handleAddPhone = useCallback(() => {
    setPhonesForm((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        phoneNumber: '',
        label: '',
        isPrimary: prev.filter((p) => !p.isDeleted).length === 0,
        isNew: true
      }
    ]);
  }, []);

  const handleSave = useCallback(async () => {
    if (!contact || !formData || !contactId) return;

    const validation = validateContactForm(formData, emailsForm, phonesForm);
    if (!validation.isValid) {
      setError(validation.errors.join('\n'));
      return;
    }

    setError(null);
    const result = await updateContact({
      contactId,
      formData,
      emails: emailsForm,
      phones: phonesForm
    });

    if (result.success) {
      await fetchContact();
      setIsEditing(false);
      setFormData(null);
      setEmailsForm([]);
      setPhonesForm([]);
    } else if (result.error) {
      setError(result.error);
    }
  }, [
    contact,
    formData,
    contactId,
    emailsForm,
    phonesForm,
    fetchContact,
    updateContact
  ]);

  const handleDelete = useCallback(async () => {
    if (!contact) return;

    setDeleting(true);
    try {
      const db = getDatabase();
      await db
        .update(contacts)
        .set({ deleted: true, updatedAt: new Date() })
        .where(eq(contacts.id, contact.id));

      onDeleted();
    } catch (err) {
      console.error('Failed to delete contact:', err);
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }, [contact, onDeleted, getDatabase]);

  return (
    <div className="flex h-full flex-col overflow-auto p-3">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="h-7 px-2"
          data-testid="window-contact-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
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
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && (
        <div className="mt-3">
          <InlineUnlock description="this contact" />
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
          Loading contact...
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
                    placeholder="First name *"
                    className="h-8 text-base"
                    data-testid="window-edit-first-name"
                  />
                  <Input
                    type="text"
                    value={formData.lastName}
                    onChange={(e) =>
                      handleFormChange('lastName', e.target.value)
                    }
                    placeholder="Last name"
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
                      placeholder="Birthday (YYYY-MM-DD)"
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
                <h3 className="font-medium">Email Addresses</h3>
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
                        placeholder="Email"
                        className="h-7 min-w-0 flex-1 text-base"
                      />
                      <Input
                        type="text"
                        value={email.label}
                        onChange={(e) =>
                          handleEmailChange(email.id, 'label', e.target.value)
                        }
                        placeholder="Label"
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
                  Add
                </Button>
              </div>
            </div>
          ) : (
            emails.length > 0 && (
              <div className="rounded-lg border text-xs">
                <div className="border-b px-3 py-2">
                  <h3 className="font-medium">Email Addresses</h3>
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
                          Primary
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
                <h3 className="font-medium">Phone Numbers</h3>
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
                        placeholder="Phone"
                        className="h-7 min-w-0 flex-1 text-base"
                      />
                      <Input
                        type="text"
                        value={phone.label}
                        onChange={(e) =>
                          handlePhoneChange(phone.id, 'label', e.target.value)
                        }
                        placeholder="Label"
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
                  Add
                </Button>
              </div>
            </div>
          ) : (
            phones.length > 0 && (
              <div className="rounded-lg border text-xs">
                <div className="border-b px-3 py-2">
                  <h3 className="font-medium">Phone Numbers</h3>
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
                          Primary
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
                <h3 className="font-medium">Details</h3>
              </div>
              <div className="divide-y">
                <div className="flex items-center gap-2 px-3 py-2">
                  <Calendar className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground">Created</span>
                  <span className="ml-auto">
                    {formatDate(contact.createdAt)}
                  </span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2">
                  <Calendar className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground">Updated</span>
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
