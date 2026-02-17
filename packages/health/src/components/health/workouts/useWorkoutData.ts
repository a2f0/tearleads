import { useCallback, useEffect, useState } from 'react';
import type {
  CreateWorkoutEntryInput,
  Exercise,
  WorkoutEntry
} from '../../../lib/healthTracker';
import { useHealthRuntime } from '../../../runtime';
import { useHealthTracker } from '../useHealthTracker';

interface UseWorkoutDataProps {
  refreshToken?: number;
}

interface UseWorkoutDataResult {
  entries: WorkoutEntry[];
  exercises: Exercise[];
  loading: boolean;
  error: string | null;
  hasFetched: boolean;
  isUnlocked: boolean;
  addEntry: (input: CreateWorkoutEntryInput) => Promise<WorkoutEntry>;
  refresh: () => Promise<void>;
}

export function useWorkoutData({
  refreshToken = 0
}: UseWorkoutDataProps = {}): UseWorkoutDataResult {
  const { isUnlocked } = useHealthRuntime();
  const tracker = useHealthTracker();

  const [entries, setEntries] = useState<WorkoutEntry[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);

  const fetchData = useCallback(async () => {
    if (!tracker) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [entriesData, exercisesData] = await Promise.all([
        tracker.listWorkoutEntries(),
        tracker.listExercises()
      ]);
      setEntries(entriesData);
      setExercises(exercisesData);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch workout data:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [tracker]);

  useEffect(() => {
    if (!isUnlocked || !tracker) {
      return;
    }

    void refreshToken;
    fetchData();
  }, [fetchData, isUnlocked, tracker, refreshToken]);

  const addEntry = useCallback(
    async (input: CreateWorkoutEntryInput): Promise<WorkoutEntry> => {
      if (!tracker) {
        throw new Error('Database is locked');
      }

      const entry = await tracker.addWorkoutEntry(input);
      await fetchData();
      return entry;
    },
    [tracker, fetchData]
  );

  return {
    entries,
    exercises,
    loading,
    error,
    hasFetched,
    isUnlocked,
    addEntry,
    refresh: fetchData
  };
}
