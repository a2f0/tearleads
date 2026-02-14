import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBloodPressureData } from './useBloodPressureData';

const mockListBloodPressureReadings = vi.fn();
const mockAddBloodPressureReading = vi.fn();
const mockHealthTracker = {
  listBloodPressureReadings: mockListBloodPressureReadings,
  addBloodPressureReading: mockAddBloodPressureReading
};

let mockIsUnlocked = true;
let mockTracker: typeof mockHealthTracker | null = mockHealthTracker;

vi.mock('../useHealthTracker', () => ({
  useHealthTracker: () => mockTracker
}));

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({ isUnlocked: mockIsUnlocked })
}));

const mockReadings = [
  {
    id: 'bp_1',
    recordedAt: '2024-01-15T10:00:00.000Z',
    systolic: 120,
    diastolic: 80,
    pulse: 72,
    note: 'Morning reading'
  },
  {
    id: 'bp_2',
    recordedAt: '2024-01-14T10:00:00.000Z',
    systolic: 125,
    diastolic: 82
  }
];

describe('useBloodPressureData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsUnlocked = true;
    mockTracker = mockHealthTracker;
    mockListBloodPressureReadings.mockResolvedValue(mockReadings);
  });

  it('fetches readings when unlocked', async () => {
    const { result } = renderHook(() => useBloodPressureData());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.readings).toEqual(mockReadings);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not fetch when locked', () => {
    mockIsUnlocked = false;
    mockTracker = null;

    const { result } = renderHook(() => useBloodPressureData());

    expect(mockListBloodPressureReadings).not.toHaveBeenCalled();
    expect(result.current.isUnlocked).toBe(false);
    expect(result.current.hasFetched).toBe(false);
  });

  it('throws error when adding reading while locked', async () => {
    mockIsUnlocked = false;
    mockTracker = null;

    const { result } = renderHook(() => useBloodPressureData());

    const input = {
      recordedAt: '2024-01-16T10:00:00.000Z',
      systolic: 120,
      diastolic: 80
    };

    await expect(result.current.addReading(input)).rejects.toThrow(
      'Database is locked'
    );
  });

  it('adds a reading and refreshes', async () => {
    const newReading = {
      id: 'bp_3',
      recordedAt: '2024-01-16T10:00:00.000Z',
      systolic: 118,
      diastolic: 78
    };
    mockAddBloodPressureReading.mockResolvedValue(newReading);

    const { result } = renderHook(() => useBloodPressureData());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    const input = {
      recordedAt: '2024-01-16T10:00:00.000Z',
      systolic: 118,
      diastolic: 78
    };

    await act(async () => {
      await result.current.addReading(input);
    });

    expect(mockAddBloodPressureReading).toHaveBeenCalledWith(input);
    expect(mockListBloodPressureReadings).toHaveBeenCalledTimes(2);
  });

  it('handles fetch error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockListBloodPressureReadings.mockRejectedValue(
      new Error('Database error')
    );

    const { result } = renderHook(() => useBloodPressureData());

    await waitFor(() => {
      expect(result.current.error).toBe('Database error');
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.readings).toEqual([]);
  });

  it('re-fetches when refreshToken changes', async () => {
    const { result, rerender } = renderHook(
      ({ refreshToken }) => useBloodPressureData({ refreshToken }),
      { initialProps: { refreshToken: 0 } }
    );

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(mockListBloodPressureReadings).toHaveBeenCalledTimes(1);

    rerender({ refreshToken: 1 });

    await waitFor(() => {
      expect(mockListBloodPressureReadings).toHaveBeenCalledTimes(2);
    });
  });

  it('refresh function triggers re-fetch', async () => {
    const { result } = renderHook(() => useBloodPressureData());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(mockListBloodPressureReadings).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockListBloodPressureReadings).toHaveBeenCalledTimes(2);
  });
});
