/**
 * Hook for fetching and managing contacts data.
 */

import { ALL_CONTACTS_ID } from '@tearleads/contacts';
import { and, asc, eq, isNull, like, or, type SQL } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrg } from '@/contexts/OrgContext';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import {
  contactEmails,
  contactPhones,
  contacts as contactsTable,
  vfsLinks
} from '@/db/schema';
import type { ContactInfo } from './types';

interface UseContactsDataResult {
  contacts: ContactInfo[];
  loading: boolean;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  hasFetched: boolean;
  setHasFetched: React.Dispatch<React.SetStateAction<boolean>>;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  debouncedSearch: string;
  selectedGroupId: string | null;
  setSelectedGroupId: React.Dispatch<React.SetStateAction<string | null>>;
  fetchContacts: (search?: string) => Promise<void>;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  setContacts: React.Dispatch<React.SetStateAction<ContactInfo[]>>;
}

export function useContactsData(
  routeGroupId: string | undefined,
  parsedDataExists: boolean
): UseContactsDataResult {
  const { isUnlocked, currentInstanceId } = useDatabaseContext();
  const { activeOrganizationId } = useOrg();
  const [contacts, setContacts] = useState<ContactInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    routeGroupId ?? ALL_CONTACTS_ID
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const fetchedForInstanceRef = useRef<string | null>(null);
  const previousOrgIdRef = useRef<string | null>(activeOrganizationId);

  // Debounce search query
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

  // Sync selectedGroupId with route
  useEffect(() => {
    const newGroupId = routeGroupId ?? ALL_CONTACTS_ID;
    if (selectedGroupId !== newGroupId) {
      setSelectedGroupId(newGroupId);
      setContacts([]);
      setHasFetched(false);
    }
  }, [routeGroupId, selectedGroupId]);

  // Focus search input when database is unlocked
  useEffect(() => {
    if (isUnlocked && !parsedDataExists) {
      searchInputRef.current?.focus();
    }
  }, [isUnlocked, parsedDataExists]);

  // Refetch when active org changes
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

        // Build query with optional search
        const searchTerm = search?.trim();
        const searchPattern = searchTerm ? `%${searchTerm}%` : null;
        const groupFilterId =
          selectedGroupId && selectedGroupId !== ALL_CONTACTS_ID
            ? selectedGroupId
            : null;

        // Query contacts with LEFT JOINs for primary email/phone
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

        // Build where conditions
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
          // Search across name, email, and phone (SQLite LIKE is case-insensitive by default)
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
    [isUnlocked, selectedGroupId, activeOrganizationId]
  );

  // Fetch contacts on initial load, when search query changes, or when instance changes
  useEffect(() => {
    if (!isUnlocked) return;

    // Check if we need to reset for instance change
    if (
      fetchedForInstanceRef.current !== currentInstanceId &&
      fetchedForInstanceRef.current !== null
    ) {
      // Instance changed - clear contacts and reset state
      setContacts([]);
      setHasFetched(false);
      setError(null);
      setSearchQuery('');
      setDebouncedSearch('');
    }

    // Update ref before fetching
    fetchedForInstanceRef.current = currentInstanceId;

    // Defer fetch to next tick to ensure database singleton is updated
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
    setSelectedGroupId,
    fetchContacts,
    searchInputRef,
    setContacts
  };
}
