import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useParams } from 'react-router-dom';
import { getDatabase, getDatabaseAdapter } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { runLocalWrite } from '@/db/localWrite';
import { contactEmails, contactPhones, contacts } from '@/db/schema';
import { useContactsExport } from '@/hooks/contacts';
import { queueItemUpsertAndFlush } from '@/lib/vfsItemSyncWriter';
import type {
  ContactEmail,
  ContactFormData,
  ContactInfo,
  ContactPhone,
  EmailFormData,
  PhoneFormData
} from './types';

interface UseContactDetailResult {
  isUnlocked: boolean;
  isLoading: boolean;
  contact: ContactInfo | null;
  emails: ContactEmail[];
  phones: ContactPhone[];
  loading: boolean;
  error: string | null;
  isEditing: boolean;
  formData: ContactFormData | null;
  emailsForm: EmailFormData[];
  phonesForm: PhoneFormData[];
  saving: boolean;
  exporting: boolean;
  t: (key: string) => string;
  handleExport: () => Promise<void>;
  handleEditClick: () => void;
  handleCancel: () => void;
  handleSave: () => Promise<void>;
  handleFormChange: (field: keyof ContactFormData, value: string) => void;
  handleEmailChange: (
    emailId: string,
    field: keyof EmailFormData,
    value: string | boolean
  ) => void;
  handleEmailPrimaryChange: (emailId: string) => void;
  handleDeleteEmail: (emailId: string) => void;
  handleAddEmail: () => void;
  handlePhoneChange: (
    phoneId: string,
    field: keyof PhoneFormData,
    value: string | boolean
  ) => void;
  handlePhonePrimaryChange: (phoneId: string) => void;
  handleDeletePhone: (phoneId: string) => void;
  handleAddPhone: () => void;
}

export function useContactDetail(): UseContactDetailResult {
  const { t } = useTranslation('contacts');
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const { isUnlocked, isLoading } = useDatabaseContext();
  const [contact, setContact] = useState<ContactInfo | null>(null);
  const [emails, setEmails] = useState<ContactEmail[]>([]);
  const [phones, setPhones] = useState<ContactPhone[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const autoEditTriggered = useRef(false);
  const [formData, setFormData] = useState<ContactFormData | null>(null);
  const [emailsForm, setEmailsForm] = useState<EmailFormData[]>([]);
  const [phonesForm, setPhonesForm] = useState<PhoneFormData[]>([]);
  const [saving, setSaving] = useState(false);
  const { exportContact, exporting } = useContactsExport();

  const handleExport = useCallback(async () => {
    if (!id) {
      return;
    }
    try {
      await exportContact(id);
    } catch (err) {
      console.error('Failed to export contact:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id, exportContact]);

  const fetchContact = useCallback(async () => {
    if (!isUnlocked || !id) {
      return;
    }

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
      void fetchContact();
    }
  }, [isUnlocked, id, fetchContact]);

  const handleEditClick = useCallback(() => {
    if (!contact) {
      return;
    }
    setFormData({
      firstName: contact.firstName,
      lastName: contact.lastName ?? '',
      birthday: contact.birthday ?? ''
    });
    setEmailsForm(
      emails.map((email) => ({
        id: email.id,
        email: email.email,
        label: email.label ?? '',
        isPrimary: email.isPrimary
      }))
    );
    setPhonesForm(
      phones.map((phone) => ({
        id: phone.id,
        phoneNumber: phone.phoneNumber,
        label: phone.label ?? '',
        isPrimary: phone.isPrimary
      }))
    );
    setIsEditing(true);
    setError(null);
  }, [contact, emails, phones]);

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

  const handleCancel = useCallback(() => {
    setFormData(null);
    setEmailsForm([]);
    setPhonesForm([]);
    setIsEditing(false);
    setError(null);
  }, []);

  const handleFormChange = useCallback(
    (field: keyof ContactFormData, value: string) => {
      setFormData((previous) =>
        previous ? { ...previous, [field]: value } : null
      );
    },
    []
  );

  const handleEmailChange = useCallback(
    (emailId: string, field: keyof EmailFormData, value: string | boolean) => {
      setEmailsForm((previous) =>
        previous.map((email) =>
          email.id === emailId ? { ...email, [field]: value } : email
        )
      );
    },
    []
  );

  const handleEmailPrimaryChange = useCallback((emailId: string) => {
    setEmailsForm((previous) =>
      previous.map((email) => ({
        ...email,
        isPrimary: email.id === emailId
      }))
    );
  }, []);

  const handleDeleteEmail = useCallback((emailId: string) => {
    setEmailsForm((previous) =>
      previous.map((email) =>
        email.id === emailId ? { ...email, isDeleted: true } : email
      )
    );
  }, []);

  const handleAddEmail = useCallback(() => {
    setEmailsForm((previous) => [
      ...previous,
      {
        id: crypto.randomUUID(),
        email: '',
        label: '',
        isPrimary: previous.filter((email) => !email.isDeleted).length === 0,
        isNew: true
      }
    ]);
  }, []);

  const handlePhoneChange = useCallback(
    (phoneId: string, field: keyof PhoneFormData, value: string | boolean) => {
      setPhonesForm((previous) =>
        previous.map((phone) =>
          phone.id === phoneId ? { ...phone, [field]: value } : phone
        )
      );
    },
    []
  );

  const handlePhonePrimaryChange = useCallback((phoneId: string) => {
    setPhonesForm((previous) =>
      previous.map((phone) => ({
        ...phone,
        isPrimary: phone.id === phoneId
      }))
    );
  }, []);

  const handleDeletePhone = useCallback((phoneId: string) => {
    setPhonesForm((previous) =>
      previous.map((phone) =>
        phone.id === phoneId ? { ...phone, isDeleted: true } : phone
      )
    );
  }, []);

  const handleAddPhone = useCallback(() => {
    setPhonesForm((previous) => [
      ...previous,
      {
        id: crypto.randomUUID(),
        phoneNumber: '',
        label: '',
        isPrimary: previous.filter((phone) => !phone.isDeleted).length === 0,
        isNew: true
      }
    ]);
  }, []);

  const handleSave = useCallback(async () => {
    if (!contact || !formData || !id) {
      return;
    }

    if (!formData.firstName.trim()) {
      setError(t('firstNameIsRequired'));
      return;
    }

    const activeEmails = emailsForm.filter((email) => !email.isDeleted);
    for (const email of activeEmails) {
      if (!email.email.trim()) {
        setError(t('emailCannotBeEmpty'));
        return;
      }
    }

    const activePhones = phonesForm.filter((phone) => !phone.isDeleted);
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

          await db
            .update(contacts)
            .set({
              firstName: formData.firstName.trim(),
              lastName: formData.lastName.trim() || null,
              birthday: formData.birthday.trim() || null,
              updatedAt: now
            })
            .where(eq(contacts.id, id));

          const emailsToDelete = emailsForm.filter(
            (email) => email.isDeleted && !email.isNew
          );
          const emailsToInsert = emailsForm.filter(
            (email) => email.isNew && !email.isDeleted
          );
          const emailsToUpdate = emailsForm.filter(
            (email) => !email.isNew && !email.isDeleted
          );

          if (emailsToDelete.length > 0) {
            await db.delete(contactEmails).where(
              inArray(
                contactEmails.id,
                emailsToDelete.map((email) => email.id)
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

          const phonesToDelete = phonesForm.filter(
            (phone) => phone.isDeleted && !phone.isNew
          );
          const phonesToInsert = phonesForm.filter(
            (phone) => phone.isNew && !phone.isDeleted
          );
          const phonesToUpdate = phonesForm.filter(
            (phone) => !phone.isNew && !phone.isDeleted
          );

          if (phonesToDelete.length > 0) {
            await db.delete(contactPhones).where(
              inArray(
                contactPhones.id,
                phonesToDelete.map((phone) => phone.id)
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

      await queueItemUpsertAndFlush({
        itemId: id,
        objectType: 'contact',
        payload: {
          id,
          objectType: 'contact',
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim() || null,
          birthday: formData.birthday.trim() || null,
          emails: activeEmails.map((email) => ({
            id: email.id,
            email: email.email.trim(),
            label: email.label.trim() || null,
            isPrimary: email.isPrimary
          })),
          phones: activePhones.map((phone) => ({
            id: phone.id,
            phoneNumber: phone.phoneNumber.trim(),
            label: phone.label.trim() || null,
            isPrimary: phone.isPrimary
          })),
          deleted: false
        }
      });

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

  return {
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
  };
}
