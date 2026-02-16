import type { CreateWorkoutEntryInput } from '@tearleads/health';
import { Loader2 } from 'lucide-react';
import { useCallback } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { useWorkoutData } from './useWorkoutData';
import { WorkoutForm } from './WorkoutForm';
import { WorkoutTable } from './WorkoutTable';

interface WorkoutDetailProps {
  refreshToken?: number;
}

export function WorkoutDetail({ refreshToken = 0 }: WorkoutDetailProps) {
  const {
    entries,
    exercises,
    loading,
    error,
    hasFetched,
    isUnlocked,
    addEntry
  } = useWorkoutData({ refreshToken });

  const handleSubmit = useCallback(
    async (input: CreateWorkoutEntryInput) => {
      await addEntry(input);
    },
    [addEntry]
  );

  if (!isUnlocked) {
    return <InlineUnlock description="workout entries" />;
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
        <p className="text-destructive text-sm">Failed to load workout data</p>
        <p className="mt-1 text-muted-foreground text-xs">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <WorkoutForm exercises={exercises} onSubmit={handleSubmit} />
      <section className="min-h-0 flex-1 overflow-hidden rounded-md border">
        <WorkoutTable entries={entries} />
      </section>
    </div>
  );
}
