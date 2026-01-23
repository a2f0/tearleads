import type { AdminUser, AdminUserUpdatePayload } from '@rapid/shared';
import { Loader2, Save, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RefreshButton } from '@/components/ui/refresh-button';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface UsersAdminProps {
  showBackLink?: boolean;
}

type EditedUsers = Record<string, AdminUser>;

export function UsersAdmin({ showBackLink = true }: UsersAdminProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [editedUsers, setEditedUsers] = useState<EditedUsers>({});
  const [loading, setLoading] = useState(true);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.admin.users.list();
      setUsers(response.users);
      setEditedUsers({});
      setRowErrors({});
    } catch (err) {
      console.error('Failed to fetch users:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const getDraftUser = useCallback(
    (user: AdminUser) => editedUsers[user.id] ?? user,
    [editedUsers]
  );

  const updateDraftUser = useCallback(
    (user: AdminUser, updates: Partial<AdminUser>) => {
      setEditedUsers((prev) => ({
        ...prev,
        [user.id]: { ...getDraftUser(user), ...updates }
      }));
    },
    [getDraftUser]
  );

  const discardDraft = useCallback((userId: string) => {
    setEditedUsers((prev) => {
      if (!prev[userId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[userId];
      return next;
    });
    setRowErrors((prev) => {
      if (!prev[userId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  }, []);

  const pendingById = useMemo(() => {
    const pending = new Set<string>();
    for (const id of savingIds) {
      pending.add(id);
    }
    return pending;
  }, [savingIds]);

  const buildUpdatePayload = useCallback(
    (current: AdminUser, draft: AdminUser) => {
      const payload: AdminUserUpdatePayload = {};
      if (draft.email.trim().toLowerCase() !== current.email) {
        payload.email = draft.email.trim().toLowerCase();
      }
      if (draft.emailConfirmed !== current.emailConfirmed) {
        payload.emailConfirmed = draft.emailConfirmed;
      }
      if (draft.admin !== current.admin) {
        payload.admin = draft.admin;
      }
      return payload;
    },
    []
  );

  const handleSave = useCallback(
    async (user: AdminUser) => {
      const draft = getDraftUser(user);
      const payload = buildUpdatePayload(user, draft);
      if (Object.keys(payload).length === 0) {
        discardDraft(user.id);
        return;
      }

      setRowErrors((prev) => ({ ...prev, [user.id]: '' }));
      setSavingIds((prev) => new Set(prev).add(user.id));
      try {
        const response = await api.admin.users.update(user.id, payload);
        setUsers((prev) =>
          prev.map((existing) =>
            existing.id === user.id ? response.user : existing
          )
        );
        discardDraft(user.id);
      } catch (err) {
        console.error('Failed to update user:', err);
        setRowErrors((prev) => ({
          ...prev,
          [user.id]: err instanceof Error ? err.message : String(err)
        }));
      } finally {
        setSavingIds((prev) => {
          const next = new Set(prev);
          next.delete(user.id);
          return next;
        });
      }
    },
    [buildUpdatePayload, discardDraft, getDraftUser]
  );

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        {showBackLink && <BackLink defaultTo="/" defaultLabel="Back to Home" />}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-bold text-2xl tracking-tight">Users Admin</h1>
            <p className="text-muted-foreground text-sm">
              Manage user access and profiles
            </p>
          </div>
          <RefreshButton onClick={fetchUsers} loading={loading} />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[minmax(140px,1fr)_minmax(200px,2fr)_minmax(120px,0.6fr)_minmax(120px,0.6fr)_minmax(200px,0.8fr)] items-center gap-3 border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span>User ID</span>
            <span>Email</span>
            <span>Email Confirmed</span>
            <span>Admin</span>
            <span className="text-right">Actions</span>
          </div>

          {loading && users.length === 0 ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading users...
            </div>
          ) : users.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              No users found.
            </div>
          ) : (
            users.map((user) => {
              const draft = getDraftUser(user);
              const payload = buildUpdatePayload(user, draft);
              const hasChanges = Object.keys(payload).length > 0;
              const emailIsValid = draft.email.trim().length > 0;
              const isSaving = pendingById.has(user.id);
              return (
                <div
                  key={user.id}
                  className="grid grid-cols-[minmax(140px,1fr)_minmax(200px,2fr)_minmax(120px,0.6fr)_minmax(120px,0.6fr)_minmax(200px,0.8fr)] items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0"
                >
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {user.id}
                  </div>
                  <Input
                    value={draft.email}
                    onChange={(event) =>
                      updateDraftUser(user, { email: event.target.value })
                    }
                    className={cn(
                      'h-8',
                      !emailIsValid && 'border-destructive'
                    )}
                  />
                  <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-muted-foreground/40"
                      checked={draft.emailConfirmed}
                      onChange={(event) =>
                        updateDraftUser(user, {
                          emailConfirmed: event.target.checked
                        })
                      }
                    />
                    {draft.emailConfirmed ? 'Yes' : 'No'}
                  </label>
                  <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-muted-foreground/40"
                      checked={draft.admin}
                      onChange={(event) =>
                        updateDraftUser(user, { admin: event.target.checked })
                      }
                    />
                    {draft.admin ? 'Yes' : 'No'}
                  </label>
                  <div className="flex items-center justify-end gap-2">
                    {rowErrors[user.id] && (
                      <span className="text-xs text-destructive">
                        {rowErrors[user.id]}
                      </span>
                    )}
                    <Button
                      size="sm"
                      onClick={() => handleSave(user)}
                      disabled={!hasChanges || !emailIsValid || isSaving}
                    >
                      {isSaving ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Save className="h-3 w-3" />
                      )}
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => discardDraft(user.id)}
                      disabled={!hasChanges || isSaving}
                    >
                      <X className="h-3 w-3" />
                      Reset
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
