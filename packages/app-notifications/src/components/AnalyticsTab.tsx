import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type AnalyticsEvent,
  type EventStats,
  getAnalyticsDependencies
} from '../lib/analyticsDependencies';

const ONE_HOUR_MS = 60 * 60 * 1000;

export function AnalyticsTab() {
  const { t } = useTranslation('common');
  const dependencies = getAnalyticsDependencies();
  const { isUnlocked } = dependencies?.useDatabaseContext() ?? {
    isUnlocked: false
  };
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [stats, setStats] = useState<EventStats[]>([]);
  const [selectedEventTypes, setSelectedEventTypes] = useState<Set<string>>(
    new Set()
  );
  const [loading, setLoading] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const fetchingRef = useRef(false);

  const handleRefresh = () => {
    if (!loading) {
      setRefreshTrigger((prev) => prev + 1);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshTrigger intentionally triggers re-fetch
  useEffect(() => {
    if (!dependencies || !isUnlocked) return;

    let isCancelled = false;

    const fetchData = async () => {
      if (fetchingRef.current) return;

      fetchingRef.current = true;
      setLoading(true);

      try {
        const db = dependencies.getDatabase();
        const startTime = new Date(Date.now() - ONE_HOUR_MS);

        const [eventsData, statsData, typesData] = await Promise.all([
          dependencies.getEvents(db, { startTime, limit: 50 }),
          dependencies.getEventStats(db, { startTime }),
          dependencies.getDistinctEventTypes(db)
        ]);

        if (!isCancelled) {
          setEvents(eventsData);
          setStats(statsData);
          setSelectedEventTypes(new Set(typesData));
        }
      } catch (err) {
        if (!isCancelled) {
          dependencies.logError(
            'Failed to fetch HUD analytics',
            err instanceof Error ? (err.stack ?? err.message) : String(err)
          );
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    return () => {
      isCancelled = true;
      fetchingRef.current = false;
    };
  }, [dependencies, isUnlocked, refreshTrigger]);

  if (!dependencies) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
        Analytics unavailable
      </div>
    );
  }

  if (!isUnlocked) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
        {t('databaseLocked')}
      </div>
    );
  }

  if (loading && events.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
        {t('loading')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-medium text-muted-foreground text-xs">
          {t('lastHour')}
        </span>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={loading}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          aria-label={t('refresh')}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {stats.length > 0 && (
        <div className="space-y-1">
          {stats.slice(0, 5).map((stat) => (
            <div
              key={stat.eventName}
              className="flex items-center justify-between text-xs"
            >
              <span className="truncate font-medium">
                {dependencies.getEventDisplayName(stat.eventName)}
              </span>
              <span className="text-muted-foreground">
                {stat.count}x /{' '}
                {dependencies.formatDuration(stat.avgDurationMs)} avg
              </span>
            </div>
          ))}
          {stats.length > 5 && (
            <div className="text-muted-foreground text-xs">
              {t('moreEventTypes', { count: stats.length - 5 })}
            </div>
          )}
        </div>
      )}

      {events.length > 0 ? (
        <div className="h-32">
          <dependencies.DurationChart
            events={events}
            selectedEventTypes={selectedEventTypes}
            timeFilter="hour"
          />
        </div>
      ) : (
        <div className="flex h-32 items-center justify-center rounded border text-muted-foreground text-xs [border-color:var(--soft-border)]">
          {t('noEventsInLastHour')}
        </div>
      )}
    </div>
  );
}
