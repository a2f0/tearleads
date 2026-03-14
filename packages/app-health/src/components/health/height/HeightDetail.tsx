import { Loader2 } from 'lucide-react';
import { useCallback } from 'react';
import type { CreateHeightReadingInput } from '../../../lib/healthTrackerTypes.js';
import { useHealthRuntime } from '../../../runtime';
import { HeightForm } from './HeightForm';
import { HeightTable } from './HeightTable';
import { useHeightData } from './useHeightData';

interface HeightDetailProps {
  refreshToken?: number;
}

export function HeightDetail({ refreshToken = 0 }: HeightDetailProps) {
  const {
    InlineUnlock,
    registerReadingInVfs,
    linkReadingToContact,
    availableContacts
  } = useHealthRuntime();
  const { readings, loading, error, hasFetched, isUnlocked, addReading } =
    useHeightData({ refreshToken });

  const handleSubmit = useCallback(
    async (input: CreateHeightReadingInput) => {
      const reading = await addReading(input);
      await registerReadingInVfs(reading.id, reading.recordedAt);
      if (input.contactId) {
        await linkReadingToContact(reading.id, input.contactId);
      }
    },
    [addReading, registerReadingInVfs, linkReadingToContact]
  );

  if (!isUnlocked) {
    return <InlineUnlock description="height readings" />;
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
        <p className="text-destructive text-sm">Failed to load height data</p>
        <p className="mt-1 text-muted-foreground text-xs">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <HeightForm
        onSubmit={handleSubmit}
        availableContacts={availableContacts}
      />
      <section className="min-h-0 flex-1 overflow-hidden rounded-md border">
        <HeightTable readings={readings} />
      </section>
    </div>
  );
}
