import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useParams } from 'react-router-dom';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { BackLink } from '@/components/ui/back-link';
import { getDatabase, getDatabaseAdapter } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { runLocalWrite } from '@/db/localWrite';
import { contactEmails, contactPhones, contacts } from '@/db/schema';
import { useContactsExport } from '@/hooks/contacts';
import { ContactDetailHeader } from './ContactDetailHeader';
import { ContactDetailsSection } from './ContactDetailsSection';
import { ContactEmailsSection } from './ContactEmailsSection';
import { ContactPhonesSection } from './ContactPhonesSection';
import type {
  ContactEmail,
  ContactFormData,
  ContactInfo,
  ContactPhone,
  EmailFormData,
  PhoneFormData
} from './types';

export function ContactDetail() {
  const { t } = useTranslation('contacts');
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
        setError(t('contactNotFound'));
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
  }, [isUnlocked, id, t]);

  useEffect(() => {
    if (isUnlocked && id) {
      fetchContact();
    }
  }, [isUnlocked, id, fetchContact]);

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
      setError(t('firstNameIsRequired'));
      return;
    }

    const activeEmails = emailsForm.filter((e) => !e.isDeleted);
    for (const email of activeEmails) {
      if (!email.email.trim()) {
        setError(t('emailCannotBeEmpty'));
        return;
      }
    }

    const activePhones = phonesForm.filter((p) => !p.isDeleted);
    for (const phone of activePhones) {
      if (!phone.phoneNumber.trim()) {
        setError(t('phoneCannotBeEmpty'));
        return;
      }
    }

    setSaving(true);
    setError(null);

    try {
      await runLocalWrite(async () => {
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

          if (emailsToDelete.length > 0) {
            await db.delete(contactEmails).where(
              inArray(
                contactEmails.id,
                emailsToDelete.map((e) => e.id)
              )
            );
          }

          if (emailsToInsert.length > 0) {
            await db.insert(contactEmails).values(
              emailsToInsert.map((email) => ({
                id: email.id,
                contactId: id,
                email: email.email.trim(),
                label: email.label.trim() || null,
                isPrimary: email.isPrimary
              }))
            );
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

          if (phonesToDelete.length > 0) {
            await db.delete(contactPhones).where(
              inArray(
                contactPhones.id,
                phonesToDelete.map((p) => p.id)
              )
            );
          }

          if (phonesToInsert.length > 0) {
            await db.insert(contactPhones).values(
              phonesToInsert.map((phone) => ({
                id: phone.id,
                contactId: id,
                phoneNumber: phone.phoneNumber.trim(),
                label: phone.label.trim() || null,
                isPrimary: phone.isPrimary
              }))
            );
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
        } catch (err) {
          await adapter.rollbackTransaction();
          throw err;
        }
      });

      // Refresh data and exit edit mode
      await fetchContact();
      setIsEditing(false);
      setFormData(null);
      setEmailsForm([]);
      setPhonesForm([]);
    } catch (err) {
      console.error('Failed to save contact:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [contact, formData, id, emailsForm, phonesForm, fetchContact, t]);

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
