import { contactEmails, contacts, vfsLinks } from '@tearleads/db/sqlite';
import {
  useResizableSidebar,
  useSidebarDragOver,
  WindowSidebarError,
  WindowSidebarHeader,
  WindowSidebarItem,
  WindowSidebarLoading
} from '@tearleads/window-manager';
import { and, asc, eq, sql } from 'drizzle-orm';
import { Folder, FolderPlus, Mail, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useContactsContext, useContactsUI } from '../context';
import { type ContactGroup, useContactGroups } from '../hooks';
import { getContactDragIds } from '../lib/contactDragData';
import { openComposeEmail } from '../lib/contactEmail';
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
  onDropToGroup?:
    | ((groupId: string, contactIds: string[]) => Promise<void>)
    | undefined;
}

export function ContactsGroupsSidebar({
  width,
  onWidthChange,
  selectedGroupId,
  onGroupSelect,
  onGroupChanged,
  onDropToGroup
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
  const { getDatabase, openEmailComposer } = useContactsContext();
  const { ContextMenu, ContextMenuItem } = useContactsUI();
  const [groupCounts, setGroupCounts] = useState<Record<string, number>>({});
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
  const { dragOverId, handleDragEnter, handleDragLeave, clearDragState } =
    useSidebarDragOver();

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

  const updateGroupCounts = useCallback(
    async (groupIds: string[]) => {
      if (groupIds.length === 0) return;
      try {
        const db = getDatabase();
        const uniqueIds = Array.from(new Set(groupIds));
          const counts = await Promise.all(
            uniqueIds.map(async (groupId) => {
              const [{ count }] = await db
                .select({
                  count: sql<number>`COUNT(*)`.mapWith(Number)
                })
                .from(vfsLinks)
                .innerJoin(
                  contacts,
                  and(
                    eq(contacts.id, vfsLinks.childId),
                    eq(contacts.deleted, false)
                  )
                )
                .where(eq(vfsLinks.parentId, groupId));
              return { groupId, count };
            })
          );
        setGroupCounts((prev) => {
          const next = { ...prev };
          for (const { groupId, count } of counts) {
            next[groupId] = count;
          }
          return next;
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('Database not initialized')
        ) {
          return;
        }
        console.error('Failed to update contact group counts', error);
      }
    },
    [getDatabase]
  );

  useEffect(() => {
    if (groups.length === 0) return;
    setGroupCounts((prev) => {
      const next = { ...prev };
      groups.forEach((group) => {
        next[group.id] = Number.isFinite(group.contactCount)
          ? group.contactCount
          : 0;
      });
      return next;
    });
  }, [groups]);

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

  const handleGroupDragOver = useCallback(
    (event: React.DragEvent, _groupId: string) => {
      if (!onDropToGroup) return;
      event.preventDefault();
      event.stopPropagation();
    },
    [onDropToGroup]
  );

  const handleGroupDragEnter = useCallback(
    (event: React.DragEvent, groupId: string) => {
      if (!onDropToGroup) return;
      event.preventDefault();
      event.stopPropagation();

      handleDragEnter(groupId);
    },
    [onDropToGroup, handleDragEnter]
  );

  const handleGroupDragLeave = useCallback(
    (event: React.DragEvent, groupId: string) => {
      if (!onDropToGroup) return;
      event.preventDefault();
      event.stopPropagation();

      handleDragLeave(groupId);
    },
    [onDropToGroup, handleDragLeave]
  );

  const handleGroupDrop = useCallback(
    async (event: React.DragEvent, groupId: string) => {
      if (!onDropToGroup) return;
      event.preventDefault();
      event.stopPropagation();

      clearDragState(groupId);

      const contactIds = getContactDragIds(event.dataTransfer);
      if (contactIds.length === 0) return;

      try {
        await onDropToGroup(groupId, contactIds);
        await handleGroupChanged();
        await updateGroupCounts([groupId]);
      } catch (error) {
        console.error('Failed to handle contact group drop', error);
      }
    },
    [handleGroupChanged, onDropToGroup, clearDragState, updateGroupCounts]
  );

  const handleSendEmailToGroup = useCallback(async () => {
    if (!contextMenu) return;

    try {
      const db = getDatabase();
      const groupEmails = await db
        .select({ email: contactEmails.email })
        .from(vfsLinks)
        .innerJoin(
          contacts,
          and(eq(contacts.id, vfsLinks.childId), eq(contacts.deleted, false))
        )
        .innerJoin(
          contactEmails,
          and(
            eq(contactEmails.contactId, contacts.id),
            eq(contactEmails.isPrimary, true)
          )
        )
        .where(eq(vfsLinks.parentId, contextMenu.group.id))
        .orderBy(asc(contactEmails.email));

      openComposeEmail(
        groupEmails.map((row) => row.email),
        openEmailComposer
      );
    } catch (err) {
      console.error('Failed to send group email:', err);
    } finally {
      queueCloseContextMenu();
    }
  }, [contextMenu, getDatabase, openEmailComposer, queueCloseContextMenu]);

  return (
    <div
      className="relative flex shrink-0 flex-col border-r bg-muted/20"
      style={{ width }}
      data-testid="contacts-groups-sidebar"
    >
      <WindowSidebarHeader
        title="Groups"
        actionLabel="New Group"
        onAction={() => setNewGroupDialogOpen(true)}
        actionIcon={<Plus className="h-4 w-4" />}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Context menu on empty space */}
      <div
        className="flex-1 overflow-y-auto p-1"
        onContextMenu={handleEmptySpaceContextMenu}
      >
        <WindowSidebarItem
          label="All Contacts"
          icon={<Folder className="h-4 w-4 shrink-0 text-primary" />}
          selected={
            selectedGroupId === ALL_CONTACTS_ID || selectedGroupId === null
          }
          onClick={() => onGroupSelect(ALL_CONTACTS_ID)}
        />

        {loading && <WindowSidebarLoading />}
        {error && <WindowSidebarError message={error} />}
        {!loading &&
          !error &&
          groups.map((group) => (
            <WindowSidebarItem
              key={group.id}
              label={group.name}
              icon={<Folder className="h-4 w-4 shrink-0 text-primary" />}
              selected={selectedGroupId === group.id}
              className={
                dragOverId === group.id
                  ? 'bg-primary/10 ring-2 ring-primary ring-inset'
                  : undefined
              }
              onClick={() => onGroupSelect(group.id)}
              onContextMenu={(event) => handleContextMenu(event, group)}
              onDragOver={(event) => handleGroupDragOver(event, group.id)}
              onDragEnter={(event) => handleGroupDragEnter(event, group.id)}
              onDragLeave={(event) => handleGroupDragLeave(event, group.id)}
              onDrop={(event) => handleGroupDrop(event, group.id)}
              count={
                groupCounts[group.id] ??
                (Number.isFinite(group.contactCount) ? group.contactCount : 0)
              }
            />
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
            icon={<Mail className="h-4 w-4" />}
            onClick={() => {
              void handleSendEmailToGroup();
            }}
          >
            Send email
          </ContextMenuItem>
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
