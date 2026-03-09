import { type FlatTreeItem, flattenTree } from '@tearleads/shared';
import { useResizableSidebar } from '@tearleads/window-manager';
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
import { useCallback, useState } from 'react';
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
import { EmptySpaceContextMenu } from './EmptySpaceContextMenu';
import { RenameFolderDialog } from './RenameFolderDialog';

interface EmailFoldersSidebarProps {
  width: number;
  onWidthChange: (width: number) => void;
  selectedFolderId: string | null;
  onFolderSelect: (
    folderId: string | null,
    folder?: EmailFolder | null
  ) => void;
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

  const [emptySpaceContextMenu, setEmptySpaceContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const { resizeHandleProps } = useResizableSidebar({
    width,
    onWidthChange,
    ariaLabel: 'Resize folder sidebar'
  });

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, folder: EmailFolder) => {
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

  const handleFolderDeleted = useCallback(
    (deletedId: string) => {
      if (selectedFolderId === deletedId) {
        onFolderSelect(ALL_MAIL_ID, null);
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
      <div
        key={folder.id}
        data-testid={`email-folder-${folder.id}`}
        className="flex items-center"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        {/* Expand/collapse button for custom folders - separate from select button for accessibility */}
        {isCustomFolder &&
          (hasChildren ? (
            <button
              type="button"
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
              className="flex h-6 w-4 shrink-0 items-center justify-center rounded hover:bg-accent/50"
              onClick={() => toggleExpanded(folder.id)}
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          ))}
        {/* Folder select button */}
        <button
          type="button"
          className={`flex flex-1 items-center gap-1 rounded px-2 py-1 text-left text-sm transition-colors ${
            isSelected
              ? 'bg-accent text-accent-foreground'
              : 'hover:bg-accent/50'
          }`}
          onClick={() => onFolderSelect(folder.id, folder)}
          onDoubleClick={() => hasChildren && toggleExpanded(folder.id)}
          onContextMenu={(e) => {
            if (!isSystem) handleContextMenu(e, folder);
          }}
        >
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

      {/* biome-ignore lint/a11y/noStaticElementInteractions: Context menu on empty space */}
      <div
        className="flex-1 overflow-y-auto p-1"
        onContextMenu={handleEmptySpaceContextMenu}
      >
        {/* All Mail option */}
        <div className="flex items-center" data-testid="email-folder-all-mail">
          <button
            type="button"
            className={`flex flex-1 items-center gap-1 rounded px-2 py-1 text-left text-sm transition-colors ${
              selectedFolderId === ALL_MAIL_ID || selectedFolderId === null
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-accent/50'
            }`}
            onClick={() => onFolderSelect(ALL_MAIL_ID, null)}
          >
            <Mail className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <span className="truncate">All Mail</span>
          </button>
        </div>

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
        {...resizeHandleProps}
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

      {/* Empty space context menu */}
      {emptySpaceContextMenu && (
        <EmptySpaceContextMenu
          x={emptySpaceContextMenu.x}
          y={emptySpaceContextMenu.y}
          onClose={() => setEmptySpaceContextMenu(null)}
          onNewFolder={() => handleCreateSubfolder(null)}
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
