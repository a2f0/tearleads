import type { PostgresAdminInfoResponse } from '@rapid/shared';
import { Loader2, PlugZap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { RefreshButton } from '@/components/ui/refresh-button';
import { api } from '@/lib/api';

const FALLBACK_VALUE = 'Unknown';

export function PostgresConnectionPanel() {
  const [info, setInfo] = useState<PostgresAdminInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInfo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.admin.postgres.getInfo();
      setInfo(response);
    } catch (err) {
      console.error('Failed to fetch Postgres connection info:', err);
      setError(err instanceof Error ? err.message : String(err));
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInfo();
  }, [fetchInfo]);

  const statusLabel = error ? 'Unavailable' : 'Connected';
  const statusColor = error ? 'bg-destructive' : 'bg-emerald-500';

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PlugZap className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-medium">Connection</h2>
        </div>
        <RefreshButton
          onClick={fetchInfo}
          loading={loading}
          variant="ghost"
          className="h-8 w-8"
        />
      </div>

      {loading && !info ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading connection info...
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-3 py-2 sm:flex-nowrap sm:justify-between">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${statusColor}`} />
              <span className="font-medium">{statusLabel}</span>
            </div>
            <span className="text-muted-foreground sm:ml-auto">
              {info?.serverVersion ?? FALLBACK_VALUE}
            </span>
          </div>

          {error && (
            <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-destructive">
              {error}
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border px-3 py-2">
              <div className="text-muted-foreground text-xs uppercase">
                Host
              </div>
              <div className="font-mono">
                {info?.info.host ?? FALLBACK_VALUE}
              </div>
            </div>
            <div className="rounded-md border px-3 py-2">
              <div className="text-muted-foreground text-xs uppercase">
                Port
              </div>
              <div className="font-mono">
                {info?.info.port ?? FALLBACK_VALUE}
              </div>
            </div>
            <div className="rounded-md border px-3 py-2">
              <div className="text-muted-foreground text-xs uppercase">
                Database
              </div>
              <div className="font-mono">
                {info?.info.database ?? FALLBACK_VALUE}
              </div>
            </div>
            <div className="rounded-md border px-3 py-2">
              <div className="text-muted-foreground text-xs uppercase">
                User
              </div>
              <div className="font-mono">
                {info?.info.user ?? FALLBACK_VALUE}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
