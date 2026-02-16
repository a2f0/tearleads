import type {
  BloodPressureReading,
  CreateBloodPressureReadingInput
} from '@tearleads/health';
import { useCallback, useEffect, useState } from 'react';
import { useDatabaseContext } from '@/db/hooks';
import { useHealthTracker } from '../useHealthTracker';

interface UseBloodPressureDataProps {
  refreshToken?: number;
}

interface UseBloodPressureDataResult {
  readings: BloodPressureReading[];
  loading: boolean;
  error: string | null;
  hasFetched: boolean;
  isUnlocked: boolean;
  addReading: (
    input: CreateBloodPressureReadingInput
  ) => Promise<BloodPressureReading>;
  refresh: () => Promise<void>;
}

export function useBloodPressureData({
  refreshToken = 0
}: UseBloodPressureDataProps = {}): UseBloodPressureDataResult {
  const { isUnlocked } = useDatabaseContext();
  const tracker = useHealthTracker();

  const [readings, setReadings] = useState<BloodPressureReading[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);

  const fetchReadings = useCallback(async () => {
    if (!tracker) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await tracker.listBloodPressureReadings();
      setReadings(data);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch blood pressure readings:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [tracker]);

  useEffect(() => {
    if (!isUnlocked || !tracker) {
      return;
    }

    void refreshToken;
    fetchReadings();
  }, [fetchReadings, isUnlocked, tracker, refreshToken]);

  const addReading = useCallback(
    async (
      input: CreateBloodPressureReadingInput
    ): Promise<BloodPressureReading> => {
      if (!tracker) {
        throw new Error('Database is locked');
      }

      const reading = await tracker.addBloodPressureReading(input);
      await fetchReadings();
      return reading;
    },
    [tracker, fetchReadings]
  );

  return {
    readings,
    loading,
    error,
    hasFetched,
    isUnlocked,
    addReading,
    refresh: fetchReadings
  };
}
