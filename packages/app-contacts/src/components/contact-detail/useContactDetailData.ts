/**
 * Hook for contact detail data fetching.
 */

import { contactEmails, contactPhones, contacts } from '@tearleads/db/sqlite';
import { and, asc, desc, eq } from 'drizzle-orm';
import { useCallback, useEffect, useState } from 'react';
import { useContactsContext } from '../../context';
import type { ContactEmail, ContactInfo, ContactPhone } from './types';

interface UseContactDetailDataResult {
  contact: ContactInfo | null;
  emails: ContactEmail[];
  phones: ContactPhone[];
  loading: boolean;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  fetchContact: () => Promise<void>;
}

export function useContactDetailData(
  contactId: string
): UseContactDetailDataResult {
  const { databaseState, getDatabase } = useContactsContext();
  const { isUnlocked } = databaseState;

  const [contact, setContact] = useState<ContactInfo | null>(null);
  const [emails, setEmails] = useState<ContactEmail[]>([]);
  const [phones, setPhones] = useState<ContactPhone[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchContact = useCallback(async () => {
    if (!isUnlocked || !contactId) return;

    setLoading(true);
    setError(null);

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
  }, [isUnlocked, contactId, getDatabase]);

  useEffect(() => {
    if (isUnlocked && contactId) {
      fetchContact();
    }
  }, [isUnlocked, contactId, fetchContact]);

  return {
    contact,
    emails,
    phones,
    loading,
    error,
    setError,
    fetchContact
  };
}
