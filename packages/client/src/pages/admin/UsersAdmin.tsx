import type { AdminUser } from '@rapid/shared';
import { Check, Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { RefreshButton } from '@/components/ui/refresh-button';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface UsersAdminProps {
  showBackLink?: boolean;
  onUserSelect: (userId: string) => void;
}

export function UsersAdmin({
  showBackLink = true,
  onUserSelect
}: UsersAdminProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.admin.users.list();
      setUsers(response.users);
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

  const handleUserClick = useCallback(
    (userId: string) => {
      onUserSelect(userId);
    },
    [onUserSelect]
  );

  const formatTimestamp = useCallback((timestamp: string | null) => {
    if (!timestamp) return '—';
    return formatDate(new Date(timestamp));
  }, []);

  const formatNumber = useCallback((value: number) => {
    return new Intl.NumberFormat().format(value);
  }, []);

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
        <div className="min-w-[1120px]">
          <div className="grid grid-cols-[minmax(140px,1fr)_minmax(200px,2fr)_minmax(160px,1fr)_minmax(160px,1fr)_minmax(120px,0.7fr)_minmax(100px,0.5fr)_minmax(140px,0.9fr)_minmax(110px,0.6fr)_minmax(160px,1fr)] items-center gap-3 border-b bg-muted/40 px-4 py-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
            <span>User ID</span>
            <span>Email</span>
            <span>Account Created</span>
            <span>Last Active</span>
            <span>Email Confirmed</span>
            <span>Admin</span>
            <span>Total Tokens</span>
            <span>Requests</span>
            <span>Last Usage</span>
          </div>

          {loading && users.length === 0 ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading users...
            </div>
          ) : users.length === 0 ? (
            <div className="px-4 py-10 text-center text-muted-foreground text-sm">
              No users found.
            </div>
          ) : (
            users.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => handleUserClick(user.id)}
                className="grid w-full grid-cols-[minmax(140px,1fr)_minmax(200px,2fr)_minmax(160px,1fr)_minmax(160px,1fr)_minmax(120px,0.7fr)_minmax(100px,0.5fr)_minmax(140px,0.9fr)_minmax(110px,0.6fr)_minmax(160px,1fr)] items-center gap-3 border-b px-4 py-3 text-left text-sm transition-colors last:border-b-0 hover:bg-muted/50"
              >
                <div className="truncate font-mono text-muted-foreground text-xs">
                  {user.id}
                </div>
                <div className="truncate">{user.email}</div>
                <div className="text-muted-foreground text-xs">
                  {formatTimestamp(user.createdAt)}
                </div>
                <div className="text-muted-foreground text-xs">
                  {formatTimestamp(user.lastActiveAt)}
                </div>
                <div className="flex items-center gap-1 text-muted-foreground text-xs">
                  {user.emailConfirmed ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <X className="h-4 w-4 text-muted-foreground/50" />
                  )}
                  {user.emailConfirmed ? 'Yes' : 'No'}
                </div>
                <div className="flex items-center gap-1 text-muted-foreground text-xs">
                  {user.admin ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <X className="h-4 w-4 text-muted-foreground/50" />
                  )}
                  {user.admin ? 'Yes' : 'No'}
                </div>
                <div className="text-muted-foreground text-xs">
                  {formatNumber(user.accounting.totalTokens)}
                </div>
                <div className="text-muted-foreground text-xs">
                  {formatNumber(user.accounting.requestCount)}
                </div>
                <div className="text-muted-foreground text-xs">
                  {formatTimestamp(user.accounting.lastUsedAt)}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
