import { buildTree, type TreeNode } from '@tearleads/shared';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { EmailContext, useHasEmailFolderOperations } from '../context';
import {
  ALL_MAIL_ID,
  type EmailFolder,
  isSystemFolder,
  SYSTEM_FOLDER_TYPES
} from '../types/folder.js';

interface UseEmailFoldersResult {
  /** All folders as a flat list */
  folders: EmailFolder[];
  /** Folders organized as a tree (for custom folders only) */
  folderTree: TreeNode<EmailFolder>[];
  /** System folders in display order */
  systemFolders: EmailFolder[];
  /** Custom (user-created) folders */
  customFolders: EmailFolder[];
  /** Loading state */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Whether folders have been fetched at least once */
  hasFetched: boolean;
  /** Expanded folder IDs for tree view */
  expandedIds: Set<string>;
  /** Toggle a folder's expanded state */
  toggleExpanded: (id: string) => void;
  /** Refresh folders from database */
  refetch: () => Promise<void>;
  /** Create a new folder */
  createFolder: (
    name: string,
    parentId?: string | null
  ) => Promise<EmailFolder>;
  /** Rename a folder */
  renameFolder: (id: string, newName: string) => Promise<void>;
  /** Delete a folder */
  deleteFolder: (id: string) => Promise<void>;
  /** Move a folder to a new parent */
  moveFolder: (id: string, newParentId: string | null) => Promise<void>;
}

const EXPANDED_STORAGE_KEY = 'email-folders-expanded';

function loadExpandedIds(): Set<string> {
  try {
    const stored = localStorage.getItem(EXPANDED_STORAGE_KEY);
    if (stored) {
      return new Set(JSON.parse(stored) as string[]);
    }
  } catch {
    // Ignore parse errors
  }
  return new Set();
}

function saveExpandedIds(ids: Set<string>): void {
  try {
    localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Ignore storage errors
  }
}

export function useEmailFolders(): UseEmailFoldersResult {
  const hasOperations = useHasEmailFolderOperations();
  const context = useContext(EmailContext);
  const operations = hasOperations ? context?.folderOperations : null;

  const [folders, setFolders] = useState<EmailFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(loadExpandedIds);

  const hasInitialized = useRef(false);

  // Split folders into system and custom
  const { systemFolders, customFolders } = useMemo(() => {
    const system: EmailFolder[] = [];
    const custom: EmailFolder[] = [];

    for (const folder of folders) {
      if (isSystemFolder(folder)) {
        system.push(folder);
      } else {
        custom.push(folder);
      }
    }

    // Sort system folders by their defined order
    system.sort((a, b) => {
      const aIndex = SYSTEM_FOLDER_TYPES.indexOf(a.folderType);
      const bIndex = SYSTEM_FOLDER_TYPES.indexOf(b.folderType);
      return aIndex - bIndex;
    });

    // Sort custom folders alphabetically
    custom.sort((a, b) => a.name.localeCompare(b.name));

    return { systemFolders: system, customFolders: custom };
  }, [folders]);

  // Build tree from custom folders
  const folderTree = useMemo(() => {
    return buildTree(
      customFolders,
      (folder) => folder.id,
      (folder) => folder.parentId
    );
  }, [customFolders]);

  const refetch = useCallback(async () => {
    if (!operations) return;

    setLoading(true);
    setError(null);

    try {
      const result = await operations.fetchFolders();
      setFolders(result);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch email folders:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [operations]);

  // Initialize system folders and fetch on mount
  useEffect(() => {
    if (!operations || hasInitialized.current) return;
    hasInitialized.current = true;

    const init = async () => {
      setLoading(true);
      try {
        await operations.initializeSystemFolders();
        const result = await operations.fetchFolders();
        setFolders(result);
        setHasFetched(true);
      } catch (err) {
        console.error('Failed to initialize email folders:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [operations]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      saveExpandedIds(next);
      return next;
    });
  }, []);

  const createFolder = useCallback(
    async (name: string, parentId?: string | null): Promise<EmailFolder> => {
      if (!operations) {
        throw new Error('Folder operations not available');
      }

      const folder = await operations.createFolder(name, parentId);
      setFolders((prev) => [...prev, folder]);
      return folder;
    },
    [operations]
  );

  const renameFolder = useCallback(
    async (id: string, newName: string): Promise<void> => {
      if (!operations) {
        throw new Error('Folder operations not available');
      }

      await operations.renameFolder(id, newName);
      setFolders((prev) =>
        prev.map((f) => (f.id === id ? { ...f, name: newName } : f))
      );
    },
    [operations]
  );

  const deleteFolder = useCallback(
    async (id: string): Promise<void> => {
      if (!operations) {
        throw new Error('Folder operations not available');
      }

      await operations.deleteFolder(id);
      setFolders((prev) => prev.filter((f) => f.id !== id));
    },
    [operations]
  );

  const moveFolder = useCallback(
    async (id: string, newParentId: string | null): Promise<void> => {
      if (!operations) {
        throw new Error('Folder operations not available');
      }

      await operations.moveFolder(id, newParentId);
      setFolders((prev) =>
        prev.map((f) => (f.id === id ? { ...f, parentId: newParentId } : f))
      );
    },
    [operations]
  );

  return {
    folders,
    folderTree,
    systemFolders,
    customFolders,
    loading,
    error,
    hasFetched,
    expandedIds,
    toggleExpanded,
    refetch,
    createFolder,
    renameFolder,
    deleteFolder,
    moveFolder
  };
}

// Re-export ALL_MAIL_ID for convenience
export { ALL_MAIL_ID };
