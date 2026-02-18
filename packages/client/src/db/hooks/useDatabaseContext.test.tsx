import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  DatabaseContext,
  useDatabase,
  useDatabaseContext,
  useDatabaseOptional
} from './useDatabaseContext';
import type { DatabaseContextValue } from './useDatabaseTypes';

const createContextValue = (
  overrides: Partial<DatabaseContextValue> = {}
): DatabaseContextValue => ({
  db: null,
  isLoading: false,
  error: null,
  isSetUp: false,
  isUnlocked: false,
  hasPersistedSession: false,
  currentInstanceId: null,
  currentInstanceName: null,
  instances: [],
  setup: vi.fn(async () => false),
  unlock: vi.fn(async () => false),
  restoreSession: vi.fn(async () => false),
  persistSession: vi.fn(async () => false),
  clearPersistedSession: vi.fn(async () => {}),
  lock: vi.fn(async () => {}),
  changePassword: vi.fn(async () => false),
  reset: vi.fn(async () => {}),
  exportDatabase: vi.fn(async () => new Uint8Array()),
  importDatabase: vi.fn(async () => {}),
  createInstance: vi.fn(async () => 'instance-1'),
  switchInstance: vi.fn(async () => false),
  deleteInstance: vi.fn(async () => {}),
  refreshInstances: vi.fn(async () => {}),
  ...overrides
});

function createWrapper(value: DatabaseContextValue) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DatabaseContext.Provider value={value}>
        {children}
      </DatabaseContext.Provider>
    );
  };
}

describe('useDatabaseContext hooks', () => {
  it('throws when useDatabaseContext is used outside provider', () => {
    expect(() => renderHook(() => useDatabaseContext())).toThrow(
      'useDatabaseContext must be used within a DatabaseProvider'
    );
  });

  it('returns provider value from useDatabaseContext', () => {
    const value = createContextValue();
    const { result } = renderHook(() => useDatabaseContext(), {
      wrapper: createWrapper(value)
    });

    expect(result.current).toBe(value);
  });

  it('throws when useDatabase is called while locked', () => {
    const value = createContextValue({ isUnlocked: false, db: null });

    expect(() =>
      renderHook(() => useDatabase(), { wrapper: createWrapper(value) })
    ).toThrow(
      'Database is not unlocked. Use useDatabaseContext for conditional access.'
    );
  });

  it('throws when useDatabase is called without database instance', () => {
    const value = createContextValue({ isUnlocked: true, db: null });

    expect(() =>
      renderHook(() => useDatabase(), { wrapper: createWrapper(value) })
    ).toThrow(
      'Database is not unlocked. Use useDatabaseContext for conditional access.'
    );
  });

  it('returns null from useDatabaseOptional when no database exists', () => {
    const value = createContextValue({ db: null });
    const { result } = renderHook(() => useDatabaseOptional(), {
      wrapper: createWrapper(value)
    });

    expect(result.current).toBeNull();
  });
});
