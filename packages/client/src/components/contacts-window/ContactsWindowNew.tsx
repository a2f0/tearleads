import {
  ArrowLeft,
  Cake,
  Loader2,
  Mail,
  Phone,
  Plus,
  Save,
  Trash2,
  User
} from 'lucide-react';
import { useCallback, useState } from 'react';
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

interface ContactsWindowNewProps {
  onBack: () => void;
  onCreated: (contactId: string) => void;
}

export function ContactsWindowNew({
  onBack,
  onCreated
}: ContactsWindowNewProps) {
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

        onCreated(contactId);
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
  }, [formData, emailsForm, phonesForm, onCreated]);

  return (
    <div className="flex h-full flex-col overflow-auto p-3">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="h-7 px-2"
          data-testid="window-new-contact-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="font-semibold text-sm">New Contact</h2>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving}
          className="ml-auto h-7 px-2"
          data-testid="window-new-contact-save"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
        </Button>
      </div>

      {isLoading && (
        <div className="mt-3 rounded-lg border p-4 text-center text-muted-foreground text-xs">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && (
        <div className="mt-3">
          <InlineUnlock description="create a contact" />
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg border border-destructive bg-destructive/10 p-2 text-destructive text-xs">
          {error}
        </div>
      )}

      {isUnlocked && (
        <div className="mt-3 space-y-3">
          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
              <User className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <Input
                type="text"
                value={formData.firstName}
                onChange={(e) => handleFormChange('firstName', e.target.value)}
                placeholder="First name *"
                className="h-8 text-sm"
                data-testid="window-new-first-name"
              />
              <Input
                type="text"
                value={formData.lastName}
                onChange={(e) => handleFormChange('lastName', e.target.value)}
                placeholder="Last name"
                className="h-8 text-sm"
                data-testid="window-new-last-name"
              />
              <div className="flex items-center gap-2">
                <Cake className="h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  value={formData.birthday}
                  onChange={(e) => handleFormChange('birthday', e.target.value)}
                  placeholder="Birthday (YYYY-MM-DD)"
                  className="h-8 flex-1 text-sm"
                  data-testid="window-new-birthday"
                />
              </div>
            </div>
          </div>

          {/* Emails */}
          <div className="rounded-lg border text-xs">
            <div className="border-b px-3 py-2">
              <h3 className="font-medium">Email Addresses</h3>
            </div>
            <div className="divide-y">
              {emailsForm.map((email) => (
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
                    className="h-7 min-w-0 flex-1 text-xs"
                    data-testid={`window-new-email-${email.id}`}
                  />
                  <Input
                    type="text"
                    value={email.label}
                    onChange={(e) =>
                      handleEmailChange(email.id, 'label', e.target.value)
                    }
                    placeholder="Label"
                    className="h-7 w-16 text-xs"
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
                data-testid="window-new-add-email"
              >
                <Plus className="mr-1 h-3 w-3" />
                Add
              </Button>
            </div>
          </div>

          {/* Phones */}
          <div className="rounded-lg border text-xs">
            <div className="border-b px-3 py-2">
              <h3 className="font-medium">Phone Numbers</h3>
            </div>
            <div className="divide-y">
              {phonesForm.map((phone) => (
                <div
                  key={phone.id}
                  className="flex items-center gap-2 px-3 py-2"
                >
                  <Phone className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <Input
                    type="tel"
                    value={phone.phoneNumber}
                    onChange={(e) =>
                      handlePhoneChange(phone.id, 'phoneNumber', e.target.value)
                    }
                    placeholder="Phone"
                    className="h-7 min-w-0 flex-1 text-xs"
                    data-testid={`window-new-phone-${phone.id}`}
                  />
                  <Input
                    type="text"
                    value={phone.label}
                    onChange={(e) =>
                      handlePhoneChange(phone.id, 'label', e.target.value)
                    }
                    placeholder="Label"
                    className="h-7 w-16 text-xs"
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
                data-testid="window-new-add-phone"
              >
                <Plus className="mr-1 h-3 w-3" />
                Add
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
