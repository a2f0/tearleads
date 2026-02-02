import { Loader2 } from 'lucide-react';
import { lazy, Suspense } from 'react';
import type { AnalyticsEvent } from '@/db/analytics';

const DurationChart = lazy(() =>
  import('./DurationChart').then((m) => ({ default: m.DurationChart }))
);

interface LazyDurationChartProps {
  events: AnalyticsEvent[];
  selectedEventTypes: Set<string>;
  timeFilter: 'hour' | 'day' | 'week' | 'all';
}

function DurationChartFallback() {
  return (
    <div className="flex h-48 items-center justify-center rounded-lg border bg-muted/50 sm:h-56">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export function LazyDurationChart(props: LazyDurationChartProps) {
  return (
    <Suspense fallback={<DurationChartFallback />}>
      <DurationChart {...props} />
    </Suspense>
  );
}
