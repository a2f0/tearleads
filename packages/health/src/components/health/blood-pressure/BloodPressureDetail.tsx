import type { CreateBloodPressureReadingInput } from '@tearleads/health';
import { Loader2 } from 'lucide-react';
import { useCallback } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { BloodPressureForm } from './BloodPressureForm';
import { BloodPressureTable } from './BloodPressureTable';
import { useBloodPressureData } from './useBloodPressureData';

interface BloodPressureDetailProps {
  refreshToken?: number;
}

export function BloodPressureDetail({
  refreshToken = 0
}: BloodPressureDetailProps) {
  const { readings, loading, error, hasFetched, isUnlocked, addReading } =
    useBloodPressureData({ refreshToken });

  const handleSubmit = useCallback(
    async (input: CreateBloodPressureReadingInput) => {
      await addReading(input);
    },
    [addReading]
  );

  if (!isUnlocked) {
    return <InlineUnlock description="blood pressure readings" />;
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
        <p className="text-destructive text-sm">
          Failed to load blood pressure data
        </p>
        <p className="mt-1 text-muted-foreground text-xs">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <BloodPressureForm onSubmit={handleSubmit} />
      <section className="min-h-0 flex-1 overflow-hidden rounded-md border">
        <BloodPressureTable readings={readings} />
      </section>
    </div>
  );
}
