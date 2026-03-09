import type { SortDirection, StatsSortColumn } from './analyticsTypes';

export type TimeFilter = 'hour' | 'day' | 'week' | 'all';

export interface SummarySortState {
  column: StatsSortColumn | null;
  direction: SortDirection | null;
}
