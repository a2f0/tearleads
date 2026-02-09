import {
  contactGroups,
  contacts,
  vfsLinks,
  vfsRegistry
} from '@rapid/db/sqlite';
import { and, eq, inArray } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useContactsContext } from '../context';

export interface ContactGroup {
  id: string;
  name: string;
  contactCount: number;
}

export interface UseContactGroupsResult {
  groups: ContactGroup[];
  loading: boolean;
  error: string | null;
  hasFetched: boolean;
  refetch: () => Promise<void>;
  createGroup: (name: string) => Promise<string>;
  renameGroup: (groupId: string, newName: string) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
}

export function useContactGroups(): UseContactGroupsResult {
  const { databaseState, getDatabase } = useContactsContext();
  const { isUnlocked, currentInstanceId } = databaseState;
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const fetchedForInstanceRef = useRef<string | null>(null);

  const fetchGroups = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();
      const groupRows = await db
        .select({
          id: vfsRegistry.id,
          name: contactGroups.encryptedName
        })
        .from(vfsRegistry)
        .innerJoin(contactGroups, eq(contactGroups.id, vfsRegistry.id))
        .where(eq(vfsRegistry.objectType, 'contactGroup'));

      if (groupRows.length === 0) {
        setGroups([]);
        setHasFetched(true);
        return;
      }

      const groupIds = groupRows.map((group) => group.id);
      const linkRows = await db
        .select({
          parentId: vfsLinks.parentId
        })
        .from(vfsLinks)
        .innerJoin(contacts, eq(contacts.id, vfsLinks.childId))
        .where(
          and(inArray(vfsLinks.parentId, groupIds), eq(contacts.deleted, false))
        );

      const countByGroup = new Map<string, number>();
      for (const link of linkRows) {
        countByGroup.set(
          link.parentId,
          (countByGroup.get(link.parentId) ?? 0) + 1
        );
      }

      const contactGroupsList = groupRows
        .map((group) => ({
          id: group.id,
          name: group.name || 'Unnamed Group',
          contactCount: countByGroup.get(group.id) ?? 0
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      setGroups(contactGroupsList);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch contact groups:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, getDatabase]);

  useEffect(() => {
    const needsFetch =
      isUnlocked &&
      !loading &&
      (!hasFetched || fetchedForInstanceRef.current !== currentInstanceId);

    if (!needsFetch) return;

    if (
      fetchedForInstanceRef.current !== currentInstanceId &&
      fetchedForInstanceRef.current !== null
    ) {
      setGroups([]);
      setError(null);
    }

    fetchedForInstanceRef.current = currentInstanceId;

    const timeoutId = setTimeout(() => {
      void fetchGroups();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [currentInstanceId, fetchGroups, hasFetched, isUnlocked, loading]);

  const createGroup = useCallback(
    async (name: string): Promise<string> => {
      const db = getDatabase();
      const groupId = crypto.randomUUID();
      const now = new Date();

      await db.insert(vfsRegistry).values({
        id: groupId,
        objectType: 'contactGroup',
        ownerId: null,
        createdAt: now
      });

      await db.insert(contactGroups).values({
        id: groupId,
        encryptedName: name,
        color: null,
        icon: null
      });

      await fetchGroups();
      return groupId;
    },
    [fetchGroups, getDatabase]
  );

  const renameGroup = useCallback(
    async (groupId: string, newName: string): Promise<void> => {
      const db = getDatabase();
      await db
        .update(contactGroups)
        .set({ encryptedName: newName })
        .where(eq(contactGroups.id, groupId));
      await fetchGroups();
    },
    [fetchGroups, getDatabase]
  );

  const deleteGroup = useCallback(
    async (groupId: string): Promise<void> => {
      const db = getDatabase();
      await db.delete(vfsLinks).where(eq(vfsLinks.parentId, groupId));
      await db.delete(contactGroups).where(eq(contactGroups.id, groupId));
      await db.delete(vfsRegistry).where(eq(vfsRegistry.id, groupId));
      await fetchGroups();
    },
    [fetchGroups, getDatabase]
  );

  return {
    groups,
    loading,
    error,
    hasFetched,
    refetch: fetchGroups,
    createGroup,
    renameGroup,
    deleteGroup
  };
}
