// one-component-per-file: allow -- test file with multiple wrapper components
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseContext } from '@/db/hooks/useDatabaseContext';
import type { DatabaseContextValue } from '@/db/hooks/useDatabaseTypes';
import {
  clearPreserveWindowState,
  setPreserveWindowState
} from '@/lib/windowStatePreference';
import {
  clearAllWindowSnapshots,
  loadWindowSnapshot,
  saveWindowSnapshot
} from '@/storage/windowSnapshotStorage';
import {
  useWindowManager,
  WindowManagerProvider
} from './WindowManagerContext';

function createMockDbContext(instanceId: string | null): DatabaseContextValue {
  return {
    db: null,
    isLoading: false,
    error: null,
    isSetUp: true,
    isUnlocked: true,
    hasPersistedSession: false,
    currentInstanceId: instanceId,
    currentInstanceName: instanceId ? `Instance ${instanceId}` : null,
    instances: [],
    setup: async () => true,
    unlock: async () => true,
    restoreSession: async () => true,
    persistSession: async () => true,
    clearPersistedSession: async () => {},
    lock: async () => {},
    changePassword: async () => true,
    reset: async () => {},
    exportDatabase: async () => new Uint8Array(),
    importDatabase: async () => {},
    createInstance: async () => '',
    switchInstance: async () => true,
    deleteInstance: async () => {},
    refreshInstances: async () => {}
  };
}

describe('WindowManagerContext instance scoping', () => {
  beforeEach(() => {
    localStorage.clear();
    clearPreserveWindowState();
    clearAllWindowSnapshots();
    Object.defineProperty(window, 'innerWidth', {
      value: 1440,
      configurable: true
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 900,
      configurable: true
    });
  });

  function createWrapper(instanceId: string | null) {
    return function Wrapper({ children }: { children: ReactNode }) {
      const dbContextRef = useRef(createMockDbContext(instanceId));
      return (
        <DatabaseContext.Provider value={dbContextRef.current}>
          <WindowManagerProvider>{children}</WindowManagerProvider>
        </DatabaseContext.Provider>
      );
    };
  }

  it('uses default key when no DatabaseContext is available', () => {
    function wrapper({ children }: { children: ReactNode }) {
      return <WindowManagerProvider>{children}</WindowManagerProvider>;
    }

    const { result } = renderHook(() => useWindowManager(), { wrapper });
    expect(result.current.windows).toEqual([]);
  });

  it('loads saved snapshot for an instance', () => {
    saveWindowSnapshot('inst-1', [
      { id: 'w1', type: 'notes', zIndex: 100, isMinimized: false }
    ]);

    const wrapper = createWrapper('inst-1');
    const { result } = renderHook(() => useWindowManager(), { wrapper });

    expect(result.current.windows).toHaveLength(1);
    expect(result.current.windows[0]?.id).toBe('w1');
    expect(result.current.windows[0]?.type).toBe('notes');
  });

  it('starts empty for instance with no saved snapshot', () => {
    const wrapper = createWrapper('inst-new');
    const { result } = renderHook(() => useWindowManager(), { wrapper });
    expect(result.current.windows).toEqual([]);
  });

  it('saves instance-scoped dimensions', () => {
    const wrapper = createWrapper('inst-1');
    const { result } = renderHook(() => useWindowManager(), { wrapper });

    act(() => {
      result.current.openWindow('notes', 'w1');
    });

    act(() => {
      result.current.saveWindowDimensionsForType('notes', {
        width: 800,
        height: 600,
        x: 50,
        y: 50
      });
    });

    expect(
      localStorage.getItem('window-dimensions:inst-1:notes')
    ).not.toBeNull();
  });

  it('loads scoped dimensions when available', () => {
    localStorage.setItem(
      'window-dimensions:inst-1:notes',
      JSON.stringify({ width: 500, height: 400, x: 10, y: 10 })
    );

    const wrapper = createWrapper('inst-1');
    const { result } = renderHook(() => useWindowManager(), { wrapper });

    act(() => {
      result.current.openWindow('notes', 'w1');
    });

    const win = result.current.getWindow('w1');
    expect(win?.dimensions).toEqual({
      width: 500,
      height: 400,
      x: 10,
      y: 10
    });
  });

  it('falls back to unscoped dimensions for migration', () => {
    localStorage.setItem(
      'window-dimensions:notes',
      JSON.stringify({ width: 600, height: 450, x: 20, y: 20 })
    );

    const wrapper = createWrapper('inst-1');
    const { result } = renderHook(() => useWindowManager(), { wrapper });

    act(() => {
      result.current.openWindow('notes', 'w1');
    });

    const win = result.current.getWindow('w1');
    expect(win?.dimensions).toEqual({
      width: 600,
      height: 450,
      x: 20,
      y: 20
    });
  });

  it('prefers scoped dimensions over unscoped', () => {
    localStorage.setItem(
      'window-dimensions:notes',
      JSON.stringify({ width: 600, height: 450, x: 20, y: 20 })
    );
    localStorage.setItem(
      'window-dimensions:inst-1:notes',
      JSON.stringify({ width: 800, height: 600, x: 50, y: 50 })
    );

    const wrapper = createWrapper('inst-1');
    const { result } = renderHook(() => useWindowManager(), { wrapper });

    act(() => {
      result.current.openWindow('notes', 'w1');
    });

    const win = result.current.getWindow('w1');
    expect(win?.dimensions).toEqual({
      width: 800,
      height: 600,
      x: 50,
      y: 50
    });
  });

  it('does not load snapshot when preserve state is disabled', () => {
    saveWindowSnapshot('inst-1', [
      { id: 'w1', type: 'notes', zIndex: 100, isMinimized: false }
    ]);

    setPreserveWindowState(false);

    const wrapper = createWrapper('inst-1');
    const { result } = renderHook(() => useWindowManager(), { wrapper });

    expect(result.current.windows).toEqual([]);
  });

  it('saves snapshot on unmount', () => {
    const wrapper = createWrapper('inst-1');
    const { result, unmount } = renderHook(() => useWindowManager(), {
      wrapper
    });

    act(() => {
      result.current.openWindow('notes', 'w1');
    });

    unmount();

    const snapshot = loadWindowSnapshot('inst-1');
    expect(snapshot).not.toBeNull();
    expect(snapshot?.some((w) => w.id === 'w1')).toBe(true);
  });

  it('does not save snapshot for default instance key', () => {
    const wrapper = createWrapper(null);
    const { result, unmount } = renderHook(() => useWindowManager(), {
      wrapper
    });

    act(() => {
      result.current.openWindow('notes', 'w1');
    });

    unmount();

    expect(loadWindowSnapshot('default')).toBeNull();
  });
});
