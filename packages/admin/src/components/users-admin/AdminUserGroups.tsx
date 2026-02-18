import type { AdminUser, GroupWithMemberCount } from '@tearleads/shared';
import { Loader2, UserMinus, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@tearleads/ui';
import { useTypedTranslation } from '@/i18n';
import { useAdminUserGroups } from './useAdminUserGroups';

interface AdminUserGroupsProps {
  user: AdminUser;
}

export function AdminUserGroups({ user }: AdminUserGroupsProps) {
  const { t } = useTypedTranslation('admin');
  const {
    groups,
    groupMemberships,
    loading,
    error,
    actionError,
    actionId,
    fetchGroups,
    addToGroup,
    removeFromGroup
  } = useAdminUserGroups(user.id);

  const [removeGroupDialog, setRemoveGroupDialog] =
    useState<GroupWithMemberCount | null>(null);

  const handleConfirmRemoveFromGroup = async () => {
    if (!removeGroupDialog) return;
    await removeFromGroup(removeGroupDialog.id);
    setRemoveGroupDialog(null);
  };

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-lg">{t('groups')}</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void fetchGroups()}
          disabled={loading}
        >
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Refresh
        </Button>
      </div>

      {actionError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
          <p className="text-destructive text-sm">{actionError}</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
          <p className="text-destructive text-sm">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading groups...
        </div>
      ) : groups.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground text-sm">
          No groups available
        </p>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => {
            const membership = groupMemberships[group.id];
            const isMember = membership?.isMember ?? false;
            const isUpdating = actionId === group.id;
            return (
              <div
                key={group.id}
                className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{group.name}</p>
                  {group.description && (
                    <p className="mt-1 truncate text-muted-foreground text-sm">
                      {group.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
                    <span>
                      {group.memberCount}{' '}
                      {group.memberCount === 1 ? 'member' : 'members'}
                    </span>
                    <span>
                      {isMember ? 'Member' : 'Not a member'}
                      {membership?.joinedAt
                        ? ` since ${new Date(
                            membership.joinedAt
                          ).toLocaleDateString()}`
                        : ''}
                    </span>
                  </div>
                </div>
                <Button
                  variant={isMember ? 'ghost' : 'default'}
                  size="sm"
                  onClick={() =>
                    isMember
                      ? setRemoveGroupDialog(group)
                      : void addToGroup(group.id)
                  }
                  disabled={isUpdating}
                  data-testid={
                    isMember
                      ? `remove-user-from-group-${group.id}`
                      : `add-user-to-group-${group.id}`
                  }
                >
                  {isUpdating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : isMember ? (
                    <UserMinus className="mr-2 h-4 w-4" />
                  ) : (
                    <UserPlus className="mr-2 h-4 w-4" />
                  )}
                  {isMember ? 'Remove' : 'Add'}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={removeGroupDialog !== null}
        onOpenChange={(open) => !open && setRemoveGroupDialog(null)}
        title={t('removeFromGroup')}
        description={t('removeFromGroupConfirm', {
          email: user.email,
          name: removeGroupDialog?.name
        })}
        confirmLabel={t('remove')}
        onConfirm={handleConfirmRemoveFromGroup}
        variant="destructive"
      />
    </div>
  );
}
