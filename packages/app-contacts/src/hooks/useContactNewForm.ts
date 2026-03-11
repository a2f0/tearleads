/**
 * Hook for new contact form state and handlers.
 */

import { useCallback, useState } from 'react';
import { useContactsContext } from '../context';
import { validateContactForm } from '../lib';
import type {
  ContactFormData,
  EmailFormData,
  PhoneFormData
} from '../lib/validation';
import { useContactSave } from './useContactSave';

export interface ContactNewFormState {
  formData: ContactFormData;
  emailsForm: EmailFormData[];
  phonesForm: PhoneFormData[];
  saving: boolean;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
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
  handleCancel: () => void;
}

export function useContactNewForm(): ContactNewFormState {
  const { navigate } = useContactsContext();
  const { createContact, saving } = useContactSave();
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState<ContactFormData>({
    firstName: '',
    lastName: '',
    birthday: ''
  });
  const [emailsForm, setEmailsForm] = useState<EmailFormData[]>([]);
  const [phonesForm, setPhonesForm] = useState<PhoneFormData[]>([]);

  const handleFormChange = useCallback(
    (field: keyof ContactFormData, value: string) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
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
    setEmailsForm((prev) => prev.filter((e) => e.id !== emailId));
  }, []);

  const handleAddEmail = useCallback(() => {
    setEmailsForm((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        email: '',
        label: '',
        isPrimary: prev.length === 0
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
    setPhonesForm((prev) => prev.filter((p) => p.id !== phoneId));
  }, []);

  const handleAddPhone = useCallback(() => {
    setPhonesForm((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        phoneNumber: '',
        label: '',
        isPrimary: prev.length === 0
      }
    ]);
  }, []);

  const handleCancel = useCallback(() => {
    navigate('/contacts');
  }, [navigate]);

  const handleSave = useCallback(async () => {
    const validation = validateContactForm(formData, emailsForm, phonesForm);
    if (!validation.isValid) {
      setError(validation.errors.join('\n'));
      return;
    }

    setError(null);
    const result = await createContact({
      formData,
      emails: emailsForm,
      phones: phonesForm
    });

    if (result.success && result.contactId) {
      navigate(`/contacts/${result.contactId}`);
    } else if (result.error) {
      setError(result.error);
    }
  }, [formData, emailsForm, phonesForm, navigate, createContact]);

  return {
    formData,
    emailsForm,
    phonesForm,
    saving,
    error,
    setError,
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
  };
}
