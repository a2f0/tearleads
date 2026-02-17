import { useMemo } from 'react';
import type { HealthTracker } from '../../lib/healthTracker';
import { useHealthRuntime } from '../../runtime';

/**
 * Factory hook for HealthTracker instance.
 * Caches tracker instance and returns null when database is locked.
 */
export function useHealthTracker(): HealthTracker | null {
  const { createTracker, isUnlocked } = useHealthRuntime();

  const tracker = useMemo(() => {
    if (!isUnlocked) {
      return null;
    }

    return createTracker();
  }, [createTracker, isUnlocked]);

  return tracker;
}
