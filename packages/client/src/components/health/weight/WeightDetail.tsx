import type { CreateWeightReadingInput } from '@tearleads/health';
import { Loader2 } from 'lucide-react';
import { useCallback } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { useWeightData } from './useWeightData';
import { WeightForm } from './WeightForm';
import { WeightTable } from './WeightTable';

interface WeightDetailProps {
  refreshToken?: number;
}

export function WeightDetail({ refreshToken = 0 }: WeightDetailProps) {
  const { readings, loading, error, hasFetched, isUnlocked, addReading } =
    useWeightData({ refreshToken });

  const handleSubmit = useCallback(
    async (input: CreateWeightReadingInput) => {
      await addReading(input);
    },
    [addReading]
  );

  if (!isUnlocked) {
    return <InlineUnlock description="weight readings" />;
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
        <p className="text-destructive text-sm">Failed to load weight data</p>
        <p className="mt-1 text-muted-foreground text-xs">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <WeightForm onSubmit={handleSubmit} />
      <section className="min-h-0 flex-1 overflow-hidden rounded-md border">
        <WeightTable readings={readings} />
      </section>
    </div>
  );
}
