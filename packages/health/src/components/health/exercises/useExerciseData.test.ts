import type { CreateExerciseInput, Exercise } from '@tearleads/health';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useExerciseData } from './useExerciseData';

const listExercisesMock = vi.fn<() => Promise<Exercise[]>>();
const addExerciseMock =
  vi.fn<(input: CreateExerciseInput) => Promise<Exercise>>();

let mockIsUnlocked = true;
let mockTracker: {
  listExercises: typeof listExercisesMock;
  addExercise: typeof addExerciseMock;
} | null = null;

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({ isUnlocked: mockIsUnlocked })
}));

vi.mock('../useHealthTracker', () => ({
  useHealthTracker: () => mockTracker
}));

function createExercise(id: string, name: string, parentId?: string): Exercise {
  const exercise: Exercise = { id, name };
  if (parentId !== undefined) {
    exercise.parentId = parentId;
  }
  return exercise;
}

describe('useExerciseData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsUnlocked = true;
    mockTracker = {
      listExercises: listExercisesMock,
      addExercise: addExerciseMock
    };
    listExercisesMock.mockResolvedValue([]);
  });

  it('does not fetch when database is locked', async () => {
    mockIsUnlocked = false;

    const { result } = renderHook(() => useExerciseData());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isUnlocked).toBe(false);
    expect(result.current.hasFetched).toBe(false);
    expect(listExercisesMock).not.toHaveBeenCalled();
  });

  it('does not fetch when tracker is unavailable', async () => {
    mockTracker = null;

    const { result } = renderHook(() => useExerciseData());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasFetched).toBe(false);
    expect(listExercisesMock).not.toHaveBeenCalled();
  });

  it('fetches exercises and derives parent hierarchy', async () => {
    const parent = createExercise('parent', 'Pull Up');
    const siblingParent = createExercise('sibling-parent', 'Squat');
    const child = createExercise('child', 'Wide Grip Pull Up', 'parent');
    const orphan = createExercise('orphan', 'Unknown Parent Child', 'missing');

    listExercisesMock.mockResolvedValue([parent, siblingParent, child, orphan]);

    const { result } = renderHook(() => useExerciseData());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.exercises).toEqual([
      parent,
      siblingParent,
      child,
      orphan
    ]);
    expect(result.current.parentExercises).toEqual([parent, siblingParent]);
    expect(result.current.hierarchy.get('parent')).toEqual([child]);
    expect(result.current.hierarchy.get('sibling-parent')).toEqual([]);
  });

  it('captures fetch errors and exposes them as hook state', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    listExercisesMock.mockRejectedValue(new Error('exercise read failed'));

    const { result } = renderHook(() => useExerciseData());

    await waitFor(() => {
      expect(result.current.error).toBe('exercise read failed');
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.hasFetched).toBe(false);

    consoleErrorSpy.mockRestore();
  });

  it('refreshes when refreshToken changes', async () => {
    const parent = createExercise('parent', 'Pull Up');
    listExercisesMock.mockResolvedValue([parent]);

    const { rerender } = renderHook(
      ({ token }: { token: number }) =>
        useExerciseData({ refreshToken: token }),
      {
        initialProps: { token: 0 }
      }
    );

    await waitFor(() => {
      expect(listExercisesMock).toHaveBeenCalledTimes(1);
    });

    rerender({ token: 1 });

    await waitFor(() => {
      expect(listExercisesMock).toHaveBeenCalledTimes(2);
    });
  });

  it('throws when addExercise is called while tracker is unavailable', async () => {
    mockTracker = null;

    const { result } = renderHook(() => useExerciseData());

    const input: CreateExerciseInput = { name: 'New Movement' };

    await expect(result.current.addExercise(input)).rejects.toThrow(
      'Database is locked'
    );
  });

  it('adds an exercise and refreshes local state', async () => {
    const parent = createExercise('parent', 'Pull Up');
    const child = createExercise('child', 'Neutral Grip Pull Up', 'parent');

    listExercisesMock
      .mockResolvedValueOnce([parent])
      .mockResolvedValueOnce([parent, child]);
    addExerciseMock.mockResolvedValue(child);

    const { result } = renderHook(() => useExerciseData());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    const input: CreateExerciseInput = {
      name: 'Neutral Grip Pull Up',
      parentId: 'parent'
    };

    let created: Exercise | undefined;

    await act(async () => {
      created = await result.current.addExercise(input);
    });

    expect(created).toEqual(child);
    expect(addExerciseMock).toHaveBeenCalledWith(input);

    await waitFor(() => {
      expect(listExercisesMock).toHaveBeenCalledTimes(2);
    });

    expect(result.current.exercises).toEqual([parent, child]);
    expect(result.current.hierarchy.get('parent')).toEqual([child]);
  });
});
