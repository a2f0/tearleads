import { ArrowLeft, Cake, Loader2, Save, User, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useOrg } from '@/contexts/OrgContext';
import { getDatabase, getDatabaseAdapter } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { runLocalWrite } from '@/db/localWrite';
import {
  contactEmails,
  contactPhones,
  contacts,
  vfsRegistry
} from '@/db/schema';
import { generateSessionKey, wrapSessionKey } from '@/hooks/vfs';
import { isLoggedIn, readStoredAuth } from '@/lib/authStorage';
import { queueItemUpsertAndFlush } from '@/lib/vfsItemSyncWriter';
import { EmailAddressesSection } from '@/pages/contact-new/EmailAddressesSection';
import { PhoneNumbersSection } from '@/pages/contact-new/PhoneNumbersSection';
import type {
  ContactFormData,
  EmailFormData,
  PhoneFormData
} from '@/pages/contact-new/types';

export function ContactNew() {
  const navigate = useNavigate();
  const { isUnlocked, isLoading } = useDatabaseContext();
  const { activeOrganizationId } = useOrg();
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
      let encryptedSessionKey: string | null = null;
      await runLocalWrite(async () => {
        const adapter = getDatabaseAdapter();
        await adapter.beginTransaction();
        try {
          const db = getDatabase();
          const now = new Date();
          const auth = readStoredAuth();

          await db.insert(contacts).values({
            id: contactId,
            firstName: formData.firstName.trim(),
            lastName: formData.lastName.trim() || null,
            birthday: formData.birthday.trim() || null,
            createdAt: now,
            updatedAt: now,
            deleted: false,
            organizationId: activeOrganizationId
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

          if (isLoggedIn()) {
            try {
              const sessionKey = generateSessionKey();
              encryptedSessionKey = await wrapSessionKey(sessionKey);
            } catch (err) {
              console.warn('Failed to wrap contact session key:', err);
            }
          }

          await db.insert(vfsRegistry).values({
            id: contactId,
            objectType: 'contact',
            ownerId: auth.user?.id ?? null,
            organizationId: activeOrganizationId,
            encryptedSessionKey,
            createdAt: now
          });

          await adapter.commitTransaction();
        } catch (err) {
          await adapter.rollbackTransaction();
          throw err;
        }
      });

      await queueItemUpsertAndFlush({
        itemId: contactId,
        objectType: 'contact',
        ...(encryptedSessionKey ? { encryptedSessionKey } : {}),
        payload: {
          id: contactId,
          objectType: 'contact',
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim() || null,
          birthday: formData.birthday.trim() || null,
          emails: emailsForm.map((email) => ({
            id: email.id,
            email: email.email.trim(),
            label: email.label.trim() || null,
            isPrimary: email.isPrimary
          })),
          phones: phonesForm.map((phone) => ({
            id: phone.id,
            phoneNumber: phone.phoneNumber.trim(),
            label: phone.label.trim() || null,
            isPrimary: phone.isPrimary
          })),
          deleted: false
        }
      });

      navigate(`/contacts/${contactId}`);
    } catch (err) {
      console.error('Failed to create contact:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [formData, emailsForm, phonesForm, navigate, activeOrganizationId]);

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
          <div className="rounded-lg border p-4">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted">
                <User className="h-6 w-6 text-muted-foreground" />
              </div>
              <h1 className="font-bold text-xl tracking-tight">New Contact</h1>
            </div>

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
