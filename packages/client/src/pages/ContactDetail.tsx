import { and, asc, desc, eq } from 'drizzle-orm';
import {
  Cake,
  Calendar,
  Download,
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
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getDatabase, getDatabaseAdapter } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { contactEmails, contactPhones, contacts } from '@/db/schema';
import { useContactsExport } from '@/hooks/useContactsExport';
import { formatDate } from '@/lib/utils';

interface ContactInfo {
  id: string;
  firstName: string;
  lastName: string | null;
  birthday: string | null;
  createdAt: Date;
  updatedAt: Date;
  deleted: boolean;
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

export function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const { isUnlocked, isLoading } = useDatabaseContext();
  const [contact, setContact] = useState<ContactInfo | null>(null);
  const [emails, setEmails] = useState<ContactEmail[]>([]);
  const [phones, setPhones] = useState<ContactPhone[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const autoEditTriggered = useRef(false);
  const [formData, setFormData] = useState<ContactFormData | null>(null);
  const [emailsForm, setEmailsForm] = useState<EmailFormData[]>([]);
  const [phonesForm, setPhonesForm] = useState<PhoneFormData[]>([]);
  const [saving, setSaving] = useState(false);

  // Export functionality
  const { exportContact, exporting } = useContactsExport();

  const handleExport = useCallback(async () => {
    if (!id) return;
    try {
      await exportContact(id);
    } catch (err) {
      console.error('Failed to export contact:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id, exportContact]);

  const fetchContact = useCallback(async () => {
    if (!isUnlocked || !id) return;

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();

      const [contactResult, emailsResult, phonesResult] = await Promise.all([
        db
          .select()
          .from(contacts)
          .where(and(eq(contacts.id, id), eq(contacts.deleted, false)))
          .limit(1),
        db
          .select()
          .from(contactEmails)
          .where(eq(contactEmails.contactId, id))
          .orderBy(desc(contactEmails.isPrimary), asc(contactEmails.email)),
        db
          .select()
          .from(contactPhones)
          .where(eq(contactPhones.contactId, id))
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
  }, [isUnlocked, id]);

  useEffect(() => {
    if (isUnlocked && id) {
      fetchContact();
    }
  }, [isUnlocked, id, fetchContact]);

  const displayName = contact
    ? `${contact.firstName}${contact.lastName ? ` ${contact.lastName}` : ''}`
    : '';

  // Enter edit mode
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

  // Auto-enter edit mode if navigated with autoEdit state
  useEffect(() => {
    const state = location.state as { autoEdit?: boolean } | null;
    if (
      state?.autoEdit &&
      contact &&
      !autoEditTriggered.current &&
      !isEditing
    ) {
      autoEditTriggered.current = true;
      handleEditClick();
    }
  }, [contact, location.state, isEditing, handleEditClick]);

  // Cancel and discard changes
  const handleCancel = useCallback(() => {
    setFormData(null);
    setEmailsForm([]);
    setPhonesForm([]);
    setIsEditing(false);
    setError(null);
  }, []);

  // Update form field
  const handleFormChange = useCallback(
    (field: keyof ContactFormData, value: string) => {
      setFormData((prev) => (prev ? { ...prev, [field]: value } : null));
    },
    []
  );

  // Update email field
  const handleEmailChange = useCallback(
    (emailId: string, field: keyof EmailFormData, value: string | boolean) => {
      setEmailsForm((prev) =>
        prev.map((e) => (e.id === emailId ? { ...e, [field]: value } : e))
      );
    },
    []
  );

  // Set primary email (unset others)
  const handleEmailPrimaryChange = useCallback((emailId: string) => {
    setEmailsForm((prev) =>
      prev.map((e) => ({
        ...e,
        isPrimary: e.id === emailId
      }))
    );
  }, []);

  // Mark email for deletion
  const handleDeleteEmail = useCallback((emailId: string) => {
    setEmailsForm((prev) =>
      prev.map((e) => (e.id === emailId ? { ...e, isDeleted: true } : e))
    );
  }, []);

  // Add new email
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

  // Update phone field
  const handlePhoneChange = useCallback(
    (phoneId: string, field: keyof PhoneFormData, value: string | boolean) => {
      setPhonesForm((prev) =>
        prev.map((p) => (p.id === phoneId ? { ...p, [field]: value } : p))
      );
    },
    []
  );

  // Set primary phone (unset others)
  const handlePhonePrimaryChange = useCallback((phoneId: string) => {
    setPhonesForm((prev) =>
      prev.map((p) => ({
        ...p,
        isPrimary: p.id === phoneId
      }))
    );
  }, []);

  // Mark phone for deletion
  const handleDeletePhone = useCallback((phoneId: string) => {
    setPhonesForm((prev) =>
      prev.map((p) => (p.id === phoneId ? { ...p, isDeleted: true } : p))
    );
  }, []);

  // Add new phone
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

  // Save changes
  const handleSave = useCallback(async () => {
    if (!contact || !formData || !id) return;

    // Validation
    if (!formData.firstName.trim()) {
      setError('First name is required');
      return;
    }

    const activeEmails = emailsForm.filter((e) => !e.isDeleted);
    for (const email of activeEmails) {
      if (!email.email.trim()) {
        setError('Email address cannot be empty');
        return;
      }
    }

    const activePhones = phonesForm.filter((p) => !p.isDeleted);
    for (const phone of activePhones) {
      if (!phone.phoneNumber.trim()) {
        setError('Phone number cannot be empty');
        return;
      }
    }

    setSaving(true);
    setError(null);

    try {
      const adapter = getDatabaseAdapter();
      await adapter.beginTransaction();

      try {
        const db = getDatabase();
        const now = new Date();

        // 1. Update contact basic info
        await db
          .update(contacts)
          .set({
            firstName: formData.firstName.trim(),
            lastName: formData.lastName.trim() || null,
            birthday: formData.birthday.trim() || null,
            updatedAt: now
          })
          .where(eq(contacts.id, id));

        // 2. Process emails
        const emailsToDelete = emailsForm.filter(
          (e) => e.isDeleted && !e.isNew
        );
        const emailsToInsert = emailsForm.filter(
          (e) => e.isNew && !e.isDeleted
        );
        const emailsToUpdate = emailsForm.filter(
          (e) => !e.isNew && !e.isDeleted
        );

        for (const email of emailsToDelete) {
          await db.delete(contactEmails).where(eq(contactEmails.id, email.id));
        }

        for (const email of emailsToInsert) {
          await db.insert(contactEmails).values({
            id: email.id,
            contactId: id,
            email: email.email.trim(),
            label: email.label.trim() || null,
            isPrimary: email.isPrimary
          });
        }

        for (const email of emailsToUpdate) {
          await db
            .update(contactEmails)
            .set({
              email: email.email.trim(),
              label: email.label.trim() || null,
              isPrimary: email.isPrimary
            })
            .where(eq(contactEmails.id, email.id));
        }

        // 3. Process phones
        const phonesToDelete = phonesForm.filter(
          (p) => p.isDeleted && !p.isNew
        );
        const phonesToInsert = phonesForm.filter(
          (p) => p.isNew && !p.isDeleted
        );
        const phonesToUpdate = phonesForm.filter(
          (p) => !p.isNew && !p.isDeleted
        );

        for (const phone of phonesToDelete) {
          await db.delete(contactPhones).where(eq(contactPhones.id, phone.id));
        }

        for (const phone of phonesToInsert) {
          await db.insert(contactPhones).values({
            id: phone.id,
            contactId: id,
            phoneNumber: phone.phoneNumber.trim(),
            label: phone.label.trim() || null,
            isPrimary: phone.isPrimary
          });
        }

        for (const phone of phonesToUpdate) {
          await db
            .update(contactPhones)
            .set({
              phoneNumber: phone.phoneNumber.trim(),
              label: phone.label.trim() || null,
              isPrimary: phone.isPrimary
            })
            .where(eq(contactPhones.id, phone.id));
        }

        await adapter.commitTransaction();

        // Refresh data and exit edit mode
        await fetchContact();
        setIsEditing(false);
        setFormData(null);
        setEmailsForm([]);
        setPhonesForm([]);
      } catch (err) {
        await adapter.rollbackTransaction();
        throw err;
      }
    } catch (err) {
      console.error('Failed to save contact:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [contact, formData, id, emailsForm, phonesForm, fetchContact]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackLink defaultTo="/contacts" defaultLabel="Back to Contacts" />
      </div>

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="this contact" />}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      {isUnlocked && loading && (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading contact...
        </div>
      )}

      {isUnlocked && !loading && contact && (
        <div className="space-y-6">
          {/* Contact Header */}
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-muted">
              <User className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              {isEditing && formData ? (
                <div className="space-y-3">
                  <Input
                    type="text"
                    value={formData.firstName}
                    onChange={(e) =>
                      handleFormChange('firstName', e.target.value)
                    }
                    placeholder="First name *"
                    data-testid="edit-first-name"
                  />
                  <Input
                    type="text"
                    value={formData.lastName}
                    onChange={(e) =>
                      handleFormChange('lastName', e.target.value)
                    }
                    placeholder="Last name"
                    data-testid="edit-last-name"
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
                      className="flex-1"
                      data-testid="edit-birthday"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <h1 className="font-bold text-2xl tracking-tight">
                    {displayName}
                  </h1>
                  {contact.birthday && (
                    <p className="mt-1 flex items-center gap-1 text-muted-foreground text-sm">
                      <Cake className="h-4 w-4" />
                      {contact.birthday}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="shrink-0">
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancel}
                    disabled={saving}
                    data-testid="cancel-button"
                  >
                    <X className="mr-2 h-4 w-4" />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={saving}
                    data-testid="save-button"
                  >
                    {saving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Save
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExport}
                    disabled={exporting}
                    data-testid="export-button"
                  >
                    {exporting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-2 h-4 w-4" />
                    )}
                    Export
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleEditClick}
                    data-testid="edit-button"
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Email Addresses */}
          {isEditing ? (
            <div className="rounded-lg border">
              <div className="border-b px-4 py-3">
                <h2 className="font-semibold">Email Addresses</h2>
              </div>
              <div className="divide-y">
                {emailsForm
                  .filter((e) => !e.isDeleted)
                  .map((email) => (
                    <div
                      key={email.id}
                      className="flex items-center gap-2 px-4 py-3"
                    >
                      <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <Input
                        type="email"
                        value={email.email}
                        onChange={(e) =>
                          handleEmailChange(email.id, 'email', e.target.value)
                        }
                        placeholder="Email address"
                        className="min-w-0 flex-1"
                        data-testid={`edit-email-${email.id}`}
                      />
                      <Input
                        type="text"
                        value={email.label}
                        onChange={(e) =>
                          handleEmailChange(email.id, 'label', e.target.value)
                        }
                        placeholder="Label"
                        className="w-24"
                        data-testid={`edit-email-label-${email.id}`}
                      />
                      <label className="flex shrink-0 items-center gap-1 text-base">
                        <input
                          type="radio"
                          name="primaryEmail"
                          checked={email.isPrimary}
                          onChange={() => handleEmailPrimaryChange(email.id)}
                          className="h-5 w-5"
                        />
                        Primary
                      </label>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteEmail(email.id)}
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
                  onClick={handleAddEmail}
                  data-testid="add-email-button"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Email
                </Button>
              </div>
            </div>
          ) : (
            emails.length > 0 && (
              <div className="rounded-lg border">
                <div className="border-b px-4 py-3">
                  <h2 className="font-semibold">Email Addresses</h2>
                </div>
                <div className="divide-y">
                  {emails.map((email) => (
                    <div
                      key={email.id}
                      className="flex items-center gap-3 px-4 py-3"
                    >
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
                          Primary
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          )}

          {/* Phone Numbers */}
          {isEditing ? (
            <div className="rounded-lg border">
              <div className="border-b px-4 py-3">
                <h2 className="font-semibold">Phone Numbers</h2>
              </div>
              <div className="divide-y">
                {phonesForm
                  .filter((p) => !p.isDeleted)
                  .map((phone) => (
                    <div
                      key={phone.id}
                      className="flex items-center gap-2 px-4 py-3"
                    >
                      <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
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
                        placeholder="Phone number"
                        className="min-w-0 flex-1"
                        data-testid={`edit-phone-${phone.id}`}
                      />
                      <Input
                        type="text"
                        value={phone.label}
                        onChange={(e) =>
                          handlePhoneChange(phone.id, 'label', e.target.value)
                        }
                        placeholder="Label"
                        className="w-24"
                        data-testid={`edit-phone-label-${phone.id}`}
                      />
                      <label className="flex shrink-0 items-center gap-1 text-base">
                        <input
                          type="radio"
                          name="primaryPhone"
                          checked={phone.isPrimary}
                          onChange={() => handlePhonePrimaryChange(phone.id)}
                          className="h-5 w-5"
                        />
                        Primary
                      </label>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeletePhone(phone.id)}
                        className="h-8 w-8 shrink-0"
                        data-testid={`delete-phone-${phone.id}`}
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
                  onClick={handleAddPhone}
                  data-testid="add-phone-button"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Phone
                </Button>
              </div>
            </div>
          ) : (
            phones.length > 0 && (
              <div className="rounded-lg border">
                <div className="border-b px-4 py-3">
                  <h2 className="font-semibold">Phone Numbers</h2>
                </div>
                <div className="divide-y">
                  {phones.map((phone) => (
                    <div
                      key={phone.id}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <a
                          href={`tel:${phone.phoneNumber}`}
                          className="text-sm hover:underline"
                        >
                          {phone.phoneNumber}
                        </a>
                        {phone.label && (
                          <span className="ml-2 text-muted-foreground text-xs">
                            ({phone.label})
                          </span>
                        )}
                      </div>
                      {phone.isPrimary && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary text-xs">
                          Primary
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          )}

          <div className="rounded-lg border">
            <div className="border-b px-4 py-3">
              <h2 className="font-semibold">Details</h2>
            </div>
            <div className="divide-y">
              <div className="flex items-center gap-3 px-4 py-3">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-sm">Created</span>
                <span className="ml-auto text-sm">
                  {formatDate(contact.createdAt)}
                </span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-sm">Updated</span>
                <span className="ml-auto text-sm">
                  {formatDate(contact.updatedAt)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
