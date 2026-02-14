import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkoutData } from './useWorkoutData';

const mockListWorkoutEntries = vi.fn();
const mockListExercises = vi.fn();
const mockAddWorkoutEntry = vi.fn();
const mockHealthTracker = {
  listWorkoutEntries: mockListWorkoutEntries,
  listExercises: mockListExercises,
  addWorkoutEntry: mockAddWorkoutEntry
};

let mockIsUnlocked = true;
let mockTracker: typeof mockHealthTracker | null = mockHealthTracker;

vi.mock('../useHealthTracker', () => ({
  useHealthTracker: () => mockTracker
}));

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({ isUnlocked: mockIsUnlocked })
}));

const mockExercises = [
  { id: 'back-squat', name: 'Back Squat' },
  { id: 'bench-press', name: 'Bench Press' }
];

const mockEntries = [
  {
    id: 'workout_1',
    performedAt: '2024-01-15T10:00:00.000Z',
    exerciseId: 'back-squat',
    exerciseName: 'Back Squat',
    reps: 5,
    weight: 225,
    weightUnit: 'lb' as const,
    note: 'PR attempt'
  },
  {
    id: 'workout_2',
    performedAt: '2024-01-14T10:00:00.000Z',
    exerciseId: 'bench-press',
    exerciseName: 'Bench Press',
    reps: 8,
    weight: 185,
    weightUnit: 'lb' as const
  }
];

describe('useWorkoutData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsUnlocked = true;
    mockTracker = mockHealthTracker;
    mockListWorkoutEntries.mockResolvedValue(mockEntries);
    mockListExercises.mockResolvedValue(mockExercises);
  });

  it('fetches entries and exercises when unlocked', async () => {
    const { result } = renderHook(() => useWorkoutData());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.entries).toEqual(mockEntries);
    expect(result.current.exercises).toEqual(mockExercises);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not fetch when locked', () => {
    mockIsUnlocked = false;
    mockTracker = null;

    const { result } = renderHook(() => useWorkoutData());

    expect(mockListWorkoutEntries).not.toHaveBeenCalled();
    expect(mockListExercises).not.toHaveBeenCalled();
    expect(result.current.isUnlocked).toBe(false);
    expect(result.current.hasFetched).toBe(false);
  });

  it('throws error when adding entry while locked', async () => {
    mockIsUnlocked = false;
    mockTracker = null;

    const { result } = renderHook(() => useWorkoutData());

    const input = {
      performedAt: '2024-01-16T10:00:00.000Z',
      exerciseId: 'back-squat',
      reps: 5,
      weight: 225,
      weightUnit: 'lb' as const
    };

    await expect(result.current.addEntry(input)).rejects.toThrow(
      'Database is locked'
    );
  });

  it('adds an entry and refreshes', async () => {
    const newEntry = {
      id: 'workout_3',
      performedAt: '2024-01-16T10:00:00.000Z',
      exerciseId: 'deadlift',
      exerciseName: 'Deadlift',
      reps: 3,
      weight: 315,
      weightUnit: 'lb' as const
    };
    mockAddWorkoutEntry.mockResolvedValue(newEntry);

    const { result } = renderHook(() => useWorkoutData());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    const input = {
      performedAt: '2024-01-16T10:00:00.000Z',
      exerciseId: 'deadlift',
      reps: 3,
      weight: 315,
      weightUnit: 'lb' as const
    };

    await act(async () => {
      await result.current.addEntry(input);
    });

    expect(mockAddWorkoutEntry).toHaveBeenCalledWith(input);
    expect(mockListWorkoutEntries).toHaveBeenCalledTimes(2);
    expect(mockListExercises).toHaveBeenCalledTimes(2);
  });

  it('handles fetch error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockListWorkoutEntries.mockRejectedValue(new Error('Database error'));

    const { result } = renderHook(() => useWorkoutData());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Database error');
    expect(result.current.entries).toEqual([]);
  });

  it('re-fetches when refreshToken changes', async () => {
    const { result, rerender } = renderHook(
      ({ refreshToken }) => useWorkoutData({ refreshToken }),
      { initialProps: { refreshToken: 0 } }
    );

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(mockListWorkoutEntries).toHaveBeenCalledTimes(1);

    rerender({ refreshToken: 1 });

    await waitFor(() => {
      expect(mockListWorkoutEntries).toHaveBeenCalledTimes(2);
    });
  });

  it('refresh function triggers re-fetch', async () => {
    const { result } = renderHook(() => useWorkoutData());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(mockListWorkoutEntries).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockListWorkoutEntries).toHaveBeenCalledTimes(2);
  });
});
