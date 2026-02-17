import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthRuntimeProvider } from '../../runtime';
import { useHealthTracker } from './useHealthTracker';

let mockIsUnlocked = true;
const mockCreateTracker = vi.fn(() => ({
  listWeightReadings: vi.fn(),
  addWeightReading: vi.fn()
}));

describe('useHealthTracker', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <HealthRuntimeProvider
      isUnlocked={mockIsUnlocked}
      createTracker={mockCreateTracker}
    >
      {children}
    </HealthRuntimeProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsUnlocked = true;
  });

  it('returns null when database is locked', () => {
    mockIsUnlocked = false;

    const { result } = renderHook(() => useHealthTracker(), { wrapper });

    expect(result.current).toBeNull();
  });

  it('returns HealthTracker when database is unlocked', async () => {
    mockIsUnlocked = true;

    const { result } = renderHook(() => useHealthTracker(), { wrapper });

    expect(result.current).not.toBeNull();
    expect(result.current).toHaveProperty('listWeightReadings');
    expect(result.current).toHaveProperty('addWeightReading');
  });

  it('memoizes the tracker instance', () => {
    mockIsUnlocked = true;

    const { result, rerender } = renderHook(() => useHealthTracker(), {
      wrapper
    });
    const firstTracker = result.current;

    rerender();
    const secondTracker = result.current;

    expect(firstTracker).toBe(secondTracker);
    expect(mockCreateTracker).toHaveBeenCalledTimes(1);
  });

  it('creates new tracker when isUnlocked changes', () => {
    mockIsUnlocked = false;
    mockCreateTracker.mockClear();

    const { result, rerender } = renderHook(() => useHealthTracker(), {
      wrapper
    });
    expect(result.current).toBeNull();

    mockIsUnlocked = true;
    rerender();

    expect(result.current).not.toBeNull();
    expect(mockCreateTracker).toHaveBeenCalledTimes(1);
  });
});
