import { useCallback, useEffect, useState } from 'react';
import type { CreateExerciseInput, Exercise } from '../../../lib/healthTracker';
import { useHealthRuntime } from '../../../runtime';
import { useHealthTracker } from '../useHealthTracker';

interface UseExerciseDataProps {
  refreshToken?: number;
}

interface UseExerciseDataResult {
  exercises: Exercise[];
  parentExercises: Exercise[];
  hierarchy: Map<string, Exercise[]>;
  loading: boolean;
  error: string | null;
  hasFetched: boolean;
  isUnlocked: boolean;
  addExercise: (input: CreateExerciseInput) => Promise<Exercise>;
  refresh: () => Promise<void>;
}

export function useExerciseData({
  refreshToken = 0
}: UseExerciseDataProps = {}): UseExerciseDataResult {
  const { isUnlocked } = useHealthRuntime();
  const tracker = useHealthTracker();

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [parentExercises, setParentExercises] = useState<Exercise[]>([]);
  const [hierarchy, setHierarchy] = useState<Map<string, Exercise[]>>(
    new Map()
  );
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
      // Single database call - derive parents and hierarchy client-side
      const allExercises = await tracker.listExercises();
      const parents = allExercises.filter((e) => !e.parentId);

      const exerciseHierarchy = new Map<string, Exercise[]>();
      for (const parent of parents) {
        exerciseHierarchy.set(parent.id, []);
      }
      for (const exercise of allExercises) {
        if (exercise.parentId) {
          const children = exerciseHierarchy.get(exercise.parentId);
          if (children) {
            children.push(exercise);
          }
        }
      }

      setExercises(allExercises);
      setParentExercises(parents);
      setHierarchy(exerciseHierarchy);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch exercise data:', err);
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

  const addExercise = useCallback(
    async (input: CreateExerciseInput): Promise<Exercise> => {
      if (!tracker) {
        throw new Error('Database is locked');
      }

      const exercise = await tracker.addExercise(input);
      await fetchData();
      return exercise;
    },
    [tracker, fetchData]
  );

  return {
    exercises,
    parentExercises,
    hierarchy,
    loading,
    error,
    hasFetched,
    isUnlocked,
    addExercise,
    refresh: fetchData
  };
}
