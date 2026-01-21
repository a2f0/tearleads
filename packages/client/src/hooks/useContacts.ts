import { and, asc, desc, eq } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import {
  contactEmails,
  contactPhones,
  contacts as contactsTable
} from '@/db/schema';

export interface ContactInfo {
  id: string;
  firstName: string;
  lastName: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
}

export type SortColumn = 'firstName' | 'lastName' | 'primaryEmail';
export type SortDirection = 'asc' | 'desc';

export interface UseContactsOptions {
  refreshToken?: number | undefined;
  sortColumn?: SortColumn;
  sortDirection?: SortDirection;
}

export interface UseContactsResult {
  contactsList: ContactInfo[];
  loading: boolean;
  error: string | null;
  hasFetched: boolean;
  fetchContacts: () => Promise<void>;
  setHasFetched: (value: boolean) => void;
}

export function useContacts(
  options: UseContactsOptions = {}
): UseContactsResult {
  const {
    refreshToken,
    sortColumn = 'firstName',
    sortDirection = 'asc'
  } = options;

  const { isUnlocked, currentInstanceId } = useDatabaseContext();
  const [contactsList, setContactsList] = useState<ContactInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const fetchedForInstanceRef = useRef<string | null>(null);

  const fetchContacts = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();

      const orderByColumn = {
        firstName: contactsTable.firstName,
        lastName: contactsTable.lastName,
        primaryEmail: contactEmails.email
      }[sortColumn];

      const orderFn = sortDirection === 'asc' ? asc : desc;

      const result = await db
        .select({
          id: contactsTable.id,
          firstName: contactsTable.firstName,
          lastName: contactsTable.lastName,
          primaryEmail: contactEmails.email,
          primaryPhone: contactPhones.phoneNumber
        })
        .from(contactsTable)
        .leftJoin(
          contactEmails,
          and(
            eq(contactEmails.contactId, contactsTable.id),
            eq(contactEmails.isPrimary, true)
          )
        )
        .leftJoin(
          contactPhones,
          and(
            eq(contactPhones.contactId, contactsTable.id),
            eq(contactPhones.isPrimary, true)
          )
        )
        .where(eq(contactsTable.deleted, false))
        .orderBy(orderFn(orderByColumn));

      setContactsList(
        result.map((row) => ({
          id: row.id,
          firstName: row.firstName,
          lastName: row.lastName,
          primaryEmail: row.primaryEmail,
          primaryPhone: row.primaryPhone
        }))
      );
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch contacts:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, sortColumn, sortDirection]);

  useEffect(() => {
    if (refreshToken === undefined) return;
    setHasFetched(false);
    setError(null);
  }, [refreshToken]);

  useEffect(() => {
    const needsFetch =
      isUnlocked &&
      !loading &&
      (!hasFetched || fetchedForInstanceRef.current !== currentInstanceId);

    if (needsFetch) {
      if (
        fetchedForInstanceRef.current !== currentInstanceId &&
        fetchedForInstanceRef.current !== null
      ) {
        setContactsList([]);
        setError(null);
      }

      fetchedForInstanceRef.current = currentInstanceId;

      const timeoutId = setTimeout(() => {
        fetchContacts();
      }, 0);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [isUnlocked, loading, hasFetched, currentInstanceId, fetchContacts]);

  return {
    contactsList,
    loading,
    error,
    hasFetched,
    fetchContacts,
    setHasFetched
  };
}
