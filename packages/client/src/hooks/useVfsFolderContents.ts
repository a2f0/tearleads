import { eq, inArray } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import {
  contacts,
  files,
  notes,
  vfsFolders,
  vfsLinks,
  vfsRegistry
} from '@/db/schema';

export type VfsObjectType = 'folder' | 'contact' | 'note' | 'file' | 'photo';

export interface VfsItem {
  id: string;
  linkId: string;
  objectType: VfsObjectType;
  name: string;
  createdAt: Date;
}

export interface UseVfsFolderContentsResult {
  items: VfsItem[];
  loading: boolean;
  error: string | null;
  hasFetched: boolean;
  refetch: () => Promise<void>;
}

export function useVfsFolderContents(
  folderId: string | null
): UseVfsFolderContentsResult {
  const { isUnlocked, currentInstanceId } = useDatabaseContext();
  const [items, setItems] = useState<VfsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const fetchedForRef = useRef<{
    instanceId: string | null;
    folderId: string | null;
  }>({
    instanceId: null,
    folderId: null
  });

  const fetchContents = useCallback(async () => {
    if (!isUnlocked || !folderId) {
      setItems([]);
      setHasFetched(true);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();

      // Get all links where this folder is the parent
      const linkRows = await db
        .select({
          linkId: vfsLinks.id,
          childId: vfsLinks.childId
        })
        .from(vfsLinks)
        .where(eq(vfsLinks.parentId, folderId));

      if (linkRows.length === 0) {
        setItems([]);
        setHasFetched(true);
        return;
      }

      const childIds = linkRows.map((l) => l.childId);
      const linkMap = new Map(linkRows.map((l) => [l.childId, l.linkId]));

      // Get registry info for all children
      const registryRows = await db
        .select({
          id: vfsRegistry.id,
          objectType: vfsRegistry.objectType,
          createdAt: vfsRegistry.createdAt
        })
        .from(vfsRegistry)
        .where(inArray(vfsRegistry.id, childIds));

      // Group by object type for efficient name lookups
      const byType: Record<string, string[]> = {};
      for (const row of registryRows) {
        if (!byType[row.objectType]) {
          byType[row.objectType] = [];
        }
        byType[row.objectType]?.push(row.id);
      }

      // Lookup names from respective tables
      const nameMap = new Map<string, string>();

      // Folders
      if (byType['folder']?.length) {
        const folderNameRows = await db
          .select({
            id: vfsFolders.id,
            name: vfsFolders.encryptedName
          })
          .from(vfsFolders)
          .where(inArray(vfsFolders.id, byType['folder']));
        for (const row of folderNameRows) {
          nameMap.set(row.id, row.name || 'Unnamed Folder');
        }
      }

      // Contacts
      if (byType['contact']?.length) {
        const contactRows = await db
          .select({
            id: contacts.id,
            firstName: contacts.firstName,
            lastName: contacts.lastName
          })
          .from(contacts)
          .where(inArray(contacts.id, byType['contact']));
        for (const row of contactRows) {
          const name = row.lastName
            ? `${row.firstName} ${row.lastName}`
            : row.firstName;
          nameMap.set(row.id, name);
        }
      }

      // Notes
      if (byType['note']?.length) {
        const noteRows = await db
          .select({
            id: notes.id,
            title: notes.title
          })
          .from(notes)
          .where(inArray(notes.id, byType['note']));
        for (const row of noteRows) {
          nameMap.set(row.id, row.title);
        }
      }

      // Files and Photos (both use files table)
      const fileTypes = ['file', 'photo'].filter((t) => byType[t]?.length);
      if (fileTypes.length > 0) {
        const fileIds = fileTypes.flatMap((t) => byType[t] || []);
        const fileRows = await db
          .select({
            id: files.id,
            name: files.name
          })
          .from(files)
          .where(inArray(files.id, fileIds));
        for (const row of fileRows) {
          nameMap.set(row.id, row.name);
        }
      }

      // Build final items list
      const resultItems: VfsItem[] = registryRows.map((row) => ({
        id: row.id,
        linkId: linkMap.get(row.id) || row.id,
        objectType: row.objectType as VfsObjectType,
        name: nameMap.get(row.id) || 'Unknown',
        createdAt: new Date(row.createdAt)
      }));

      // Sort: folders first, then alphabetically by name
      resultItems.sort((a, b) => {
        if (a.objectType === 'folder' && b.objectType !== 'folder') return -1;
        if (a.objectType !== 'folder' && b.objectType === 'folder') return 1;
        return a.name.localeCompare(b.name);
      });

      setItems(resultItems);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch VFS folder contents:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, folderId]);

  useEffect(() => {
    const needsFetch =
      isUnlocked &&
      !loading &&
      (!hasFetched ||
        fetchedForRef.current.instanceId !== currentInstanceId ||
        fetchedForRef.current.folderId !== folderId);

    if (needsFetch) {
      if (
        fetchedForRef.current.instanceId !== currentInstanceId &&
        fetchedForRef.current.instanceId !== null
      ) {
        setItems([]);
        setError(null);
      }

      fetchedForRef.current = { instanceId: currentInstanceId, folderId };

      const timeoutId = setTimeout(() => {
        fetchContents();
      }, 0);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [
    isUnlocked,
    loading,
    hasFetched,
    currentInstanceId,
    folderId,
    fetchContents
  ]);

  return {
    items,
    loading,
    error,
    hasFetched,
    refetch: fetchContents
  };
}
