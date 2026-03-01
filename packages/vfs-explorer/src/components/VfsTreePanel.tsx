import {
  useResizableSidebar,
  useSidebarRefetch,
  WindowContextMenu,
  WindowSidebarHeader
} from '@tearleads/window-manager';
// one-component-per-file: allow
// Rationale: tree/item render helpers need local closure state from VfsTreePanel.
// component-complexity: allow
// Rationale: orchestrates tree rendering plus folder dialogs/context menu in one sidebar entrypoint.
import {
  ChevronDown,
  ChevronRight,
  Clipboard,
  FileBox,
  Folder,
  FolderOpen,
  FolderPlus,
  Layers,
  Loader2,
  Share2,
  Trash2,
  UserCheck
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ALL_ITEMS_FOLDER_ID,
  SHARED_BY_ME_FOLDER_ID,
  SHARED_WITH_ME_FOLDER_ID,
  TRASH_FOLDER_ID,
  UNFILED_FOLDER_ID,
  VFS_ROOT_ID
} from '../constants';
import { useVfsClipboard } from '../context';
import { useEnsureVfsRoot, useVfsFolders, type VfsFolderNode } from '../hooks';
import { cn, OBJECT_TYPE_COLORS, OBJECT_TYPE_ICONS } from '../lib';
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

interface EmptySpaceContextMenuState {
  x: number;
  y: number;
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
  onPaste?: ((targetFolderId: string) => void) | undefined;
}

interface VirtualFolderConfig {
  id: string;
  label: string;
  icon: typeof FileBox;
  iconClassName: string;
}

const VIRTUAL_FOLDERS: VirtualFolderConfig[] = [
  {
    id: UNFILED_FOLDER_ID,
    label: 'Unfiled Items',
    icon: FileBox,
    iconClassName: 'text-blue-600 dark:text-blue-400'
  },
  {
    id: ALL_ITEMS_FOLDER_ID,
    label: 'All Items',
    icon: Layers,
    iconClassName: 'text-purple-600 dark:text-purple-400'
  },
  {
    id: SHARED_BY_ME_FOLDER_ID,
    label: 'My Shared Items',
    icon: Share2,
    iconClassName: 'text-emerald-600 dark:text-emerald-400'
  },
  {
    id: SHARED_WITH_ME_FOLDER_ID,
    label: 'Shared With Me',
    icon: UserCheck,
    iconClassName: 'text-cyan-600 dark:text-cyan-400'
  },
  {
    id: TRASH_FOLDER_ID,
    label: 'Trash',
    icon: Trash2,
    iconClassName: 'text-rose-600 dark:text-rose-400'
  }
];

const NON_PASTE_FOLDERS = new Set(VIRTUAL_FOLDERS.map(({ id }) => id));

export function VfsTreePanel({
  width,
  onWidthChange,
  selectedFolderId,
  onFolderSelect,
  compact: _compact,
  refreshToken,
  onFolderChanged,
  onFolderShare,
  onPaste
}: VfsTreePanelProps) {
  // Ensure the VFS root exists before loading folders.
  const { isReady: isRootReady, isCreating: isRootCreating, error: rootError } =
    useEnsureVfsRoot();

  const { folders, loading, error, refetch } = useVfsFolders();
  const { hasItems } = useVfsClipboard();
  const prevRootReadyRef = useRef(isRootReady);

  useEffect(() => {
    const wasRootReady = prevRootReadyRef.current;
    if (!wasRootReady && isRootReady) {
      refetch();
    }
    prevRootReadyRef.current = isRootReady;
  }, [isRootReady, refetch]);

  useSidebarRefetch(refreshToken, refetch);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    new Set([VFS_ROOT_ID])
  );
  const { resizeHandleProps } = useResizableSidebar({
    width,
    onWidthChange,
    ariaLabel: 'Resize folders sidebar'
  });

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [emptySpaceContextMenu, setEmptySpaceContextMenu] =
    useState<EmptySpaceContextMenuState | null>(null);

  // Dialog states
  const [renameDialogFolder, setRenameDialogFolder] =
    useState<VfsFolderNode | null>(null);
  const [deleteDialogFolder, setDeleteDialogFolder] =
    useState<VfsFolderNode | null>(null);
  const [newSubfolderParent, setNewSubfolderParent] =
    useState<VfsFolderNode | null>(null);
  const [showNewRootFolderDialog, setShowNewRootFolderDialog] = useState(false);
  const isLoading = loading || !isRootReady || isRootCreating;
  const displayError = rootError ?? error;

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

  const handleEmptySpaceContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setEmptySpaceContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

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

  const renderVirtualFolder = useCallback(
    ({ id, label, icon: Icon, iconClassName }: VirtualFolderConfig) => (
      <VfsDroppableFolder key={id} folderId={id} disabled>
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm transition-colors',
            selectedFolderId === id
              ? 'bg-accent text-accent-foreground'
              : 'hover:bg-accent/50'
          )}
          style={{ paddingLeft: '8px' }}
          onClick={() => onFolderSelect(id)}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center" />
          <Icon className={cn('h-4 w-4 shrink-0', iconClassName)} />
          <span className="truncate">{label}</span>
        </button>
      </VfsDroppableFolder>
    ),
    [selectedFolderId, onFolderSelect]
  );

  const renderFolder = (folder: VfsFolderNode, depth: number) => {
    const isSelected = folder.id === selectedFolderId;
    const isExpanded = expandedFolderIds.has(folder.id);
    const hasChildren =
      folder.childCount > 0 || (folder.children && folder.children.length > 0);
    const Icon =
      folder.objectType === 'folder'
        ? isExpanded
          ? FolderOpen
          : Folder
        : OBJECT_TYPE_ICONS[folder.objectType];
    const iconClassName =
      folder.objectType === 'folder'
        ? 'text-yellow-600 dark:text-yellow-500'
        : OBJECT_TYPE_COLORS[folder.objectType];

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
            <Icon className={cn('h-4 w-4 shrink-0', iconClassName)} />
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
      className="relative flex shrink-0 flex-col border-r bg-muted/20 [border-color:var(--soft-border)]"
      style={{ width }}
    >
      <WindowSidebarHeader
        title="Folders"
        actionLabel="New Folder"
        onAction={() => setShowNewRootFolderDialog(true)}
        actionIcon={<FolderPlus className="h-4 w-4" />}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Context menu on empty space */}
      <div
        className="flex-1 overflow-y-auto p-1"
        onContextMenu={handleEmptySpaceContextMenu}
      >
        {VIRTUAL_FOLDERS.map(renderVirtualFolder)}

        {isLoading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {displayError && (
          <div className="px-2 py-4 text-center text-destructive text-xs">
            {displayError}
          </div>
        )}
        {!isLoading &&
          !displayError &&
          folders.map((folder) => renderFolder(folder, 0))}
      </div>
      <div
        className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-accent"
        {...resizeHandleProps}
      />

      {/* Folder Context Menu */}
      {contextMenu && (
        <FolderContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          folder={contextMenu.folder}
          onClose={() => setContextMenu(null)}
          onNewSubfolder={setNewSubfolderParent}
          onRename={setRenameDialogFolder}
          onDelete={setDeleteDialogFolder}
          onShare={onFolderShare}
          onPaste={onPaste}
        />
      )}

      {/* Empty Space Context Menu */}
      {emptySpaceContextMenu && (
        <WindowContextMenu
          x={emptySpaceContextMenu.x}
          y={emptySpaceContextMenu.y}
          onClose={() => setEmptySpaceContextMenu(null)}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              setShowNewRootFolderDialog(true);
              setEmptySpaceContextMenu(null);
            }}
          >
            <FolderPlus className="h-4 w-4" />
            New Folder
          </button>
          {hasItems &&
            onPaste &&
            selectedFolderId &&
            !NON_PASTE_FOLDERS.has(selectedFolderId) && (
              <>
                <div className="my-1 h-px bg-border" />
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    onPaste(selectedFolderId);
                    setEmptySpaceContextMenu(null);
                  }}
                >
                  <Clipboard className="h-4 w-4" />
                  Paste
                </button>
              </>
            )}
        </WindowContextMenu>
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

      {/* New Root Folder Dialog */}
      <NewFolderDialog
        open={showNewRootFolderDialog}
        onOpenChange={(open) => {
          if (!open) setShowNewRootFolderDialog(false);
        }}
        parentFolderId={null}
        onFolderCreated={handleFolderChanged}
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
