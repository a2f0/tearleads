import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHeightData } from './useHeightData';

const mockListHeightReadings = vi.fn();
const mockAddHeightReading = vi.fn();
const mockHealthTracker = {
  listHeightReadings: mockListHeightReadings,
  addHeightReading: mockAddHeightReading
};

let mockIsUnlocked = true;
let mockTracker: typeof mockHealthTracker | null = mockHealthTracker;

vi.mock('../useHealthTracker', () => ({
  useHealthTracker: () => mockTracker
}));

vi.mock('../../../runtime', () => ({
  useHealthRuntime: () => ({
    isUnlocked: mockIsUnlocked,
    createTracker: vi.fn()
  })
}));

const mockHeightReadings = [
  {
    id: 'height_1',
    recordedAt: '2024-01-15T10:00:00.000Z',
    value: 42.5,
    unit: 'in' as const,
    note: 'Annual checkup',
    contactId: null
  },
  {
    id: 'height_2',
    recordedAt: '2024-01-14T10:00:00.000Z',
    value: 108,
    unit: 'cm' as const,
    contactId: null
  }
];

describe('useHeightData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsUnlocked = true;
    mockTracker = mockHealthTracker;
    mockListHeightReadings.mockResolvedValue(mockHeightReadings);
  });

  it('fetches readings when unlocked', async () => {
    const { result } = renderHook(() => useHeightData());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.readings).toEqual(mockHeightReadings);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not fetch when locked', () => {
    mockIsUnlocked = false;
    mockTracker = null;

    const { result } = renderHook(() => useHeightData());

    expect(mockListHeightReadings).not.toHaveBeenCalled();
    expect(result.current.isUnlocked).toBe(false);
    expect(result.current.hasFetched).toBe(false);
  });

  it('throws error when adding reading while locked', async () => {
    mockIsUnlocked = false;
    mockTracker = null;

    const { result } = renderHook(() => useHeightData());

    const input = {
      recordedAt: '2024-01-16T10:00:00.000Z',
      value: 42,
      unit: 'in' as const
    };

    await expect(result.current.addReading(input)).rejects.toThrow(
      'Database is locked'
    );
  });

  it('adds a reading and refreshes', async () => {
    const newReading = {
      id: 'height_3',
      recordedAt: '2024-01-16T10:00:00.000Z',
      value: 43,
      unit: 'in' as const,
      contactId: null
    };
    mockAddHeightReading.mockResolvedValue(newReading);

    const { result } = renderHook(() => useHeightData());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    const input = {
      recordedAt: '2024-01-16T10:00:00.000Z',
      value: 43,
      unit: 'in' as const
    };

    await act(async () => {
      await result.current.addReading(input);
    });

    expect(mockAddHeightReading).toHaveBeenCalledWith(input);
    expect(mockListHeightReadings).toHaveBeenCalledTimes(2);
  });

  it('handles fetch error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockListHeightReadings.mockRejectedValue(new Error('Database error'));

    const { result } = renderHook(() => useHeightData());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Database error');
    expect(result.current.readings).toEqual([]);
  });

  it('re-fetches when refreshToken changes', async () => {
    const { result, rerender } = renderHook(
      ({ refreshToken }) => useHeightData({ refreshToken }),
      { initialProps: { refreshToken: 0 } }
    );

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(mockListHeightReadings).toHaveBeenCalledTimes(1);

    rerender({ refreshToken: 1 });

    await waitFor(() => {
      expect(mockListHeightReadings).toHaveBeenCalledTimes(2);
    });
  });

  it('refresh function triggers re-fetch', async () => {
    const { result } = renderHook(() => useHeightData());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(mockListHeightReadings).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockListHeightReadings).toHaveBeenCalledTimes(2);
  });
});
