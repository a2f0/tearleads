import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWeightData } from './useWeightData';

const mockListWeightReadings = vi.fn();
const mockAddWeightReading = vi.fn();
const mockHealthTracker = {
  listWeightReadings: mockListWeightReadings,
  addWeightReading: mockAddWeightReading
};

let mockIsUnlocked = true;
let mockTracker: typeof mockHealthTracker | null = mockHealthTracker;

vi.mock('../useHealthTracker', () => ({
  useHealthTracker: () => mockTracker
}));

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({ isUnlocked: mockIsUnlocked })
}));

const mockWeightReadings = [
  {
    id: 'weight_1',
    recordedAt: '2024-01-15T10:00:00.000Z',
    value: 185.5,
    unit: 'lb' as const,
    note: 'Morning weight'
  },
  {
    id: 'weight_2',
    recordedAt: '2024-01-14T10:00:00.000Z',
    value: 186.0,
    unit: 'lb' as const
  }
];

describe('useWeightData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsUnlocked = true;
    mockTracker = mockHealthTracker;
    mockListWeightReadings.mockResolvedValue(mockWeightReadings);
  });

  it('fetches readings when unlocked', async () => {
    const { result } = renderHook(() => useWeightData());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.readings).toEqual(mockWeightReadings);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not fetch when locked', () => {
    mockIsUnlocked = false;
    mockTracker = null;

    const { result } = renderHook(() => useWeightData());

    expect(mockListWeightReadings).not.toHaveBeenCalled();
    expect(result.current.isUnlocked).toBe(false);
    expect(result.current.hasFetched).toBe(false);
  });

  it('throws error when adding reading while locked', async () => {
    mockIsUnlocked = false;
    mockTracker = null;

    const { result } = renderHook(() => useWeightData());

    const input = {
      recordedAt: '2024-01-16T10:00:00.000Z',
      value: 184.0,
      unit: 'lb' as const
    };

    await expect(result.current.addReading(input)).rejects.toThrow(
      'Database is locked'
    );
  });

  it('adds a reading and refreshes', async () => {
    const newReading = {
      id: 'weight_3',
      recordedAt: '2024-01-16T10:00:00.000Z',
      value: 184.0,
      unit: 'lb' as const
    };
    mockAddWeightReading.mockResolvedValue(newReading);

    const { result } = renderHook(() => useWeightData());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    const input = {
      recordedAt: '2024-01-16T10:00:00.000Z',
      value: 184.0,
      unit: 'lb' as const
    };

    await act(async () => {
      await result.current.addReading(input);
    });

    expect(mockAddWeightReading).toHaveBeenCalledWith(input);
    expect(mockListWeightReadings).toHaveBeenCalledTimes(2);
  });

  it('handles fetch error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockListWeightReadings.mockRejectedValue(new Error('Database error'));

    const { result } = renderHook(() => useWeightData());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Database error');
    expect(result.current.readings).toEqual([]);
  });

  it('re-fetches when refreshToken changes', async () => {
    const { result, rerender } = renderHook(
      ({ refreshToken }) => useWeightData({ refreshToken }),
      { initialProps: { refreshToken: 0 } }
    );

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(mockListWeightReadings).toHaveBeenCalledTimes(1);

    rerender({ refreshToken: 1 });

    await waitFor(() => {
      expect(mockListWeightReadings).toHaveBeenCalledTimes(2);
    });
  });

  it('refresh function triggers re-fetch', async () => {
    const { result } = renderHook(() => useWeightData());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(mockListWeightReadings).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockListWeightReadings).toHaveBeenCalledTimes(2);
  });
});
