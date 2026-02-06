import { type FlatTreeItem, flattenTree } from '@rapid/shared';
import {
  ChevronDown,
  ChevronRight,
  FileEdit as Drafts,
  Folder,
  FolderOpen,
  FolderPlus,
  Inbox,
  Loader2,
  Mail,
  Send,
  ShieldAlert,
  Trash2
} from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { ALL_MAIL_ID, useEmailFolders } from '../../hooks/useEmailFolders';
import {
  canDeleteFolder,
  canRenameFolder,
  type EmailFolder,
  isSystemFolder
} from '../../types/folder.js';
import { CreateFolderDialog } from './CreateFolderDialog';
import { DeleteFolderDialog } from './DeleteFolderDialog';
import { EmailFolderContextMenu } from './EmailFolderContextMenu';
import { RenameFolderDialog } from './RenameFolderDialog';

export interface EmailFoldersSidebarProps {
  width: number;
  onWidthChange: (width: number) => void;
  selectedFolderId: string | null;
  onFolderSelect: (folderId: string | null) => void;
  refreshToken?: number;
  onFolderChanged?: () => void;
}

function getFolderIcon(folderType: string, isExpanded: boolean) {
  switch (folderType) {
    case 'inbox':
      return Inbox;
    case 'sent':
      return Send;
    case 'drafts':
      return Drafts;
    case 'trash':
      return Trash2;
    case 'spam':
      return ShieldAlert;
    default:
      return isExpanded ? FolderOpen : Folder;
  }
}

export function EmailFoldersSidebar({
  width,
  onWidthChange,
  selectedFolderId,
  onFolderSelect,
  onFolderChanged
}: EmailFoldersSidebarProps) {
  const {
    systemFolders,
    folderTree,
    loading,
    error,
    hasFetched,
    expandedIds,
    toggleExpanded,
    refetch,
    createFolder,
    renameFolder,
    deleteFolder
  } = useEmailFolders();

  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDialogParentId, setCreateDialogParentId] = useState<
    string | null
  >(null);
  const [renameDialogFolder, setRenameDialogFolder] =
    useState<EmailFolder | null>(null);
  const [deleteDialogFolder, setDeleteDialogFolder] =
    useState<EmailFolder | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    folder: EmailFolder;
  } | null>(null);

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
    [onWidthChange, width]
  );

  const handleResizeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const delta = e.key === 'ArrowRight' ? 10 : -10;
      const newWidth = Math.max(150, Math.min(400, width + delta));
      onWidthChange(newWidth);
    },
    [onWidthChange, width]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, folder: EmailFolder) => {
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

  const handleFolderDeleted = useCallback(
    (deletedId: string) => {
      if (selectedFolderId === deletedId) {
        onFolderSelect(ALL_MAIL_ID);
      }
      handleFolderChanged();
    },
    [handleFolderChanged, onFolderSelect, selectedFolderId]
  );

  const handleCreateSubfolder = useCallback((parentId: string | null) => {
    setCreateDialogParentId(parentId);
    setCreateDialogOpen(true);
    setContextMenu(null);
  }, []);

  // Flatten tree for rendering
  const flattenedCustomFolders = flattenTree(folderTree, expandedIds);

  const renderFolderItem = (
    folder: EmailFolder,
    depth: number,
    hasChildren: boolean,
    isExpanded: boolean
  ) => {
    const Icon = getFolderIcon(folder.folderType, isExpanded);
    const isSelected = selectedFolderId === folder.id;
    const isSystem = isSystemFolder(folder);
    const isCustomFolder = folder.folderType === 'custom';

    return (
      <div key={folder.id} data-testid={`email-folder-${folder.id}`}>
        <button
          type="button"
          className={`flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm transition-colors ${
            isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => onFolderSelect(folder.id)}
          onDoubleClick={() => hasChildren && toggleExpanded(folder.id)}
          onContextMenu={(e) => {
            if (!isSystem) handleContextMenu(e, folder);
          }}
        >
          {/* biome-ignore lint/a11y/useSemanticElements: span with role=button used to avoid nested button elements */}
          <span
            role="button"
            tabIndex={hasChildren ? 0 : -1}
            className="flex h-4 w-4 shrink-0 items-center justify-center"
            aria-label={hasChildren ? (isExpanded ? 'Collapse' : 'Expand') : undefined}
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) toggleExpanded(folder.id);
            }}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && hasChildren) {
                e.stopPropagation();
                toggleExpanded(folder.id);
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
          <Icon
            className={`h-4 w-4 shrink-0 ${
              isCustomFolder
                ? 'text-yellow-600 dark:text-yellow-500'
                : 'text-primary'
            }`}
          />
          <span className="truncate">{folder.name}</span>
          {folder.unreadCount > 0 && (
            <span className="ml-auto text-muted-foreground text-xs">
              {folder.unreadCount}
            </span>
          )}
        </button>
      </div>
    );
  };

  return (
    <div
      className="relative flex shrink-0 flex-col border-r bg-muted/20"
      style={{ width }}
      data-testid="email-folders-sidebar"
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="font-medium text-muted-foreground text-xs">
          Folders
        </span>
        <button
          type="button"
          onClick={() => handleCreateSubfolder(null)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          title="New Folder"
          data-testid="email-new-folder-button"
        >
          <FolderPlus className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-1">
        {/* All Mail option */}
        <button
          type="button"
          className={`flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm transition-colors ${
            selectedFolderId === ALL_MAIL_ID || selectedFolderId === null
              ? 'bg-accent text-accent-foreground'
              : 'hover:bg-accent/50'
          }`}
          style={{ paddingLeft: '8px' }}
          onClick={() => onFolderSelect(ALL_MAIL_ID)}
          data-testid="email-folder-all-mail"
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center" />
          <Mail className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <span className="truncate">All Mail</span>
        </button>

        {/* Loading state */}
        {loading && !hasFetched && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="px-2 py-4 text-center text-destructive text-xs">
            {error}
          </div>
        )}

        {/* System folders */}
        {hasFetched && systemFolders.length > 0 && (
          <div className="mt-2">
            <div className="px-2 py-1 font-medium text-muted-foreground text-xs">
              System
            </div>
            {systemFolders.map((folder) =>
              renderFolderItem(folder, 0, false, false)
            )}
          </div>
        )}

        {/* Custom folders */}
        {hasFetched && flattenedCustomFolders.length > 0 && (
          <div className="mt-2">
            <div className="px-2 py-1 font-medium text-muted-foreground text-xs">
              Folders
            </div>
            {flattenedCustomFolders.map((item: FlatTreeItem<EmailFolder>) =>
              renderFolderItem(
                item.node.data,
                item.node.depth,
                item.hasChildren,
                item.isExpanded
              )
            )}
          </div>
        )}
      </div>

      {/* Resize handle */}
      <hr
        className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize border-0 bg-transparent hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
        onMouseDown={handleMouseDown}
        onKeyDown={handleResizeKeyDown}
        tabIndex={0}
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={150}
        aria-valuemax={400}
        aria-label="Resize folder sidebar"
      />

      {/* Context menu */}
      {contextMenu && (
        <EmailFolderContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          folder={contextMenu.folder}
          onClose={() => setContextMenu(null)}
          onCreateSubfolder={() => handleCreateSubfolder(contextMenu.folder.id)}
          onRename={(folder) => {
            if (canRenameFolder(folder)) {
              setRenameDialogFolder(folder);
            }
          }}
          onDelete={(folder) => {
            if (canDeleteFolder(folder)) {
              setDeleteDialogFolder(folder);
            }
          }}
        />
      )}

      {/* Dialogs */}
      <CreateFolderDialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          setCreateDialogOpen(open);
          if (!open) setCreateDialogParentId(null);
        }}
        parentId={createDialogParentId}
        onFolderCreated={handleFolderChanged}
        createFolder={createFolder}
      />

      <RenameFolderDialog
        open={renameDialogFolder !== null}
        onOpenChange={(open) => {
          if (!open) setRenameDialogFolder(null);
        }}
        folder={renameDialogFolder}
        onRename={renameFolder}
        onFolderRenamed={handleFolderChanged}
      />

      <DeleteFolderDialog
        open={deleteDialogFolder !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteDialogFolder(null);
        }}
        folder={deleteDialogFolder}
        onDelete={deleteFolder}
        onFolderDeleted={handleFolderDeleted}
      />
    </div>
  );
}
