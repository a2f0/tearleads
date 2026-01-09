import {
  ArrowLeft,
  Cake,
  Loader2,
  Mail,
  Phone,
  Plus,
  Save,
  Trash2,
  User,
  X
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getDatabase, getDatabaseAdapter } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { contactEmails, contactPhones, contacts } from '@/db/schema';

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
}

interface PhoneFormData {
  id: string;
  phoneNumber: string;
  label: string;
  isPrimary: boolean;
}

export function ContactNew() {
  const navigate = useNavigate();
  const { isUnlocked, isLoading } = useDatabaseContext();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    if (!formData.firstName.trim()) {
      setError('First name is required');
      return;
    }

    const emailRegex = /\S+@\S+\.\S+/;
    for (const email of emailsForm) {
      if (!email.email.trim()) {
        setError('Email address cannot be empty');
        return;
      }
      if (!emailRegex.test(email.email)) {
        setError('Please enter a valid email address');
        return;
      }
    }

    for (const phone of phonesForm) {
      if (!phone.phoneNumber.trim()) {
        setError('Phone number cannot be empty');
        return;
      }
    }

    setSaving(true);
    setError(null);

    const contactId = crypto.randomUUID();

    try {
      const adapter = getDatabaseAdapter();
      await adapter.beginTransaction();

      try {
        const db = getDatabase();
        const now = new Date();

        await db.insert(contacts).values({
          id: contactId,
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim() || null,
          birthday: formData.birthday.trim() || null,
          createdAt: now,
          updatedAt: now,
          deleted: false
        });

        for (const email of emailsForm) {
          await db.insert(contactEmails).values({
            id: email.id,
            contactId,
            email: email.email.trim(),
            label: email.label.trim() || null,
            isPrimary: email.isPrimary
          });
        }

        for (const phone of phonesForm) {
          await db.insert(contactPhones).values({
            id: phone.id,
            contactId,
            phoneNumber: phone.phoneNumber.trim(),
            label: phone.label.trim() || null,
            isPrimary: phone.isPrimary
          });
        }

        await adapter.commitTransaction();

        navigate(`/contacts/${contactId}`);
      } catch (err) {
        await adapter.rollbackTransaction();
        throw err;
      }
    } catch (err) {
      console.error('Failed to create contact:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [formData, emailsForm, phonesForm, navigate]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          to="/contacts"
          className="inline-flex items-center text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Contacts
        </Link>
      </div>

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && (
        <InlineUnlock description="create a contact" />
      )}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      {isUnlocked && (
        <div className="space-y-6">
          {/* Contact Header */}
          <div className="rounded-lg border p-4">
            {/* Title row with avatar */}
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted">
                <User className="h-6 w-6 text-muted-foreground" />
              </div>
              <h1 className="font-bold text-xl tracking-tight">New Contact</h1>
            </div>

            {/* Form fields */}
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="new-first-name"
                    className="mb-1.5 block font-medium text-sm"
                  >
                    First name <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="new-first-name"
                    type="text"
                    value={formData.firstName}
                    onChange={(e) =>
                      handleFormChange('firstName', e.target.value)
                    }
                    placeholder="Enter first name"
                    data-testid="new-first-name"
                  />
                </div>
                <div>
                  <label
                    htmlFor="new-last-name"
                    className="mb-1.5 block font-medium text-sm"
                  >
                    Last name
                  </label>
                  <Input
                    id="new-last-name"
                    type="text"
                    value={formData.lastName}
                    onChange={(e) =>
                      handleFormChange('lastName', e.target.value)
                    }
                    placeholder="Enter last name"
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
                  Birthday
                </label>
                <Input
                  id="new-birthday"
                  type="date"
                  value={formData.birthday}
                  onChange={(e) => handleFormChange('birthday', e.target.value)}
                  className="max-w-xs"
                  data-testid="new-birthday"
                />
              </div>
            </div>

            {/* Action buttons */}
            <div className="mt-6 flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={saving}
                className="w-full sm:w-auto"
                data-testid="cancel-button"
              >
                <X className="mr-2 h-4 w-4" />
                Cancel
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
                Save Contact
              </Button>
            </div>
          </div>

          {/* Email Addresses */}
          <div className="rounded-lg border">
            <div className="border-b px-4 py-3">
              <h2 className="font-semibold">Email Addresses</h2>
            </div>
            <div className="divide-y">
              {emailsForm.map((email) => (
                <div key={email.id} className="space-y-3 px-4 py-3">
                  {/* Email input row */}
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <Input
                      type="email"
                      value={email.email}
                      onChange={(e) =>
                        handleEmailChange(email.id, 'email', e.target.value)
                      }
                      placeholder="Email address"
                      className="min-w-0 flex-1"
                      data-testid={`new-email-${email.id}`}
                    />
                  </div>
                  {/* Label and options row */}
                  <div className="flex flex-wrap items-center gap-2 pl-6">
                    <Input
                      type="text"
                      value={email.label}
                      onChange={(e) =>
                        handleEmailChange(email.id, 'label', e.target.value)
                      }
                      placeholder="Label (e.g., Work)"
                      className="w-full sm:w-32"
                      data-testid={`new-email-label-${email.id}`}
                    />
                    <label className="flex shrink-0 items-center gap-1.5 text-sm">
                      <input
                        type="radio"
                        name="primaryEmail"
                        checked={email.isPrimary}
                        onChange={() => handleEmailPrimaryChange(email.id)}
                        className="h-4 w-4"
                      />
                      Primary
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteEmail(email.id)}
                      className="ml-auto h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      data-testid={`delete-email-${email.id}`}
                      aria-label="Delete email"
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      Remove
                    </Button>
                  </div>
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

          {/* Phone Numbers */}
          <div className="rounded-lg border">
            <div className="border-b px-4 py-3">
              <h2 className="font-semibold">Phone Numbers</h2>
            </div>
            <div className="divide-y">
              {phonesForm.map((phone) => (
                <div key={phone.id} className="space-y-3 px-4 py-3">
                  {/* Phone input row */}
                  <div className="flex items-center gap-2">
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
                      data-testid={`new-phone-${phone.id}`}
                    />
                  </div>
                  {/* Label and options row */}
                  <div className="flex flex-wrap items-center gap-2 pl-6">
                    <Input
                      type="text"
                      value={phone.label}
                      onChange={(e) =>
                        handlePhoneChange(phone.id, 'label', e.target.value)
                      }
                      placeholder="Label (e.g., Mobile)"
                      className="w-full sm:w-32"
                      data-testid={`new-phone-label-${phone.id}`}
                    />
                    <label className="flex shrink-0 items-center gap-1.5 text-sm">
                      <input
                        type="radio"
                        name="primaryPhone"
                        checked={phone.isPrimary}
                        onChange={() => handlePhonePrimaryChange(phone.id)}
                        className="h-4 w-4"
                      />
                      Primary
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeletePhone(phone.id)}
                      className="ml-auto h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      data-testid={`delete-phone-${phone.id}`}
                      aria-label="Delete phone"
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      Remove
                    </Button>
                  </div>
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
        </div>
      )}
    </div>
  );
}
