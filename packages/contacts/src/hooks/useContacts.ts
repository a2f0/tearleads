import {
  contactEmails,
  contactPhones,
  contacts as contactsTable,
  vfsLinks
} from '@tearleads/db/sqlite';
import { and, asc, desc, eq, isNull, or } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useContactsContext } from '../context';

export interface ContactInfo {
  id: string;
  firstName: string;
  lastName: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
}

export type SortColumn = 'firstName' | 'lastName' | 'primaryEmail';
export type SortDirection = 'asc' | 'desc';

interface UseContactsOptions {
  refreshToken?: number | undefined;
  sortColumn?: SortColumn;
  sortDirection?: SortDirection;
  groupId?: string | null | undefined;
}

interface UseContactsResult {
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
    sortDirection = 'asc',
    groupId
  } = options;

  const { databaseState, getDatabase, activeOrganizationId } =
    useContactsContext();
  const { isUnlocked, currentInstanceId } = databaseState;

  const [contactsList, setContactsList] = useState<ContactInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const fetchedForInstanceRef = useRef<string | null>(null);
  const previousGroupIdRef = useRef<string | null | undefined>(groupId);
  const previousOrgIdRef = useRef<string | null>(activeOrganizationId);

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
      const deletedCondition = eq(contactsTable.deleted, false);
      const orgFilter = activeOrganizationId
        ? or(
            eq(contactsTable.organizationId, activeOrganizationId),
            isNull(contactsTable.organizationId)
          )
        : undefined;
      const baseCondition = orgFilter
        ? and(deletedCondition, orgFilter)
        : deletedCondition;
      let query = db
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
        );

      if (groupId) {
        query = query.innerJoin(
          vfsLinks,
          and(
            eq(vfsLinks.childId, contactsTable.id),
            eq(vfsLinks.parentId, groupId)
          )
        );
      }

      const result = await query
        .where(baseCondition)
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
  }, [
    isUnlocked,
    sortColumn,
    sortDirection,
    groupId,
    getDatabase,
    activeOrganizationId
  ]);

  useEffect(() => {
    if (refreshToken === undefined) return;
    setHasFetched(false);
    setError(null);
  }, [refreshToken]);

  useEffect(() => {
    if (previousGroupIdRef.current === groupId) return;
    previousGroupIdRef.current = groupId;
    setHasFetched(false);
    setError(null);
  }, [groupId]);

  useEffect(() => {
    if (previousOrgIdRef.current === activeOrganizationId) return;
    previousOrgIdRef.current = activeOrganizationId;
    setHasFetched(false);
    setError(null);
  }, [activeOrganizationId]);

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
