import {
  Health as BaseHealth,
  createHealthTracker,
  HealthRuntimeProvider
} from '@tearleads/app-health/clientEntry';
import { type ComponentProps, useCallback } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';

type HealthProps = ComponentProps<typeof BaseHealth>;

export function Health(props: HealthProps) {
  const { isUnlocked } = useDatabaseContext();
  const createTracker = useCallback(
    () => createHealthTracker(getDatabase()),
    []
  );

  return (
    <HealthRuntimeProvider
      isUnlocked={isUnlocked}
      createTracker={createTracker}
      InlineUnlock={InlineUnlock}
    >
      <BaseHealth {...props} />
    </HealthRuntimeProvider>
  );
}
