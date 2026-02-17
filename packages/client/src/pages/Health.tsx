import {
  createHealthTracker,
  HEALTH_DRILLDOWN_CARDS,
  Health as BaseHealth,
  HealthRuntimeProvider,
  type HealthDrilldownRoute
} from '@tearleads/health';
import { useCallback, type ComponentProps } from 'react';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';

export { HEALTH_DRILLDOWN_CARDS, type HealthDrilldownRoute };

type HealthProps = ComponentProps<typeof BaseHealth>;

export function Health(props: HealthProps) {
  const { isUnlocked } = useDatabaseContext();
  const createTracker = useCallback(() => createHealthTracker(getDatabase()), []);

  return (
    <HealthRuntimeProvider isUnlocked={isUnlocked} createTracker={createTracker}>
      <BaseHealth {...props} />
    </HealthRuntimeProvider>
  );
}
