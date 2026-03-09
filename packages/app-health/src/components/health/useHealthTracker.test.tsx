import type { HostRuntimeDatabaseState } from '@tearleads/shared';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthRuntimeProvider } from '../../runtime';
import { useHealthTracker } from './useHealthTracker';

let mockDatabaseState: HostRuntimeDatabaseState = {
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'instance-a'
};
let useLegacyRuntime = false;
let legacyIsUnlocked = false;

const mockCreateTracker = vi.fn(() => ({
  listWeightReadings: vi.fn(),
  addWeightReading: vi.fn()
}));

describe('useHealthTracker', () => {
  const wrapper = ({ children }: { children: ReactNode }) =>
    useLegacyRuntime ? (
      <HealthRuntimeProvider
        isUnlocked={legacyIsUnlocked}
        createTracker={mockCreateTracker}
      >
        {children}
      </HealthRuntimeProvider>
    ) : (
      <HealthRuntimeProvider
        databaseState={mockDatabaseState}
        createTracker={mockCreateTracker}
      >
        {children}
      </HealthRuntimeProvider>
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabaseState = {
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'instance-a'
    };
    useLegacyRuntime = false;
    legacyIsUnlocked = false;
  });

  it('returns null when database is locked', () => {
    mockDatabaseState = {
      ...mockDatabaseState,
      isUnlocked: false
    };

    const { result } = renderHook(() => useHealthTracker(), { wrapper });

    expect(result.current).toBeNull();
  });

  it('returns HealthTracker when database is unlocked', async () => {
    const { result } = renderHook(() => useHealthTracker(), { wrapper });

    expect(result.current).not.toBeNull();
    expect(result.current).toHaveProperty('listWeightReadings');
    expect(result.current).toHaveProperty('addWeightReading');
  });

  it('memoizes the tracker instance', () => {
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
    mockDatabaseState = {
      ...mockDatabaseState,
      isUnlocked: false
    };
    mockCreateTracker.mockClear();

    const { result, rerender } = renderHook(() => useHealthTracker(), {
      wrapper
    });
    expect(result.current).toBeNull();

    mockDatabaseState = {
      ...mockDatabaseState,
      isUnlocked: true
    };
    rerender();

    expect(result.current).not.toBeNull();
    expect(mockCreateTracker).toHaveBeenCalledTimes(1);
  });

  it('creates a new tracker when currentInstanceId changes', () => {
    mockCreateTracker.mockClear();

    const { result, rerender } = renderHook(() => useHealthTracker(), {
      wrapper
    });
    const firstTracker = result.current;
    expect(firstTracker).not.toBeNull();

    mockDatabaseState = {
      ...mockDatabaseState,
      currentInstanceId: 'instance-b'
    };
    rerender();

    expect(result.current).not.toBe(firstTracker);
    expect(mockCreateTracker).toHaveBeenCalledTimes(2);
  });

  it('supports legacy isUnlocked runtime provider prop', () => {
    useLegacyRuntime = true;
    legacyIsUnlocked = false;

    mockCreateTracker.mockClear();
    const { result, rerender } = renderHook(() => useHealthTracker(), {
      wrapper
    });
    expect(result.current).toBeNull();
    expect(mockCreateTracker).not.toHaveBeenCalled();

    legacyIsUnlocked = true;
    rerender();

    expect(result.current).not.toBeNull();
    expect(mockCreateTracker).toHaveBeenCalledTimes(1);
  });
});
