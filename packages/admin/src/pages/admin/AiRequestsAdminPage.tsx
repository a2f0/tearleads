import type { AiUsage } from '@tearleads/shared';
import { BackLink, RefreshButton } from '@tearleads/ui';
import { formatNumber, formatTimestamp } from '@admin/lib/utils';
import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTypedTranslation } from '@/i18n';
import { api } from '@/lib/api';

const PAGE_SIZE = 100;

interface AiUsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
}

interface AiRequestsAdminPageProps {
  showBackLink?: boolean;
  backLink?: ReactNode;
  initialUserId?: string | null;
}

function calculateTotals(usageRows: AiUsage[]): AiUsageTotals {
  return usageRows.reduce<AiUsageTotals>(
    (totals, row) => ({
      promptTokens: totals.promptTokens + row.promptTokens,
      completionTokens: totals.completionTokens + row.completionTokens,
      totalTokens: totals.totalTokens + row.totalTokens,
      requestCount: totals.requestCount + 1
    }),
    {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      requestCount: 0
    }
  );
}

// component-complexity: allow - legacy admin page pending split into smaller views.
export function AiRequestsAdminPage({
  showBackLink = true,
  backLink,
  initialUserId
}: AiRequestsAdminPageProps) {
  const { t } = useTypedTranslation('admin');
  const [searchParams] = useSearchParams();
  const queryUserId = searchParams.get('userId')?.trim() ?? '';
  const initialFilterUserId = (initialUserId?.trim() || queryUserId).trim();
  const [usageRows, setUsageRows] = useState<AiUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userIdFilter, setUserIdFilter] = useState(initialFilterUserId);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<string | undefined>(undefined);

  const fetchUsage = useCallback(async (isLoadMore = false) => {
    if (isLoadMore) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      cursorRef.current = undefined;
    }
    setError(null);

    try {
      const response = await api.ai.getUsage({
        ...(cursorRef.current ? { cursor: cursorRef.current } : {}),
        limit: PAGE_SIZE
      });

      if (isLoadMore) {
        setUsageRows((prev) => [...prev, ...response.usage]);
      } else {
        setUsageRows(response.usage);
      }
      setHasMore(response.hasMore);
      cursorRef.current = response.cursor;
    } catch (err) {
      console.error('Failed to fetch AI request usage:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (isLoadMore) {
        setLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  const handleLoadMore = useCallback(() => {
    void fetchUsage(true);
  }, [fetchUsage]);

  const handleRefresh = useCallback(() => {
    void fetchUsage(false);
  }, [fetchUsage]);

  useEffect(() => {
    void fetchUsage(false);
  }, [fetchUsage]);

  const filteredUsageRows = useMemo(() => {
    const filter = userIdFilter.trim();
    if (!filter) {
      return usageRows;
    }
    return usageRows.filter((row) => row.userId.includes(filter));
  }, [usageRows, userIdFilter]);

  const totals = useMemo(
    () => calculateTotals(filteredUsageRows),
    [filteredUsageRows]
  );
  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        {backLink ? (
          backLink
        ) : showBackLink ? (
          <BackLink
            defaultTo="/admin/users"
            defaultLabel={t('backToUsersAdmin')}
          />
        ) : null}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-bold text-2xl tracking-tight">
              {t('aiRequestsAdmin')}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t('requestIdsAndTokenUsage')}
            </p>
          </div>
          <RefreshButton onClick={handleRefresh} loading={loading} />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      <div className="rounded-lg border bg-muted/20 p-4">
        <div className="mb-3 grid gap-2 md:grid-cols-[minmax(280px,420px)_auto] md:items-end md:justify-between">
          <div className="space-y-1">
            <label
              htmlFor="ai-usage-user-filter"
              className="font-medium text-muted-foreground text-xs uppercase tracking-wide"
            >
              {t('filterByUserId')}
            </label>
            <Input
              id="ai-usage-user-filter"
              value={userIdFilter}
              onChange={(event) => setUserIdFilter(event.target.value)}
              placeholder={t('enterUserId')}
              className="text-base"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div>
            <p className="text-muted-foreground text-xs uppercase">
              {t('requests')}
            </p>
            <p className="font-medium">{formatNumber(totals.requestCount)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs uppercase">
              {t('prompt')}
            </p>
            <p className="font-medium">{formatNumber(totals.promptTokens)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs uppercase">
              {t('completion')}
            </p>
            <p className="font-medium">
              {formatNumber(totals.completionTokens)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs uppercase">
              {t('total')}
            </p>
            <p className="font-medium">{formatNumber(totals.totalTokens)}</p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
        <div className="min-w-[1240px]">
          <div className="grid grid-cols-[minmax(180px,1.2fr)_minmax(220px,1.4fr)_minmax(160px,1fr)_minmax(180px,1fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)_minmax(180px,1fr)] items-center gap-3 border-b bg-muted/40 px-4 py-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
            <span>{t('usageId')}</span>
            <span>{t('openRouterRequestId')}</span>
            <span>{t('userId')}</span>
            <span>{t('model')}</span>
            <span>{t('prompt')}</span>
            <span>{t('completion')}</span>
            <span>{t('total')}</span>
            <span>{t('created')}</span>
          </div>

          {loading && filteredUsageRows.length === 0 ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('loadingAiRequestUsage')}
            </div>
          ) : filteredUsageRows.length === 0 ? (
            <div className="px-4 py-10 text-center text-muted-foreground text-sm">
              {t('noAiUsageRequestsFound')}
            </div>
          ) : (
            <>
              {filteredUsageRows.map((row) => (
                <div
                  key={row.id}
                  className="grid grid-cols-[minmax(180px,1.2fr)_minmax(220px,1.4fr)_minmax(160px,1fr)_minmax(180px,1fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)_minmax(180px,1fr)] items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0"
                >
                  <div className="truncate font-mono text-xs">{row.id}</div>
                  <div className="truncate font-mono text-muted-foreground text-xs">
                    {row.openrouterRequestId ?? 'N/A'}
                  </div>
                  <div className="truncate font-mono text-muted-foreground text-xs">
                    {row.userId}
                  </div>
                  <div className="truncate text-muted-foreground text-xs">
                    {row.modelId}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {formatNumber(row.promptTokens)}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {formatNumber(row.completionTokens)}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {formatNumber(row.totalTokens)}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {formatTimestamp(row.createdAt)}
                  </div>
                </div>
              ))}
              {hasMore && !userIdFilter.trim() && (
                <div className="flex justify-center border-t px-4 py-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t('loading')}
                      </>
                    ) : (
                      t('loadMore')
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
