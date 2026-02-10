import { useResizableSidebar } from '@rapid/window-manager';
import { Folder, FolderPlus, Loader2, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useContactsUI } from '../context';
import { type ContactGroup, useContactGroups } from '../hooks';
import { DeleteContactGroupDialog } from './DeleteContactGroupDialog';
import { NewContactGroupDialog } from './NewContactGroupDialog';
import { RenameContactGroupDialog } from './RenameContactGroupDialog';

export const ALL_CONTACTS_ID = '__all__';

interface ContactsGroupsSidebarProps {
  width: number;
  onWidthChange: (width: number) => void;
  selectedGroupId: string | null;
  onGroupSelect: (groupId: string | null) => void;
  onGroupChanged?: (() => void) | undefined;
}

export function ContactsGroupsSidebar({
  width,
  onWidthChange,
  selectedGroupId,
  onGroupSelect,
  onGroupChanged
}: ContactsGroupsSidebarProps) {
  const {
    groups,
    loading,
    error,
    refetch,
    createGroup,
    renameGroup,
    deleteGroup
  } = useContactGroups();
  const { ContextMenu, ContextMenuItem } = useContactsUI();
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    group: ContactGroup;
  } | null>(null);
  const [emptySpaceContextMenu, setEmptySpaceContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [newGroupDialogOpen, setNewGroupDialogOpen] = useState(false);
  const [renameDialogGroup, setRenameDialogGroup] =
    useState<ContactGroup | null>(null);
  const [deleteDialogGroup, setDeleteDialogGroup] =
    useState<ContactGroup | null>(null);
  const closeContextMenuTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (closeContextMenuTimerRef.current !== null) {
        window.clearTimeout(closeContextMenuTimerRef.current);
      }
    },
    []
  );

  const { resizeHandleProps } = useResizableSidebar({
    width,
    onWidthChange,
    ariaLabel: 'Resize contact groups sidebar'
  });

  const handleContextMenu = useCallback(
    (event: React.MouseEvent, group: ContactGroup) => {
      event.preventDefault();
      event.stopPropagation();
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        group
      });
    },
    []
  );

  const handleEmptySpaceContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setEmptySpaceContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const clearEmptySpaceContextMenu = useCallback(() => {
    setEmptySpaceContextMenu(null);
  }, []);

  const handleNewGroupFromEmptySpace = useCallback(() => {
    setNewGroupDialogOpen(true);
    setEmptySpaceContextMenu(null);
  }, []);

  const clearContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleGroupChanged = useCallback(async () => {
    await refetch();
    onGroupChanged?.();
  }, [onGroupChanged, refetch]);

  const handleGroupDeleted = useCallback(
    async (groupId: string) => {
      if (selectedGroupId === groupId) {
        onGroupSelect(ALL_CONTACTS_ID);
      }
      await handleGroupChanged();
    },
    [handleGroupChanged, onGroupSelect, selectedGroupId]
  );

  const queueCloseContextMenu = useCallback(() => {
    closeContextMenuTimerRef.current = window.setTimeout(() => {
      clearContextMenu();
      closeContextMenuTimerRef.current = null;
    }, 0);
  }, [clearContextMenu]);

  return (
    <div
      className="relative flex shrink-0 flex-col border-r bg-muted/20"
      style={{ width }}
      data-testid="contacts-groups-sidebar"
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="font-medium text-muted-foreground text-xs">
          Groups
        </span>
        <button
          type="button"
          onClick={() => setNewGroupDialogOpen(true)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          title="New Group"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Context menu on empty space */}
      <div
        className="flex-1 overflow-y-auto p-1"
        onContextMenu={handleEmptySpaceContextMenu}
      >
        <button
          type="button"
          className={`flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm transition-colors ${
            selectedGroupId === ALL_CONTACTS_ID || selectedGroupId === null
              ? 'bg-accent text-accent-foreground'
              : 'hover:bg-accent/50'
          }`}
          style={{ paddingLeft: '8px' }}
          onClick={() => onGroupSelect(ALL_CONTACTS_ID)}
        >
          <Folder className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">All Contacts</span>
        </button>

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
        {!loading &&
          !error &&
          groups.map((group) => (
            <button
              key={group.id}
              type="button"
              className={`flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm transition-colors ${
                selectedGroupId === group.id
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/50'
              }`}
              style={{ paddingLeft: '8px' }}
              onClick={() => onGroupSelect(group.id)}
              onContextMenu={(event) => handleContextMenu(event, group)}
            >
              <Folder className="h-4 w-4 shrink-0 text-primary" />
              <span className="flex-1 truncate">{group.name}</span>
              <span className="text-muted-foreground text-xs">
                {Number.isFinite(group.contactCount) ? group.contactCount : 0}
              </span>
            </button>
          ))}
      </div>
      <div
        className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-accent"
        {...resizeHandleProps}
      />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={clearContextMenu}
        >
          <ContextMenuItem
            onClick={() => {
              setRenameDialogGroup(contextMenu.group);
              queueCloseContextMenu();
            }}
          >
            Rename
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Trash2 className="h-4 w-4" />}
            onClick={() => {
              setDeleteDialogGroup(contextMenu.group);
              queueCloseContextMenu();
            }}
          >
            Delete
          </ContextMenuItem>
        </ContextMenu>
      )}

      {emptySpaceContextMenu && (
        <ContextMenu
          x={emptySpaceContextMenu.x}
          y={emptySpaceContextMenu.y}
          onClose={clearEmptySpaceContextMenu}
        >
          <ContextMenuItem
            icon={<FolderPlus className="h-4 w-4" />}
            onClick={handleNewGroupFromEmptySpace}
          >
            New Group
          </ContextMenuItem>
        </ContextMenu>
      )}

      <NewContactGroupDialog
        open={newGroupDialogOpen}
        onOpenChange={setNewGroupDialogOpen}
        onCreate={async (name) => {
          await createGroup(name);
          await handleGroupChanged();
        }}
      />

      <RenameContactGroupDialog
        open={renameDialogGroup !== null}
        onOpenChange={(open) => {
          if (!open) setRenameDialogGroup(null);
        }}
        group={renameDialogGroup}
        onRename={async (groupId, name) => {
          await renameGroup(groupId, name);
          await handleGroupChanged();
        }}
      />

      <DeleteContactGroupDialog
        open={deleteDialogGroup !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteDialogGroup(null);
        }}
        group={deleteDialogGroup}
        onDelete={async (groupId) => {
          await deleteGroup(groupId);
          await handleGroupDeleted(groupId);
        }}
      />
    </div>
  );
}
