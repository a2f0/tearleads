import type { CreateExerciseInput } from '@tearleads/health';
import { Loader2 } from 'lucide-react';
import { useCallback } from 'react';
import { InlineUnlock } from '../../sqlite/InlineUnlock';
import { ExerciseForm } from './ExerciseForm';
import { ExerciseList } from './ExerciseList';
import { useExerciseData } from './useExerciseData';

interface ExerciseDetailProps {
  refreshToken?: number;
}

export function ExerciseDetail({ refreshToken = 0 }: ExerciseDetailProps) {
  const {
    parentExercises,
    hierarchy,
    loading,
    error,
    hasFetched,
    isUnlocked,
    addExercise
  } = useExerciseData({ refreshToken });

  const handleSubmit = useCallback(
    async (input: CreateExerciseInput) => {
      await addExercise(input);
    },
    [addExercise]
  );

  if (!isUnlocked) {
    return <InlineUnlock description="exercises" />;
  }

  if (loading && !hasFetched) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center">
        <p className="text-destructive text-sm">Failed to load exercise data</p>
        <p className="mt-1 text-muted-foreground text-xs">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <ExerciseForm parentExercises={parentExercises} onSubmit={handleSubmit} />
      <section className="min-h-0 flex-1 overflow-auto rounded-md border">
        <ExerciseList parentExercises={parentExercises} hierarchy={hierarchy} />
      </section>
    </div>
  );
}
