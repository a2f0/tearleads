import { OrganizationScopeSelector } from '@admin/components/admin-scope';
import { useAdminScope } from '@admin/hooks/useAdminScope';
import { formatNumber, formatTimestamp } from '@admin/lib/utils';
import type { AdminUser } from '@tearleads/shared';
import { BackLink, RefreshButton } from '@tearleads/ui';
import {
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import { Check, Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTypedTranslation } from '@/i18n';
import { api } from '@/lib/api';

interface UsersAdminProps {
  showBackLink?: boolean;
  onUserSelect: (userId: string) => void;
  onViewAiRequests?: (() => void) | undefined;
}

export function UsersAdmin({
  showBackLink = true,
  onUserSelect,
  onViewAiRequests
}: UsersAdminProps) {
  const { t } = useTypedTranslation('admin');
  const {
    context,
    selectedOrganizationId,
    loading: scopeLoading,
    error: scopeError,
    setSelectedOrganizationId
  } = useAdminScope();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    if (!context) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await api.admin.users.list(
        selectedOrganizationId
          ? { organizationId: selectedOrganizationId }
          : undefined
      );
      setUsers(response.users);
    } catch (err) {
      console.error('Failed to fetch users:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [context, selectedOrganizationId]);

  useEffect(() => {
    if (!context) {
      return;
    }

    void fetchUsers();
  }, [context, fetchUsers]);

  const handleUserClick = useCallback(
    (userId: string) => {
      onUserSelect(userId);
    },
    [onUserSelect]
  );

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        {showBackLink && (
          <BackLink defaultTo="/" defaultLabel={t('backToHome')} />
        )}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-bold text-2xl tracking-tight">
                {t('usersAdmin')}
              </h1>
              <p className="text-muted-foreground text-sm">
                {t('manageUserAccessAndProfiles')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {onViewAiRequests ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onViewAiRequests}
                >
                  {t('aiRequests')}
                </Button>
              ) : null}
              <RefreshButton
                onClick={() => {
                  void fetchUsers();
                }}
                loading={loading || scopeLoading}
              />
            </div>
          </div>
          {context ? (
            <OrganizationScopeSelector
              organizations={context.organizations}
              selectedOrganizationId={selectedOrganizationId}
              onSelectOrganization={setSelectedOrganizationId}
              allowAllOrganizations={context.isRootAdmin}
            />
          ) : null}
        </div>
      </div>

      {(scopeError || error) && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          {scopeError ?? error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
        <table className={`${WINDOW_TABLE_TYPOGRAPHY.table} min-w-[1120px]`}>
          <thead className={WINDOW_TABLE_TYPOGRAPHY.header}>
            <tr>
              <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                {t('userId')}
              </th>
              <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                {t('email')}
              </th>
              <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                {t('created')}
              </th>
              <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                {t('lastActive')}
              </th>
              <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                {t('confirmed')}
              </th>
              <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                {t('admin')}
              </th>
              <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                {t('tokens')}
              </th>
              <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                {t('requests')}
              </th>
              <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                {t('lastUsage')}
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && users.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center">
                  <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('loadingUsers')}
                  </div>
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-10 text-center text-muted-foreground text-sm"
                >
                  {t('noUsersFound')}
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <WindowTableRow
                  key={user.id}
                  onClick={() => handleUserClick(user.id)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleUserClick(user.id);
                    }
                  }}
                >
                  <td
                    className={`${WINDOW_TABLE_TYPOGRAPHY.mutedCell} max-w-[140px]`}
                  >
                    <span className="block truncate font-mono">{user.id}</span>
                  </td>
                  <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                    <span className="block truncate">{user.email}</span>
                  </td>
                  <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                    {formatTimestamp(user.createdAt)}
                  </td>
                  <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                    {formatTimestamp(user.lastActiveAt)}
                  </td>
                  <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                    <div className="flex items-center gap-1">
                      {user.emailConfirmed ? (
                        <Check className="h-3 w-3 text-green-600" />
                      ) : (
                        <X className="h-3 w-3 text-muted-foreground/50" />
                      )}
                      {user.emailConfirmed ? t('yes') : t('no')}
                    </div>
                  </td>
                  <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                    <div className="flex items-center gap-1">
                      {user.admin ? (
                        <Check className="h-3 w-3 text-green-600" />
                      ) : (
                        <X className="h-3 w-3 text-muted-foreground/50" />
                      )}
                      {user.admin ? t('yes') : t('no')}
                    </div>
                  </td>
                  <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                    {formatNumber(user.accounting.totalTokens)}
                  </td>
                  <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                    {formatNumber(user.accounting.requestCount)}
                  </td>
                  <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                    {formatTimestamp(user.accounting.lastUsedAt)}
                  </td>
                </WindowTableRow>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
