import { useCallback, useEffect, useState } from 'react';
import type {
  CreateWeightReadingInput,
  WeightReading
} from '../../../lib/healthTracker';
import { useHealthRuntime } from '../../../runtime';
import { useHealthTracker } from '../useHealthTracker';

interface UseWeightDataProps {
  refreshToken?: number;
}

interface UseWeightDataResult {
  readings: WeightReading[];
  loading: boolean;
  error: string | null;
  hasFetched: boolean;
  isUnlocked: boolean;
  addReading: (input: CreateWeightReadingInput) => Promise<WeightReading>;
  refresh: () => Promise<void>;
}

export function useWeightData({
  refreshToken = 0
}: UseWeightDataProps = {}): UseWeightDataResult {
  const { isUnlocked } = useHealthRuntime();
  const tracker = useHealthTracker();

  const [readings, setReadings] = useState<WeightReading[]>([]);
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
      const data = await tracker.listWeightReadings();
      setReadings(data);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch weight readings:', err);
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
    async (input: CreateWeightReadingInput): Promise<WeightReading> => {
      if (!tracker) {
        throw new Error('Database is locked');
      }

      const reading = await tracker.addWeightReading(input);
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
