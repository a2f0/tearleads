import { eq, inArray } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { vfsFolders, vfsLinks, vfsRegistry } from '@/db/schema';

export interface VfsFolderNode {
  id: string;
  name: string;
  parentId: string | null;
  children?: VfsFolderNode[];
  childCount: number;
}

export interface UseVfsFoldersResult {
  folders: VfsFolderNode[];
  loading: boolean;
  error: string | null;
  hasFetched: boolean;
  refetch: () => Promise<void>;
}

export function useVfsFolders(): UseVfsFoldersResult {
  const { isUnlocked, currentInstanceId } = useDatabaseContext();
  const [folders, setFolders] = useState<VfsFolderNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const fetchedForInstanceRef = useRef<string | null>(null);

  const fetchFolders = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();

      // Get all folders with their names
      const folderRows = await db
        .select({
          id: vfsRegistry.id,
          name: vfsFolders.encryptedName,
          createdAt: vfsRegistry.createdAt
        })
        .from(vfsRegistry)
        .innerJoin(vfsFolders, eq(vfsFolders.id, vfsRegistry.id))
        .where(eq(vfsRegistry.objectType, 'folder'));

      if (folderRows.length === 0) {
        setFolders([]);
        setHasFetched(true);
        return;
      }

      const folderIds = folderRows.map((f) => f.id);

      // Get parent relationships for folders
      const linkRows = await db
        .select({
          childId: vfsLinks.childId,
          parentId: vfsLinks.parentId
        })
        .from(vfsLinks)
        .where(inArray(vfsLinks.childId, folderIds));

      // Build parent lookup map
      const parentMap = new Map<string, string>();
      for (const link of linkRows) {
        parentMap.set(link.childId, link.parentId);
      }

      // Count children per folder (all children, not just folders)
      const childCountRows = await db
        .select({
          parentId: vfsLinks.parentId
        })
        .from(vfsLinks)
        .where(inArray(vfsLinks.parentId, folderIds));

      const childCountMap = new Map<string, number>();
      for (const row of childCountRows) {
        childCountMap.set(
          row.parentId,
          (childCountMap.get(row.parentId) || 0) + 1
        );
      }

      // Build flat list of folder nodes
      const nodeMap = new Map<string, VfsFolderNode>();
      for (const folder of folderRows) {
        nodeMap.set(folder.id, {
          id: folder.id,
          name: folder.name || 'Unnamed Folder',
          parentId: parentMap.get(folder.id) || null,
          childCount: childCountMap.get(folder.id) || 0,
          children: []
        });
      }

      // Build tree structure
      const rootFolders: VfsFolderNode[] = [];
      for (const node of nodeMap.values()) {
        if (node.parentId && nodeMap.has(node.parentId)) {
          const parent = nodeMap.get(node.parentId);
          if (parent) {
            parent.children = parent.children || [];
            parent.children.push(node);
          }
        } else {
          // Root folder (no parent or parent is not a folder)
          rootFolders.push(node);
        }
      }

      // Sort children alphabetically
      const sortChildren = (nodes: VfsFolderNode[]) => {
        nodes.sort((a, b) => a.name.localeCompare(b.name));
        for (const node of nodes) {
          if (node.children && node.children.length > 0) {
            sortChildren(node.children);
          }
        }
      };
      sortChildren(rootFolders);

      setFolders(rootFolders);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch VFS folders:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked]);

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
        setFolders([]);
        setError(null);
      }

      fetchedForInstanceRef.current = currentInstanceId;

      const timeoutId = setTimeout(() => {
        fetchFolders();
      }, 0);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [isUnlocked, loading, hasFetched, currentInstanceId, fetchFolders]);

  return {
    folders,
    loading,
    error,
    hasFetched,
    refetch: fetchFolders
  };
}
