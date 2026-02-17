import type { WeightReading } from '@tearleads/health';
import {
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import { ChevronDown, ChevronUp, Scale } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

interface WeightTableProps {
  readings: WeightReading[];
}

type SortColumn = 'recordedAt' | 'value' | 'unit' | 'note';
type SortDirection = 'asc' | 'desc';

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatWeight(value: number, unit: string): string {
  return `${value.toFixed(1)} ${unit}`;
}

function compareValues<T>(left: T, right: T): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareOptionalStrings(left?: string, right?: string): number {
  const leftValue = left ?? '';
  const rightValue = right ?? '';

  if (leftValue.length === 0 && rightValue.length === 0) return 0;
  if (leftValue.length === 0) return 1;
  if (rightValue.length === 0) return -1;

  return leftValue.localeCompare(rightValue, undefined, {
    numeric: true,
    sensitivity: 'base'
  });
}

export function WeightTable({ readings }: WeightTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('recordedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSortChange = useCallback((column: SortColumn) => {
    setSortColumn((currentColumn) => {
      if (currentColumn === column) {
        setSortDirection((currentDirection) =>
          currentDirection === 'asc' ? 'desc' : 'asc'
        );
        return currentColumn;
      }

      setSortDirection(column === 'recordedAt' ? 'desc' : 'asc');
      return column;
    });
  }, []);

  const sortedReadings = useMemo(() => {
    const entries = [...readings];

    entries.sort((left, right) => {
      const sortResult = (() => {
        switch (sortColumn) {
          case 'recordedAt':
            return compareValues(left.recordedAt, right.recordedAt);
          case 'value':
            return compareValues(left.value, right.value);
          case 'unit':
            return compareValues(left.unit, right.unit);
          case 'note':
            return compareOptionalStrings(left.note, right.note);
          default:
            return 0;
        }
      })();

      if (sortResult === 0) {
        return compareValues(right.recordedAt, left.recordedAt);
      }

      return sortDirection === 'asc' ? sortResult : -sortResult;
    });

    return entries;
  }, [readings, sortColumn, sortDirection]);

  const getSortIcon = useCallback(
    (column: SortColumn) => {
      if (sortColumn !== column) {
        return null;
      }

      return sortDirection === 'asc' ? (
        <ChevronUp className="h-3 w-3" />
      ) : (
        <ChevronDown className="h-3 w-3" />
      );
    },
    [sortColumn, sortDirection]
  );

  if (readings.length === 0) {
    return (
      <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <Scale className="h-5 w-5" />
        <p>No weight readings yet</p>
        <p className="text-sm">Add your first reading above.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto" data-testid="weight-table">
      <table
        className={WINDOW_TABLE_TYPOGRAPHY.table}
        aria-label="Weight readings table"
      >
        <thead className={WINDOW_TABLE_TYPOGRAPHY.header}>
          <tr>
            <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
              <button
                type="button"
                className="flex items-center gap-1 text-left font-medium hover:text-foreground"
                onClick={() => handleSortChange('recordedAt')}
              >
                Date
                {getSortIcon('recordedAt')}
              </button>
            </th>
            <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
              <button
                type="button"
                className="flex items-center gap-1 text-left font-medium hover:text-foreground"
                onClick={() => handleSortChange('value')}
              >
                Weight
                {getSortIcon('value')}
              </button>
            </th>
            <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
              <button
                type="button"
                className="flex items-center gap-1 text-left font-medium hover:text-foreground"
                onClick={() => handleSortChange('unit')}
              >
                Unit
                {getSortIcon('unit')}
              </button>
            </th>
            <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
              <button
                type="button"
                className="flex items-center gap-1 text-left font-medium hover:text-foreground"
                onClick={() => handleSortChange('note')}
              >
                Note
                {getSortIcon('note')}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedReadings.map((reading) => (
            <WindowTableRow key={reading.id}>
              <td className={`${WINDOW_TABLE_TYPOGRAPHY.cell} font-medium`}>
                {formatDate(reading.recordedAt)}
              </td>
              <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                {formatWeight(reading.value, reading.unit)}
              </td>
              <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                {reading.unit}
              </td>
              <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                {reading.note ?? '—'}
              </td>
            </WindowTableRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}
