import {
  ChevronDown,
  ChevronRight,
  FileBox,
  Folder,
  FolderOpen,
  Layers,
  Loader2
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ALL_ITEMS_FOLDER_ID, UNFILED_FOLDER_ID } from '../constants';
import { useEnsureVfsRoot, useVfsFolders, type VfsFolderNode } from '../hooks';
import { cn } from '../lib';
import { DeleteFolderDialog } from './DeleteFolderDialog';
import { FolderContextMenu } from './FolderContextMenu';
import { NewFolderDialog } from './NewFolderDialog';
import { RenameFolderDialog } from './RenameFolderDialog';
import { VfsDroppableFolder } from './VfsDroppableFolder';

export type { VfsFolderNode };

interface ContextMenuState {
  x: number;
  y: number;
  folder: VfsFolderNode;
}

interface VfsTreePanelProps {
  width: number;
  onWidthChange: (width: number) => void;
  selectedFolderId: string | null;
  onFolderSelect: (folderId: string | null) => void;
  compact?: boolean | undefined;
  refreshToken?: number | undefined;
  onFolderChanged?: (() => void) | undefined;
  onFolderShare?: ((folder: VfsFolderNode) => void) | undefined;
}

export function VfsTreePanel({
  width,
  onWidthChange,
  selectedFolderId,
  onFolderSelect,
  compact: _compact,
  refreshToken,
  onFolderChanged,
  onFolderShare
}: VfsTreePanelProps) {
  // Ensure the VFS root exists before loading folders
  useEnsureVfsRoot();

  const { folders, loading, error, refetch } = useVfsFolders();

  // Refetch when refreshToken changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch is stable from useCallback
  useEffect(() => {
    if (refreshToken !== undefined && refreshToken > 0) {
      refetch();
    }
  }, [refreshToken]);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    new Set()
  );
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Dialog states
  const [renameDialogFolder, setRenameDialogFolder] =
    useState<VfsFolderNode | null>(null);
  const [deleteDialogFolder, setDeleteDialogFolder] =
    useState<VfsFolderNode | null>(null);
  const [newSubfolderParent, setNewSubfolderParent] =
    useState<VfsFolderNode | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true;
      startX.current = e.clientX;
      startWidth.current = width;

      const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = e.clientX - startX.current;
        const newWidth = Math.max(
          150,
          Math.min(400, startWidth.current + delta)
        );
        onWidthChange(newWidth);
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [width, onWidthChange]
  );

  const toggleExpand = useCallback((folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, folder: VfsFolderNode) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, folder });
    },
    []
  );

  const handleFolderChanged = useCallback(() => {
    refetch();
    onFolderChanged?.();
  }, [refetch, onFolderChanged]);

  const expandFolder = useCallback((folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      next.add(folderId);
      return next;
    });
  }, []);

  const handleFolderDeleted = useCallback(
    (deletedId: string) => {
      // If the deleted folder was selected, clear selection
      if (selectedFolderId === deletedId) {
        onFolderSelect(null);
      }
      handleFolderChanged();
    },
    [selectedFolderId, onFolderSelect, handleFolderChanged]
  );

  const renderFolder = (folder: VfsFolderNode, depth: number) => {
    const isSelected = folder.id === selectedFolderId;
    const isExpanded = expandedFolderIds.has(folder.id);
    const hasChildren =
      folder.childCount > 0 || (folder.children && folder.children.length > 0);
    const FolderIcon = isExpanded ? FolderOpen : Folder;

    return (
      <div key={folder.id}>
        <VfsDroppableFolder folderId={folder.id}>
          <button
            type="button"
            className={cn(
              'flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm transition-colors',
              isSelected
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-accent/50'
            )}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={() => onFolderSelect(folder.id)}
            onDoubleClick={() => toggleExpand(folder.id)}
            onContextMenu={(e) => handleContextMenu(e, folder)}
          >
            {/* biome-ignore lint/a11y/useSemanticElements: span with role=button used to avoid nested button elements */}
            <span
              role="button"
              tabIndex={0}
              className="flex h-4 w-4 shrink-0 items-center justify-center"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(folder.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  toggleExpand(folder.id);
                }
              }}
            >
              {hasChildren ? (
                isExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )
              ) : null}
            </span>
            <FolderIcon className="h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-500" />
            <span className="truncate">{folder.name}</span>
          </button>
        </VfsDroppableFolder>
        {isExpanded && folder.children && folder.children.length > 0 && (
          <div>
            {folder.children.map((child) => renderFolder(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="relative flex shrink-0 flex-col border-r bg-muted/20"
      style={{ width }}
    >
      <div className="flex items-center border-b px-3 py-2">
        <span className="font-medium text-muted-foreground text-xs">
          Folders
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {/* Unfiled Items - always shown, not a drop target */}
        <VfsDroppableFolder folderId={UNFILED_FOLDER_ID} disabled>
          <button
            type="button"
            className={cn(
              'flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm transition-colors',
              selectedFolderId === UNFILED_FOLDER_ID
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-accent/50'
            )}
            style={{ paddingLeft: '8px' }}
            onClick={() => onFolderSelect(UNFILED_FOLDER_ID)}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center" />
            <FileBox className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <span className="truncate">Unfiled Items</span>
          </button>
        </VfsDroppableFolder>

        {/* All Items - always shown, not a drop target */}
        <VfsDroppableFolder folderId={ALL_ITEMS_FOLDER_ID} disabled>
          <button
            type="button"
            className={cn(
              'flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm transition-colors',
              selectedFolderId === ALL_ITEMS_FOLDER_ID
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-accent/50'
            )}
            style={{ paddingLeft: '8px' }}
            onClick={() => onFolderSelect(ALL_ITEMS_FOLDER_ID)}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center" />
            <Layers className="h-4 w-4 shrink-0 text-purple-600 dark:text-purple-400" />
            <span className="truncate">All Items</span>
          </button>
        </VfsDroppableFolder>

        {loading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && (
          <div className="px-2 py-4 text-center text-destructive text-xs">
            {error}
          </div>
        )}
        {!loading && !error && folders.map((folder) => renderFolder(folder, 0))}
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Resize handle for panel width */}
      <div
        className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-accent"
        onMouseDown={handleMouseDown}
      />

      {/* Context Menu */}
      {contextMenu && (
        <FolderContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          folder={contextMenu.folder}
          onClose={() => setContextMenu(null)}
          onNewSubfolder={(folder) => setNewSubfolderParent(folder)}
          onRename={(folder) => setRenameDialogFolder(folder)}
          onDelete={(folder) => setDeleteDialogFolder(folder)}
          onShare={onFolderShare}
        />
      )}

      {/* New Subfolder Dialog */}
      <NewFolderDialog
        open={newSubfolderParent !== null}
        onOpenChange={(open) => {
          if (!open) setNewSubfolderParent(null);
        }}
        parentFolderId={newSubfolderParent?.id ?? null}
        onFolderCreated={() => {
          if (newSubfolderParent) {
            expandFolder(newSubfolderParent.id);
          }
          handleFolderChanged();
        }}
      />

      {/* Rename Dialog */}
      <RenameFolderDialog
        open={renameDialogFolder !== null}
        onOpenChange={(open) => {
          if (!open) setRenameDialogFolder(null);
        }}
        folder={renameDialogFolder}
        onFolderRenamed={handleFolderChanged}
      />

      {/* Delete Dialog */}
      <DeleteFolderDialog
        open={deleteDialogFolder !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteDialogFolder(null);
        }}
        folder={deleteDialogFolder}
        onFolderDeleted={handleFolderDeleted}
      />
    </div>
  );
}
