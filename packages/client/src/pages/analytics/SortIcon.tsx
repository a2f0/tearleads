import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { SortColumn } from '@/db/analytics';

export interface SortState {
  column: SortColumn | null;
  direction: 'asc' | 'desc' | null;
}

interface SortIconProps {
  column: SortColumn;
  sort: SortState;
}

export function SortIcon({ column, sort }: SortIconProps) {
  if (sort.column !== column) {
    return <ArrowUpDown className="h-3 w-3 opacity-50" />;
  }
  return sort.direction === 'asc' ? (
    <ArrowUp className="h-3 w-3" />
  ) : (
    <ArrowDown className="h-3 w-3" />
  );
}
