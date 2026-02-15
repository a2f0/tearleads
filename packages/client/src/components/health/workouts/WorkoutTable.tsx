import type { WorkoutEntry } from '@tearleads/health';
import {
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import { Activity, ChevronDown, ChevronUp } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { useExerciseTranslation } from '../exercises/useExerciseTranslation';

interface WorkoutTableProps {
  entries: WorkoutEntry[];
}

type SortColumn =
  | 'performedAt'
  | 'exerciseName'
  | 'reps'
  | 'weight'
  | 'weightUnit'
  | 'note';
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
  if (value === 0) {
    return 'BW';
  }
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

export function WorkoutTable({ entries }: WorkoutTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('performedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const { getExerciseName } = useExerciseTranslation();

  const handleSortChange = useCallback((column: SortColumn) => {
    setSortColumn((currentColumn) => {
      if (currentColumn === column) {
        setSortDirection((currentDirection) =>
          currentDirection === 'asc' ? 'desc' : 'asc'
        );
        return currentColumn;
      }

      setSortDirection(column === 'performedAt' ? 'desc' : 'asc');
      return column;
    });
  }, []);

  const sortedEntries = useMemo(() => {
    const items = [...entries];

    items.sort((left, right) => {
      const sortResult = (() => {
        switch (sortColumn) {
          case 'performedAt':
            return compareValues(left.performedAt, right.performedAt);
          case 'exerciseName':
            return left.exerciseName.localeCompare(right.exerciseName);
          case 'reps':
            return compareValues(left.reps, right.reps);
          case 'weight':
            return compareValues(left.weight, right.weight);
          case 'weightUnit':
            return compareValues(left.weightUnit, right.weightUnit);
          case 'note':
            return compareOptionalStrings(left.note, right.note);
          default:
            return 0;
        }
      })();

      if (sortResult === 0) {
        return compareValues(right.performedAt, left.performedAt);
      }

      return sortDirection === 'asc' ? sortResult : -sortResult;
    });

    return items;
  }, [entries, sortColumn, sortDirection]);

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

  if (entries.length === 0) {
    return (
      <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <Activity className="h-5 w-5" />
        <p>No workout entries yet</p>
        <p className="text-sm">Add your first workout above.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto" data-testid="workout-table">
      <table
        className={WINDOW_TABLE_TYPOGRAPHY.table}
        aria-label="Workout entries table"
      >
        <thead className={WINDOW_TABLE_TYPOGRAPHY.header}>
          <tr>
            <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
              <button
                type="button"
                className="flex items-center gap-1 text-left font-medium hover:text-foreground"
                onClick={() => handleSortChange('performedAt')}
              >
                Date
                {getSortIcon('performedAt')}
              </button>
            </th>
            <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
              <button
                type="button"
                className="flex items-center gap-1 text-left font-medium hover:text-foreground"
                onClick={() => handleSortChange('exerciseName')}
              >
                Exercise
                {getSortIcon('exerciseName')}
              </button>
            </th>
            <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
              <button
                type="button"
                className="flex items-center gap-1 text-left font-medium hover:text-foreground"
                onClick={() => handleSortChange('reps')}
              >
                Reps
                {getSortIcon('reps')}
              </button>
            </th>
            <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
              <button
                type="button"
                className="flex items-center gap-1 text-left font-medium hover:text-foreground"
                onClick={() => handleSortChange('weight')}
              >
                Weight
                {getSortIcon('weight')}
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
          {sortedEntries.map((entry) => (
            <WindowTableRow key={entry.id}>
              <td className={`${WINDOW_TABLE_TYPOGRAPHY.cell} font-medium`}>
                {formatDate(entry.performedAt)}
              </td>
              <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                {getExerciseName(entry.exerciseId, entry.exerciseName)}
              </td>
              <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>{entry.reps}</td>
              <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                {formatWeight(entry.weight, entry.weightUnit)}
              </td>
              <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                {entry.note ?? '—'}
              </td>
            </WindowTableRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}
