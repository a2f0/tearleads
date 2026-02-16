import type { BloodPressureReading } from '@tearleads/health';
import {
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import { ChevronDown, ChevronUp, HeartPulse } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

interface BloodPressureTableProps {
  readings: BloodPressureReading[];
}

type SortColumn = 'recordedAt' | 'systolic' | 'diastolic' | 'pulse' | 'note';
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

function formatBloodPressure(systolic: number, diastolic: number): string {
  return `${systolic}/${diastolic}`;
}

function compareValues<T>(left: T, right: T): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareOptionalValues<T>(left?: T, right?: T): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return compareValues(left, right);
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

export function BloodPressureTable({ readings }: BloodPressureTableProps) {
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
    const items = [...readings];

    items.sort((left, right) => {
      const sortResult = (() => {
        switch (sortColumn) {
          case 'recordedAt':
            return compareValues(left.recordedAt, right.recordedAt);
          case 'systolic':
            return compareValues(left.systolic, right.systolic);
          case 'diastolic':
            return compareValues(left.diastolic, right.diastolic);
          case 'pulse':
            return compareOptionalValues(left.pulse, right.pulse);
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

    return items;
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
        <HeartPulse className="h-5 w-5" />
        <p>No blood pressure readings yet</p>
        <p className="text-sm">Add your first reading above.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto" data-testid="blood-pressure-table">
      <table
        className={WINDOW_TABLE_TYPOGRAPHY.table}
        aria-label="Blood pressure readings table"
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
                onClick={() => handleSortChange('systolic')}
              >
                BP
                {getSortIcon('systolic')}
              </button>
            </th>
            <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
              <button
                type="button"
                className="flex items-center gap-1 text-left font-medium hover:text-foreground"
                onClick={() => handleSortChange('pulse')}
              >
                Pulse
                {getSortIcon('pulse')}
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
                {formatBloodPressure(reading.systolic, reading.diastolic)}
              </td>
              <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                {reading.pulse ?? '—'}
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
