import type { SortDirection, StatsSortColumn } from '@/db/analytics';

export type TimeFilter = 'hour' | 'day' | 'week' | 'all';

export interface SummarySortState {
  column: StatsSortColumn | null;
  direction: SortDirection | null;
}
