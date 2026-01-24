import type { AdminUser, AdminUserUpdatePayload } from '@rapid/shared';
import { Loader2, Save } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

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

  const fetchUser = useCallback(async () => {
    if (!userId) {
      setError('No user ID provided');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await api.admin.users.list();
      const foundUser = response.users.find((u) => u.id === userId);
      if (!foundUser) {
        setError('User not found');
        setUser(null);
        setDraft(null);
      } else {
        setUser(foundUser);
        setDraft(foundUser);
      }
    } catch (err) {
      console.error('Failed to fetch user:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

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
      return payload;
    },
    []
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
    }
  }, [user]);

  const hasChanges =
    user && draft
      ? Object.keys(buildUpdatePayload(user, draft)).length > 0
      : false;
  const emailIsValid = draft ? draft.email.trim().length > 0 : false;

  if (loading) {
    return (
      <div className="flex h-full flex-col space-y-6">
        <div className="space-y-2">
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
      <div className="flex h-full flex-col space-y-6">
        <div className="space-y-2">
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
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        {backLink ?? (
          <BackLink defaultTo="/admin/users" defaultLabel="Back to Users" />
        )}
        <div>
          <h1 className="font-bold text-2xl tracking-tight">Edit User</h1>
          <p className="font-mono text-muted-foreground text-sm">{user.id}</p>
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
    </div>
  );
}
