import {
  HealthWindow as BaseHealthWindow,
  createHealthTracker,
  HealthRuntimeProvider
} from '@tearleads/app-health/clientEntry';
import { type ComponentProps, useCallback } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';

type HealthWindowProps = ComponentProps<typeof BaseHealthWindow>;

export function HealthWindow(props: HealthWindowProps) {
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
      <BaseHealthWindow {...props} />
    </HealthRuntimeProvider>
  );
}
