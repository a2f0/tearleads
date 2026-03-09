/**
 * Hook for contact detail form state and handlers.
 */

import { contacts } from '@tearleads/db/sqlite';
import { eq } from 'drizzle-orm';
import { useCallback, useState } from 'react';
import { useContactsContext } from '../../context';
import { useContactSave } from '../../hooks';
import { validateContactForm } from '../../lib';
import type {
  ContactEmail,
  ContactFormData,
  ContactInfo,
  ContactPhone,
  EmailFormData,
  PhoneFormData
} from './types';

interface UseContactDetailFormResult {
  isEditing: boolean;
  formData: ContactFormData | null;
  emailsForm: EmailFormData[];
  phonesForm: PhoneFormData[];
  saving: boolean;
  deleting: boolean;
  handleEditClick: () => void;
  handleCancel: () => void;
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
  handleSave: () => Promise<void>;
  handleDelete: () => Promise<void>;
}

export function useContactDetailForm(
  contact: ContactInfo | null,
  emails: ContactEmail[],
  phones: ContactPhone[],
  contactId: string,
  fetchContact: () => Promise<void>,
  setError: (error: string | null) => void,
  onDeleted: () => void
): UseContactDetailFormResult {
  const { getDatabase } = useContactsContext();
  const { updateContact, saving } = useContactSave();

  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<ContactFormData | null>(null);
  const [emailsForm, setEmailsForm] = useState<EmailFormData[]>([]);
  const [phonesForm, setPhonesForm] = useState<PhoneFormData[]>([]);
  const [deleting, setDeleting] = useState(false);

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
  }, [contact, emails, phones, setError]);

  const handleCancel = useCallback(() => {
    setFormData(null);
    setEmailsForm([]);
    setPhonesForm([]);
    setIsEditing(false);
    setError(null);
  }, [setError]);

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
    updateContact,
    setError
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
  }, [contact, onDeleted, getDatabase, setError]);

  return {
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
  };
}
