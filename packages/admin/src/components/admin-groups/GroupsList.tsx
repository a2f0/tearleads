import { api } from '@tearleads/api-client';
import type { GroupWithMemberCount } from '@tearleads/shared';
import {
  DesktopContextMenu as ContextMenu,
  DesktopContextMenuItem as ContextMenuItem,
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import { Loader2, Plus, Trash2, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useTypedTranslation } from '@/i18n';

interface GroupsListProps {
  onCreateClick?: (() => void) | undefined;
  onGroupSelect: (groupId: string) => void;
  organizationId?: string | null;
}

export function GroupsList({
  onCreateClick,
  onGroupSelect,
  organizationId
}: GroupsListProps) {
  const { t } = useTypedTranslation('admin');
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
      const response = await api.admin.groups.list(
        organizationId ? { organizationId } : undefined
      );
      setGroups(response.groups);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch groups');
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

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
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
        <Users className="h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 font-medium text-lg">{t('noGroupsYet')}</h3>
        <p className="mt-1 text-muted-foreground text-sm">
          {t('createGroupToOrganizeUsers')}
        </p>
        {onCreateClick && (
          <Button className="mt-4" onClick={onCreateClick}>
            <Plus className="mr-2 h-4 w-4" />
            {t('createGroup')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="overflow-auto rounded-lg border">
        <table className={WINDOW_TABLE_TYPOGRAPHY.table}>
          <thead className={WINDOW_TABLE_TYPOGRAPHY.header}>
            <tr>
              <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                {t('name')}
              </th>
              <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                {t('description')}
              </th>
              <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                {t('members')}
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <WindowTableRow
                key={group.id}
                onClick={() => onGroupSelect(group.id)}
                onContextMenu={(e) => handleContextMenu(e, group)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onGroupSelect(group.id);
                  }
                }}
              >
                <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                  <div className="flex items-center gap-2">
                    <Users className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{group.name}</span>
                  </div>
                </td>
                <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                  {group.description ? (
                    <span className="block truncate">{group.description}</span>
                  ) : (
                    <span className="text-muted-foreground/70">—</span>
                  )}
                </td>
                <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                  {t('membersCount', {
                    count: group.memberCount,
                    label: group.memberCount === 1 ? t('member') : t('members')
                  })}
                </td>
              </WindowTableRow>
            ))}
          </tbody>
        </table>
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
            <span className="text-destructive">{t('delete')}</span>
          </ContextMenuItem>
        </ContextMenu>
      )}

      <ConfirmDialog
        open={deleteDialog !== null}
        onOpenChange={(open) => !open && setDeleteDialog(null)}
        title={t('deleteGroup')}
        description={t('deleteGroupConfirm', {
          name: deleteDialog?.name ?? ''
        })}
        confirmLabel={t('delete')}
        onConfirm={handleDelete}
        variant="destructive"
      />
    </>
  );
}
