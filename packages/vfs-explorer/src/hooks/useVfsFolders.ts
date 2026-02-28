import { vfsLinks, vfsRegistry } from '@tearleads/db/sqlite';
import { inArray, sql } from 'drizzle-orm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useVfsExplorerContext } from '../context';
import type { VfsObjectType } from '../lib/vfsTypes';

export interface VfsFolderNode {
  id: string;
  objectType: VfsObjectType;
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

const TREE_CONTAINER_TYPES = ['folder', 'playlist', 'emailFolder'] as const;

const UNNAMED_CONTAINER_LABELS: Record<(typeof TREE_CONTAINER_TYPES)[number], string> =
  {
    folder: 'Unnamed Folder',
    playlist: 'Unnamed Playlist',
    emailFolder: 'Unnamed Folder'
  };

export function useVfsFolders(): UseVfsFoldersResult {
  const { databaseState, getDatabase } = useVfsExplorerContext();
  const { isUnlocked, currentInstanceId } = databaseState;
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
      const folderNameExpr = sql<string>`COALESCE(
        NULLIF(${vfsRegistry.encryptedName}, ''),
        CASE ${vfsRegistry.objectType}
          WHEN 'playlist' THEN 'Unnamed Playlist'
          WHEN 'emailFolder' THEN 'Unnamed Folder'
          ELSE 'Unnamed Folder'
        END
      )`;
      const folderRows = await db
        .select({
          id: vfsRegistry.id,
          objectType: vfsRegistry.objectType,
          name: sql<string>`${folderNameExpr} as "name"`,
          createdAt: vfsRegistry.createdAt
        })
        .from(vfsRegistry)
        .where(inArray(vfsRegistry.objectType, TREE_CONTAINER_TYPES));

      if (folderRows.length === 0) {
        setFolders([]);
        setHasFetched(true);
        return;
      }

      const folderIds = folderRows.map((f) => f.id);

      // Get parent relationships and child counts in parallel
      const [linkRows, childCountRows] = await Promise.all([
        db
          .select({
            childId: vfsLinks.childId,
            parentId: vfsLinks.parentId
          })
          .from(vfsLinks)
          .where(inArray(vfsLinks.childId, folderIds)),
        db
          .select({
            parentId: vfsLinks.parentId
          })
          .from(vfsLinks)
          .where(inArray(vfsLinks.parentId, folderIds))
      ]);

      // Build parent lookup map
      const parentMap = new Map<string, string>();
      for (const link of linkRows) {
        parentMap.set(link.childId, link.parentId);
      }

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
        const objectType = folder.objectType as (typeof TREE_CONTAINER_TYPES)[number];
        nodeMap.set(folder.id, {
          id: folder.id,
          objectType,
          name: folder.name || UNNAMED_CONTAINER_LABELS[objectType],
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
            parent.children?.push(node);
          }
        } else {
          // Only folder containers are eligible as top-level tree roots.
          if (node.objectType === 'folder') {
            rootFolders.push(node);
          }
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
  }, [isUnlocked, getDatabase]);

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
