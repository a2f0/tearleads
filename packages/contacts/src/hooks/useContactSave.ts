import { contactEmails, contactPhones, contacts } from '@tearleads/db/sqlite';
import { eq, inArray } from 'drizzle-orm';
import { useCallback, useState } from 'react';
import { useContactsContext } from '../context';
import type {
  ContactFormData,
  EmailFormData,
  PhoneFormData
} from '../lib/validation';

interface SaveContactParams {
  contactId?: string;
  formData: ContactFormData;
  emails: EmailFormData[];
  phones: PhoneFormData[];
}

interface SaveContactResult {
  success: boolean;
  contactId?: string;
  error?: string;
}

/**
 * Hook for saving contacts (create and update operations).
 * Extracts common database transaction logic for both new and existing contacts.
 */
export function useContactSave() {
  const { getDatabase, getDatabaseAdapter, registerInVfs } =
    useContactsContext();
  const [saving, setSaving] = useState(false);

  /**
   * Create a new contact with emails and phones.
   */
  const createContact = useCallback(
    async (params: SaveContactParams): Promise<SaveContactResult> => {
      const { formData, emails, phones } = params;
      const contactId = crypto.randomUUID();

      setSaving(true);

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

          if (emails.length > 0) {
            await db.insert(contactEmails).values(
              emails.map((email) => ({
                id: email.id,
                contactId,
                email: email.email.trim(),
                label: email.label.trim() || null,
                isPrimary: email.isPrimary
              }))
            );
          }

          if (phones.length > 0) {
            await db.insert(contactPhones).values(
              phones.map((phone) => ({
                id: phone.id,
                contactId,
                phoneNumber: phone.phoneNumber.trim(),
                label: phone.label.trim() || null,
                isPrimary: phone.isPrimary
              }))
            );
          }

          await adapter.commitTransaction();

          // Register in VFS after successful commit
          const vfsResult = await registerInVfs(contactId, now);
          if (!vfsResult.success) {
            console.warn('VFS registration failed:', vfsResult.error);
          }

          return { success: true, contactId };
        } catch (err) {
          await adapter.rollbackTransaction();
          throw err;
        }
      } catch (err) {
        console.error('Failed to create contact:', err);
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err)
        };
      } finally {
        setSaving(false);
      }
    },
    [getDatabase, getDatabaseAdapter, registerInVfs]
  );

  /**
   * Update an existing contact with CRUD operations for emails and phones.
   */
  const updateContact = useCallback(
    async (params: SaveContactParams): Promise<SaveContactResult> => {
      const { contactId, formData, emails, phones } = params;

      if (!contactId) {
        return { success: false, error: 'Contact ID is required for update' };
      }

      setSaving(true);

      try {
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
            .where(eq(contacts.id, contactId));

          // Handle emails
          const emailsToDelete = emails.filter((e) => e.isDeleted && !e.isNew);
          const emailsToInsert = emails.filter((e) => e.isNew && !e.isDeleted);
          const emailsToUpdate = emails.filter((e) => !e.isNew && !e.isDeleted);

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
                contactId,
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

          // Handle phones
          const phonesToDelete = phones.filter((p) => p.isDeleted && !p.isNew);
          const phonesToInsert = phones.filter((p) => p.isNew && !p.isDeleted);
          const phonesToUpdate = phones.filter((p) => !p.isNew && !p.isDeleted);

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
                contactId,
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
          return { success: true, contactId };
        } catch (err) {
          await adapter.rollbackTransaction();
          throw err;
        }
      } catch (err) {
        console.error('Failed to update contact:', err);
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err)
        };
      } finally {
        setSaving(false);
      }
    },
    [getDatabase, getDatabaseAdapter]
  );

  return { createContact, updateContact, saving };
}
