import { createHealthTracker } from '@tearleads/health';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHealthTracker } from './useHealthTracker';

vi.mock('@tearleads/health', () => ({
  createHealthTracker: vi.fn(() => ({
    listWeightReadings: vi.fn(),
    addWeightReading: vi.fn()
  }))
}));

vi.mock('@/db', () => ({
  getDatabase: vi.fn(() => ({}))
}));

let mockIsUnlocked = true;

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({ isUnlocked: mockIsUnlocked })
}));

describe('useHealthTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsUnlocked = true;
  });

  it('returns null when database is locked', () => {
    mockIsUnlocked = false;

    const { result } = renderHook(() => useHealthTracker());

    expect(result.current).toBeNull();
  });

  it('returns HealthTracker when database is unlocked', async () => {
    mockIsUnlocked = true;

    const { result } = renderHook(() => useHealthTracker());

    expect(result.current).not.toBeNull();
    expect(result.current).toHaveProperty('listWeightReadings');
    expect(result.current).toHaveProperty('addWeightReading');
  });

  it('memoizes the tracker instance', () => {
    mockIsUnlocked = true;

    const { result, rerender } = renderHook(() => useHealthTracker());
    const firstTracker = result.current;

    rerender();
    const secondTracker = result.current;

    expect(firstTracker).toBe(secondTracker);
    expect(vi.mocked(createHealthTracker)).toHaveBeenCalledTimes(1);
  });

  it('creates new tracker when isUnlocked changes', () => {
    mockIsUnlocked = false;
    vi.mocked(createHealthTracker).mockClear();

    const { result, rerender } = renderHook(() => useHealthTracker());
    expect(result.current).toBeNull();

    mockIsUnlocked = true;
    rerender();

    expect(result.current).not.toBeNull();
    expect(vi.mocked(createHealthTracker)).toHaveBeenCalledTimes(1);
  });
});
