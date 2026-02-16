import type { HealthTracker } from '@tearleads/health';
import { createHealthTracker } from '@tearleads/health';
import { useMemo } from 'react';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';

/**
 * Factory hook for HealthTracker instance.
 * Caches tracker instance and returns null when database is locked.
 */
export function useHealthTracker(): HealthTracker | null {
  const { isUnlocked } = useDatabaseContext();

  const tracker = useMemo(() => {
    if (!isUnlocked) {
      return null;
    }

    const db = getDatabase();
    return createHealthTracker(db);
  }, [isUnlocked]);

  return tracker;
}
