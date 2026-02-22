import {
  Health as BaseHealth,
  createHealthTracker,
  type HealthDrilldownRoute,
  HealthRuntimeProvider
} from '@tearleads/health';
import { type ComponentProps, useCallback } from 'react';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';

export type { HealthDrilldownRoute };

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
    >
      <BaseHealth {...props} />
    </HealthRuntimeProvider>
  );
}
