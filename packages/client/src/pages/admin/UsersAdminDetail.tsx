import type {
  AdminUser,
  AdminUserUpdatePayload,
  GroupWithMemberCount
} from '@rapid/shared';
import { Check, Copy, Loader2, Save, UserMinus, UserPlus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn, formatNumber, formatTimestamp } from '@/lib/utils';

interface UsersAdminDetailProps {
  userId?: string | null;
  backLink?: ReactNode;
}

export function UsersAdminDetail({
  userId: userIdProp,
  backLink
}: UsersAdminDetailProps) {
  const params = useParams<{ id: string }>();
  const userId = userIdProp ?? params.id ?? null;

  const [user, setUser] = useState<AdminUser | null>(null);
  const [draft, setDraft] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [organizationIdsInput, setOrganizationIdsInput] = useState('');
  const [isIdCopied, setIsIdCopied] = useState(false);
  const [groups, setGroups] = useState<GroupWithMemberCount[]>([]);
  const [groupMemberships, setGroupMemberships] = useState<
    Record<string, { isMember: boolean; joinedAt: string | undefined }>
  >({});
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [groupActionError, setGroupActionError] = useState<string | null>(null);
  const [groupActionId, setGroupActionId] = useState<string | null>(null);
  const [removeGroupDialog, setRemoveGroupDialog] =
    useState<GroupWithMemberCount | null>(null);

  const fetchUser = useCallback(async () => {
    if (!userId) {
      setError('No user ID provided');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await api.admin.users.get(userId);
      setUser(response.user);
      setDraft(response.user);
      setOrganizationIdsInput(response.user.organizationIds.join(', '));
    } catch (err) {
      console.error('Failed to fetch user:', err);
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('404')) {
        setError('User not found');
        setUser(null);
        setDraft(null);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const parseOrganizationIds = useCallback((input: string) => {
    const parts = input
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    return Array.from(new Set(parts));
  }, []);

  const fetchGroups = useCallback(async () => {
    if (!userId) return;

    try {
      setGroupsLoading(true);
      setGroupsError(null);
      const response = await api.admin.groups.list();
      setGroups(response.groups);

      const membershipEntries = await Promise.all(
        response.groups.map(async (group) => {
          try {
            const membersResponse = await api.admin.groups.getMembers(group.id);
            const member = membersResponse.members.find(
              (entry) => entry.userId === userId
            );
            return {
              groupId: group.id,
              membership: {
                isMember: Boolean(member),
                joinedAt: member?.joinedAt
              },
              error: null as Error | null
            };
          } catch (err) {
            return {
              groupId: group.id,
              membership: { isMember: false, joinedAt: undefined },
              error: err instanceof Error ? err : new Error(String(err))
            };
          }
        })
      );

      const memberships: Record<
        string,
        { isMember: boolean; joinedAt: string | undefined }
      > = {};
      for (const entry of membershipEntries) {
        memberships[entry.groupId] = entry.membership;
      }
      setGroupMemberships(memberships);

      if (membershipEntries.some((entry) => entry.error)) {
        setGroupsError('Failed to load some group memberships');
      }
    } catch (err) {
      setGroupsError(
        err instanceof Error ? err.message : 'Failed to load groups'
      );
    } finally {
      setGroupsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!user) return;
    void fetchGroups();
  }, [fetchGroups, user]);

  const buildUpdatePayload = useCallback(
    (current: AdminUser, edited: AdminUser) => {
      const payload: AdminUserUpdatePayload = {};
      if (edited.email.trim().toLowerCase() !== current.email) {
        payload.email = edited.email.trim().toLowerCase();
      }
      if (edited.emailConfirmed !== current.emailConfirmed) {
        payload.emailConfirmed = edited.emailConfirmed;
      }
      if (edited.admin !== current.admin) {
        payload.admin = edited.admin;
      }
      const nextOrganizationIds = parseOrganizationIds(organizationIdsInput);
      const currentOrganizationIds = current.organizationIds;
      const orgsChanged =
        nextOrganizationIds.length !== currentOrganizationIds.length ||
        nextOrganizationIds.some(
          (orgId, index) => orgId !== currentOrganizationIds[index]
        );
      if (orgsChanged) {
        payload.organizationIds = nextOrganizationIds;
      }
      return payload;
    },
    [organizationIdsInput, parseOrganizationIds]
  );

  const handleSave = useCallback(async () => {
    if (!user || !draft) return;

    const payload = buildUpdatePayload(user, draft);
    if (Object.keys(payload).length === 0) {
      return;
    }

    setSaveError(null);
    setSaving(true);
    try {
      const response = await api.admin.users.update(user.id, payload);
      setUser(response.user);
      setDraft(response.user);
      setOrganizationIdsInput(response.user.organizationIds.join(', '));
    } catch (err) {
      console.error('Failed to update user:', err);
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [buildUpdatePayload, draft, user]);

  const handleReset = useCallback(() => {
    if (user) {
      setDraft(user);
      setSaveError(null);
      setOrganizationIdsInput(user.organizationIds.join(', '));
    }
  }, [user]);

  const copyUserId = useCallback(() => {
    if (!user) return;
    navigator.clipboard
      .writeText(user.id)
      .then(() => {
        setIsIdCopied(true);
        setTimeout(() => setIsIdCopied(false), 2000);
      })
      .catch((err) => {
        console.error('Failed to copy user id:', err);
      });
  }, [user]);

  const handleAddToGroup = useCallback(
    async (groupId: string) => {
      if (!user) return;

      try {
        setGroupActionId(groupId);
        setGroupActionError(null);
        await api.admin.groups.addMember(groupId, user.id);
        setGroupMemberships((prev) => ({
          ...prev,
          [groupId]: { isMember: true, joinedAt: new Date().toISOString() }
        }));
        setGroups((prev) =>
          prev.map((group) =>
            group.id === groupId
              ? { ...group, memberCount: group.memberCount + 1 }
              : group
          )
        );
      } catch (err) {
        if (err instanceof Error && err.message.includes('409')) {
          setGroupActionError('User is already a member of this group');
        } else if (err instanceof Error && err.message.includes('404')) {
          setGroupActionError('Group or user not found');
        } else {
          setGroupActionError(
            err instanceof Error ? err.message : 'Failed to add user to group'
          );
        }
      } finally {
        setGroupActionId(null);
      }
    },
    [user]
  );

  const handleConfirmRemoveFromGroup = useCallback(async () => {
    if (!user || !removeGroupDialog) return;

    try {
      setGroupActionId(removeGroupDialog.id);
      setGroupActionError(null);
      await api.admin.groups.removeMember(removeGroupDialog.id, user.id);
      setGroupMemberships((prev) => ({
        ...prev,
        [removeGroupDialog.id]: { isMember: false, joinedAt: undefined }
      }));
      setGroups((prev) =>
        prev.map((group) =>
          group.id === removeGroupDialog.id
            ? { ...group, memberCount: Math.max(0, group.memberCount - 1) }
            : group
        )
      );
    } catch (err) {
      setGroupActionError(
        err instanceof Error ? err.message : 'Failed to remove user from group'
      );
    } finally {
      setGroupActionId(null);
    }
  }, [removeGroupDialog, user]);

  const hasChanges =
    user && draft
      ? Object.keys(buildUpdatePayload(user, draft)).length > 0
      : false;
  const emailIsValid = draft ? draft.email.trim().length > 0 : false;

  if (loading) {
    return (
      <div className="flex h-full flex-col space-y-4">
        <div className="flex items-center gap-2">
          {backLink ?? (
            <BackLink defaultTo="/admin/users" defaultLabel="Back to Users" />
          )}
        </div>
        <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading user...
        </div>
      </div>
    );
  }

  if (error || !user || !draft) {
    return (
      <div className="flex h-full flex-col space-y-4">
        <div className="flex items-center gap-2">
          {backLink ?? (
            <BackLink defaultTo="/admin/users" defaultLabel="Back to Users" />
          )}
        </div>
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          {error ?? 'User not found'}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex items-center gap-2">
        {backLink ?? (
          <BackLink defaultTo="/admin/users" defaultLabel="Back to Users" />
        )}
      </div>
      <div>
        <h1 className="font-bold text-lg">Edit User</h1>
        <div className="flex items-center gap-2">
          <p className="font-mono text-muted-foreground text-sm">{user.id}</p>
          <Button
            variant="ghost"
            size="icon"
            onClick={copyUserId}
            aria-label="Copy user id to clipboard"
            data-testid="copy-user-id"
          >
            {isIdCopied ? (
              <Check className="h-4 w-4 text-success" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {saveError && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          {saveError}
        </div>
      )}

      <div className="space-y-4 rounded-lg border p-4">
        <div className="space-y-2">
          <label
            htmlFor="user-email"
            className="font-medium text-muted-foreground text-sm"
          >
            Email
          </label>
          <Input
            id="user-email"
            value={draft.email}
            onChange={(event) =>
              setDraft({ ...draft, email: event.target.value })
            }
            className={cn(!emailIsValid && 'border-destructive')}
          />
          {!emailIsValid && (
            <p className="text-destructive text-xs">Email is required</p>
          )}
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-muted-foreground/40"
              checked={draft.emailConfirmed}
              onChange={(event) =>
                setDraft({ ...draft, emailConfirmed: event.target.checked })
              }
            />
            Email Confirmed
          </label>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-muted-foreground/40"
              checked={draft.admin}
              onChange={(event) =>
                setDraft({ ...draft, admin: event.target.checked })
              }
            />
            Admin
          </label>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="user-organizations"
            className="font-medium text-muted-foreground text-sm"
          >
            Organization IDs
          </label>
          <Input
            id="user-organizations"
            value={organizationIdsInput}
            onChange={(event) => setOrganizationIdsInput(event.target.value)}
            placeholder="org-1, org-2"
          />
          <p className="text-muted-foreground text-xs">
            Separate multiple organization IDs with commas.
          </p>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Button
            onClick={handleSave}
            disabled={!hasChanges || !emailIsValid || saving}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save
          </Button>
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={!hasChanges || saving}
          >
            Reset
          </Button>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border bg-card p-4">
        <h2 className="font-medium text-lg">AI Usage</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              Total Tokens
            </p>
            <p className="mt-1 font-semibold text-lg">
              {formatNumber(user.accounting.totalTokens)}
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              Prompt Tokens
            </p>
            <p className="mt-1 font-semibold text-lg">
              {formatNumber(user.accounting.totalPromptTokens)}
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              Completion Tokens
            </p>
            <p className="mt-1 font-semibold text-lg">
              {formatNumber(user.accounting.totalCompletionTokens)}
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              Requests
            </p>
            <p className="mt-1 font-semibold text-lg">
              {formatNumber(user.accounting.requestCount)}
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              Last Usage
            </p>
            <p className="mt-1 text-muted-foreground text-sm">
              {formatTimestamp(user.accounting.lastUsedAt)}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-lg">Groups</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchGroups()}
            disabled={groupsLoading}
          >
            {groupsLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Refresh
          </Button>
        </div>

        {groupActionError && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
            <p className="text-destructive text-sm">{groupActionError}</p>
          </div>
        )}

        {groupsError && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
            <p className="text-destructive text-sm">{groupsError}</p>
          </div>
        )}

        {groupsLoading ? (
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
              const isUpdating = groupActionId === group.id;
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
                        : void handleAddToGroup(group.id)
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
      </div>

      <ConfirmDialog
        open={removeGroupDialog !== null}
        onOpenChange={(open) => !open && setRemoveGroupDialog(null)}
        title="Remove From Group"
        description={`Remove ${user.email} from ${removeGroupDialog?.name}?`}
        confirmLabel="Remove"
        onConfirm={handleConfirmRemoveFromGroup}
        variant="destructive"
      />
    </div>
  );
}
