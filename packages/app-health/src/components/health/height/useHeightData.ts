import { useCallback, useEffect, useState } from 'react';
import type {
  CreateHeightReadingInput,
  HeightReading
} from '../../../lib/healthTrackerTypes.js';
import { useHealthRuntime } from '../../../runtime';
import { useHealthTracker } from '../useHealthTracker';

interface UseHeightDataProps {
  refreshToken?: number;
}

interface UseHeightDataResult {
  readings: HeightReading[];
  loading: boolean;
  error: string | null;
  hasFetched: boolean;
  isUnlocked: boolean;
  addReading: (input: CreateHeightReadingInput) => Promise<HeightReading>;
  refresh: () => Promise<void>;
}

export function useHeightData({
  refreshToken = 0
}: UseHeightDataProps = {}): UseHeightDataResult {
  const { isUnlocked } = useHealthRuntime();
  const tracker = useHealthTracker();

  const [readings, setReadings] = useState<HeightReading[]>([]);
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
      const data = await tracker.listHeightReadings();
      setReadings(data);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch height readings:', err);
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
    void fetchReadings();
  }, [fetchReadings, isUnlocked, tracker, refreshToken]);

  const addReading = useCallback(
    async (input: CreateHeightReadingInput): Promise<HeightReading> => {
      if (!tracker) {
        throw new Error('Database is locked');
      }

      const reading = await tracker.addHeightReading(input);
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
