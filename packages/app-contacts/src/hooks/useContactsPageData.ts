/**
 * Hook for fetching and managing contacts list data for the page view.
 */

import {
  contactEmails,
  contactPhones,
  contacts as contactsTable,
  vfsLinks
} from '@tearleads/db/sqlite';
import { and, asc, eq, isNull, like, or, type SQL } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useContactsContext } from '../context';
import { ALL_CONTACTS_ID } from '../lib/constants';

export interface ContactsPageInfo {
  id: string;
  firstName: string;
  lastName: string | null;
  birthday: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  createdAt: Date;
}

export const ROW_HEIGHT_ESTIMATE = 72;

interface UseContactsPageDataResult {
  contacts: ContactsPageInfo[];
  loading: boolean;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  hasFetched: boolean;
  setHasFetched: React.Dispatch<React.SetStateAction<boolean>>;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  debouncedSearch: string;
  selectedGroupId: string | null;
  fetchContacts: (search?: string) => Promise<void>;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

export function useContactsPageData(
  groupId: string | undefined,
  parsedDataExists: boolean
): UseContactsPageDataResult {
  const { databaseState, getDatabase, activeOrganizationId } =
    useContactsContext();
  const { isUnlocked, currentInstanceId } = databaseState;
  const [contacts, setContacts] = useState<ContactsPageInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    groupId ?? ALL_CONTACTS_ID
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const fetchedForInstanceRef = useRef<string | null>(null);
  const previousOrgIdRef = useRef<string | null>(activeOrganizationId);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchQuery]);

  useEffect(() => {
    const newGroupId = groupId ?? ALL_CONTACTS_ID;
    if (selectedGroupId !== newGroupId) {
      setSelectedGroupId(newGroupId);
      setContacts([]);
      setHasFetched(false);
    }
  }, [groupId, selectedGroupId]);

  useEffect(() => {
    if (isUnlocked && !parsedDataExists) {
      searchInputRef.current?.focus();
    }
  }, [isUnlocked, parsedDataExists]);

  useEffect(() => {
    if (previousOrgIdRef.current === activeOrganizationId) return;
    previousOrgIdRef.current = activeOrganizationId;
    setHasFetched(false);
    setError(null);
  }, [activeOrganizationId]);

  const fetchContacts = useCallback(
    async (search?: string) => {
      if (!isUnlocked) return;

      setLoading(true);
      setError(null);

      try {
        const db = getDatabase();
        const searchTerm = search?.trim();
        const searchPattern = searchTerm ? `%${searchTerm}%` : null;
        const groupFilterId =
          selectedGroupId && selectedGroupId !== ALL_CONTACTS_ID
            ? selectedGroupId
            : null;

        let baseQuery = db
          .select({
            id: contactsTable.id,
            firstName: contactsTable.firstName,
            lastName: contactsTable.lastName,
            birthday: contactsTable.birthday,
            createdAt: contactsTable.createdAt,
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
          );

        if (groupFilterId) {
          baseQuery = baseQuery.innerJoin(
            vfsLinks,
            and(
              eq(vfsLinks.childId, contactsTable.id),
              eq(vfsLinks.parentId, groupFilterId)
            )
          );
        }

        const deletedCondition = eq(contactsTable.deleted, false);
        const orgFilter = activeOrganizationId
          ? or(
              eq(contactsTable.organizationId, activeOrganizationId),
              isNull(contactsTable.organizationId)
            )
          : isNull(contactsTable.organizationId);
        const baseCondition = and(deletedCondition, orgFilter);
        let whereCondition: SQL | undefined;

        if (searchPattern) {
          const searchCondition = or(
            like(contactsTable.firstName, searchPattern),
            like(contactsTable.lastName, searchPattern),
            like(contactEmails.email, searchPattern),
            like(contactPhones.phoneNumber, searchPattern)
          );
          whereCondition = and(baseCondition, searchCondition);
        } else {
          whereCondition = baseCondition;
        }

        const result = await baseQuery
          .where(whereCondition)
          .orderBy(asc(contactsTable.firstName));

        const contactList = result.map((row) => ({
          id: row.id,
          firstName: row.firstName,
          lastName: row.lastName,
          birthday: row.birthday,
          primaryEmail: row.primaryEmail,
          primaryPhone: row.primaryPhone,
          createdAt: row.createdAt
        }));

        setContacts(contactList);
        setHasFetched(true);
      } catch (err) {
        console.error('Failed to fetch contacts:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [isUnlocked, selectedGroupId, activeOrganizationId, getDatabase]
  );

  useEffect(() => {
    if (!isUnlocked) return;

    if (
      fetchedForInstanceRef.current !== currentInstanceId &&
      fetchedForInstanceRef.current !== null
    ) {
      setContacts([]);
      setHasFetched(false);
      setError(null);
      setSearchQuery('');
      setDebouncedSearch('');
    }

    fetchedForInstanceRef.current = currentInstanceId;

    const timeoutId = setTimeout(() => {
      fetchContacts(debouncedSearch);
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [isUnlocked, debouncedSearch, currentInstanceId, fetchContacts]);

  return {
    contacts,
    loading,
    error,
    setError,
    hasFetched,
    setHasFetched,
    searchQuery,
    setSearchQuery,
    debouncedSearch,
    selectedGroupId,
    fetchContacts,
    searchInputRef
  };
}
