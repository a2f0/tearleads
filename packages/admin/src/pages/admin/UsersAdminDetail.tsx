import { api } from '@tearleads/api-client';
import type { AdminUser, AdminUserUpdatePayload } from '@tearleads/shared';
import { Check, Copy, Loader2, Save } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTypedTranslation } from '@/i18n';
import { cn } from '@/lib/utils';
import { AdminUserAiUsage } from '../../components/users-admin/AdminUserAiUsage';
import { AdminUserGroups } from '../../components/users-admin/AdminUserGroups';

interface UsersAdminDetailProps {
  userId?: string | null;
  backLink?: ReactNode;
  onViewAiRequests?: ((userId: string) => void) | undefined;
}

export function UsersAdminDetail({
  userId: userIdProp,
  backLink,
  onViewAiRequests
}: UsersAdminDetailProps) {
  const { t } = useTypedTranslation('admin');
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const userId = userIdProp ?? params.id ?? null;

  const [user, setUser] = useState<AdminUser | null>(null);
  const [draft, setDraft] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [organizationIdsInput, setOrganizationIdsInput] = useState('');
  const [isIdCopied, setIsIdCopied] = useState(false);

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

  const hasChanges =
    user && draft
      ? Object.keys(buildUpdatePayload(user, draft)).length > 0
      : false;
  const emailIsValid = draft ? draft.email.trim().length > 0 : false;
  const handleViewAiRequests = useCallback(() => {
    if (!userId) return;
    if (onViewAiRequests) {
      onViewAiRequests(userId);
      return;
    }
    navigate(`/admin/users/ai-requests?userId=${encodeURIComponent(userId)}`);
  }, [navigate, onViewAiRequests, userId]);

  if (loading) {
    return (
      <div className="flex h-full flex-col space-y-4">
        <div className="flex items-center gap-2">
          {backLink ?? (
            <BackLink
              defaultTo="/admin/users"
              defaultLabel={t('backToUsers')}
            />
          )}
        </div>
        <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('loadingUser')}
        </div>
      </div>
    );
  }

  if (error || !user || !draft) {
    return (
      <div className="flex h-full flex-col space-y-4">
        <div className="flex items-center gap-2">
          {backLink ?? (
            <BackLink
              defaultTo="/admin/users"
              defaultLabel={t('backToUsers')}
            />
          )}
        </div>
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          {error ?? t('userNotFound')}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex items-center gap-2">
        {backLink ?? (
          <BackLink defaultTo="/admin/users" defaultLabel={t('backToUsers')} />
        )}
      </div>
      <div>
        <h1 className="font-bold text-lg">{t('editUser')}</h1>
        <div className="flex items-center gap-2">
          <p className="font-mono text-muted-foreground text-sm">{user.id}</p>
          <Button
            variant="ghost"
            size="icon"
            onClick={copyUserId}
            aria-label={t('copyUserIdToClipboard')}
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
            <p className="text-destructive text-xs">{t('emailIsRequired')}</p>
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

      <AdminUserAiUsage user={user} onViewAiRequests={handleViewAiRequests} />

      <AdminUserGroups user={user} />
    </div>
  );
}
