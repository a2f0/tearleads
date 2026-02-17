import {
  createHealthTracker,
  HealthRuntimeProvider,
  HealthWindow as BaseHealthWindow
} from '@tearleads/health';
import { useCallback, type ComponentProps } from 'react';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';

type HealthWindowProps = ComponentProps<typeof BaseHealthWindow>;

export function HealthWindow(props: HealthWindowProps) {
  const { isUnlocked } = useDatabaseContext();
  const createTracker = useCallback(() => createHealthTracker(getDatabase()), []);

  return (
    <HealthRuntimeProvider isUnlocked={isUnlocked} createTracker={createTracker}>
      <BaseHealthWindow {...props} />
    </HealthRuntimeProvider>
  );
}
