import { Loader2 } from 'lucide-react';
import { useCallback } from 'react';
import type { CreateWorkoutEntryInput } from '../../../lib/healthTrackerTypes.js';
import { useHealthRuntime } from '../../../runtime';
import { useWorkoutData } from './useWorkoutData';
import { WorkoutForm } from './WorkoutForm';
import { WorkoutTable } from './WorkoutTable';

interface WorkoutDetailProps {
  refreshToken?: number;
}

export function WorkoutDetail({ refreshToken = 0 }: WorkoutDetailProps) {
  const {
    InlineUnlock,
    registerReadingInVfs,
    linkReadingToContact,
    availableContacts
  } = useHealthRuntime();
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
      const entry = await addEntry(input);
      await registerReadingInVfs(entry.id, entry.performedAt);
      if (input.contactId) {
        await linkReadingToContact(entry.id, input.contactId);
      }
    },
    [addEntry, registerReadingInVfs, linkReadingToContact]
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
      <WorkoutForm
        exercises={exercises}
        onSubmit={handleSubmit}
        availableContacts={availableContacts}
      />
      <section className="min-h-0 flex-1 overflow-hidden rounded-md border">
        <WorkoutTable entries={entries} />
      </section>
    </div>
  );
}
