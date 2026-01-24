import type { GroupWithMemberCount } from '@rapid/shared';
import { Loader2, Plus, Trash2, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { api } from '@/lib/api';

interface GroupsListProps {
  onCreateClick?: () => void;
  onGroupSelect: (groupId: string) => void;
}

export function GroupsList({ onCreateClick, onGroupSelect }: GroupsListProps) {
  const [groups, setGroups] = useState<GroupWithMemberCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    group: GroupWithMemberCount;
  } | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<GroupWithMemberCount | null>(
    null
  );

  const fetchGroups = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.admin.groups.list();
      setGroups(response.groups);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch groups');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchGroups();
  }, [fetchGroups]);

  const handleContextMenu = (
    e: React.MouseEvent,
    group: GroupWithMemberCount
  ) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, group });
  };

  const handleDelete = async () => {
    if (!deleteDialog) return;

    await api.admin.groups.delete(deleteDialog.id);
    setGroups((prev) => prev.filter((g) => g.id !== deleteDialog.id));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
        <p className="text-destructive text-sm">{error}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => void fetchGroups()}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
        <Users className="h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 font-medium text-lg">No groups yet</h3>
        <p className="mt-1 text-muted-foreground text-sm">
          Create a group to organize users
        </p>
        {onCreateClick && (
          <Button className="mt-4" onClick={onCreateClick}>
            <Plus className="mr-2 h-4 w-4" />
            Create Group
          </Button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            onClick={() => onGroupSelect(group.id)}
            onContextMenu={(e) => handleContextMenu(e, group)}
            className="flex w-full items-center justify-between rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent"
          >
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-medium">{group.name}</h3>
              {group.description && (
                <p className="mt-1 truncate text-muted-foreground text-sm">
                  {group.description}
                </p>
              )}
            </div>
            <div className="ml-4 flex items-center gap-2 text-muted-foreground text-sm">
              <Users className="h-4 w-4" />
              <span>
                {group.memberCount}{' '}
                {group.memberCount === 1 ? 'member' : 'members'}
              </span>
            </div>
          </button>
        ))}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        >
          <ContextMenuItem
            onClick={() => {
              setDeleteDialog(contextMenu.group);
              setContextMenu(null);
            }}
          >
            <Trash2 className="mr-2 h-4 w-4 text-destructive" />
            <span className="text-destructive">Delete</span>
          </ContextMenuItem>
        </ContextMenu>
      )}

      <ConfirmDialog
        open={deleteDialog !== null}
        onOpenChange={(open) => !open && setDeleteDialog(null)}
        title="Delete Group"
        description={`Are you sure you want to delete "${deleteDialog?.name}"? This will remove all members from the group.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        variant="destructive"
      />
    </>
  );
}
