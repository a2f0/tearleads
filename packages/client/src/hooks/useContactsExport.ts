import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { useCallback, useState } from 'react';
import { getDatabase } from '../db';
import { contactEmails, contactPhones, contacts } from '../db/schema';
import { saveFile } from '../lib/file-utils';
import {
  generateVCard,
  generateVCardFilename,
  generateVCards,
  type VCardContact
} from '../lib/vcard';

export function useContactsExport() {
  const [exporting, setExporting] = useState(false);

  /**
   * Export a single contact by ID to a VCF file.
   */
  const exportContact = useCallback(
    async (contactId: string): Promise<void> => {
      setExporting(true);

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

        const contact = contactResult[0];
        if (!contact) {
          throw new Error('Contact not found');
        }

        const vcardContact: VCardContact = {
          id: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          birthday: contact.birthday,
          emails: emailsResult.map((e) => ({
            email: e.email,
            label: e.label,
            isPrimary: e.isPrimary
          })),
          phones: phonesResult.map((p) => ({
            phoneNumber: p.phoneNumber,
            label: p.label,
            isPrimary: p.isPrimary
          }))
        };

        const vcardString = generateVCard(vcardContact);
        const filename = generateVCardFilename([vcardContact]);
        const data = new TextEncoder().encode(vcardString);

        await saveFile(data, filename);
      } finally {
        setExporting(false);
      }
    },
    []
  );

  /**
   * Export all non-deleted contacts to a single VCF file.
   */
  const exportAllContacts = useCallback(async (): Promise<void> => {
    setExporting(true);

    try {
      const db = getDatabase();

      // Fetch all non-deleted contacts
      const allContacts = await db
        .select()
        .from(contacts)
        .where(eq(contacts.deleted, false))
        .orderBy(asc(contacts.firstName));

      if (allContacts.length === 0) {
        throw new Error('No contacts to export');
      }

      // Fetch emails and phones in batch, filtered by contact IDs at the database level
      const contactIds = allContacts.map((c) => c.id);
      const [emailsResult, phonesResult] = await Promise.all([
        db
          .select()
          .from(contactEmails)
          .where(inArray(contactEmails.contactId, contactIds))
          .orderBy(desc(contactEmails.isPrimary), asc(contactEmails.email)),
        db
          .select()
          .from(contactPhones)
          .where(inArray(contactPhones.contactId, contactIds))
          .orderBy(
            desc(contactPhones.isPrimary),
            asc(contactPhones.phoneNumber)
          )
      ]);

      // Group emails and phones by contactId
      const emailsByContact = new Map<
        string,
        Array<{ email: string; label: string | null; isPrimary: boolean }>
      >();
      for (const email of emailsResult) {
        const emails = emailsByContact.get(email.contactId) ?? [];
        emails.push({
          email: email.email,
          label: email.label,
          isPrimary: email.isPrimary
        });
        emailsByContact.set(email.contactId, emails);
      }

      const phonesByContact = new Map<
        string,
        Array<{ phoneNumber: string; label: string | null; isPrimary: boolean }>
      >();
      for (const phone of phonesResult) {
        const phones = phonesByContact.get(phone.contactId) ?? [];
        phones.push({
          phoneNumber: phone.phoneNumber,
          label: phone.label,
          isPrimary: phone.isPrimary
        });
        phonesByContact.set(phone.contactId, phones);
      }

      // Build VCardContact array
      const vcardContacts: VCardContact[] = allContacts.map((contact) => ({
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        birthday: contact.birthday,
        emails: emailsByContact.get(contact.id) ?? [],
        phones: phonesByContact.get(contact.id) ?? []
      }));

      const vcardString = generateVCards(vcardContacts);
      const filename = generateVCardFilename(vcardContacts);
      const data = new TextEncoder().encode(vcardString);

      await saveFile(data, filename);
    } finally {
      setExporting(false);
    }
  }, []);

  return { exportContact, exportAllContacts, exporting };
}
