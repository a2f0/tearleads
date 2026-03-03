import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVfsSyncState, VfsSyncStateProvider } from './VfsSyncStateContext';

const mockUseVfsOrchestratorInstance = vi.fn();

vi.mock('./VfsOrchestratorContext', () => ({
  useVfsOrchestratorInstance: () => mockUseVfsOrchestratorInstance()
}));

interface MockSnapshot {
  cursor: {
    changedAt: string;
    changeId: string;
  } | null;
  containerClocks: Array<{
    containerId: string;
    changedAt: string;
    changeId: string;
  }>;
}

interface MockOrchestrator {
  crdt: {
    snapshot: () => MockSnapshot;
  };
}

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(VfsSyncStateProvider, {}, children);

function createMockOrchestrator(snapshot: MockSnapshot): MockOrchestrator {
  return {
    crdt: {
      snapshot: () => snapshot
    }
  };
}

describe('VfsSyncStateContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns fallback values when used outside provider', () => {
    const { result } = renderHook(() => useVfsSyncState());

    expect(result.current.globalCursor).toBeNull();
    expect(result.current.getItemCursor('item-1')).toBeNull();
    expect(result.current.getItemCursor('')).toBeNull();
    expect(result.current.updatedAtMs).toBeNull();
  });

  it('surfaces global and per-item cursors from orchestrator snapshot', async () => {
    mockUseVfsOrchestratorInstance.mockReturnValue(
      createMockOrchestrator({
        cursor: { changedAt: '2026-03-03T12:00:00Z', changeId: 'global-1' },
        containerClocks: [
          {
            containerId: 'item-1',
            changedAt: '2026-03-03T12:00:01Z',
            changeId: 'item-1-change-1'
          },
          {
            containerId: '   ',
            changedAt: 'ignored',
            changeId: 'ignored'
          }
        ]
      })
    );

    const { result } = renderHook(() => useVfsSyncState(), { wrapper });

    await waitFor(() => {
      expect(result.current.globalCursor).toEqual({
        changedAt: '2026-03-03T12:00:00Z',
        changeId: 'global-1'
      });
    });

    expect(result.current.getItemCursor('item-1')).toEqual({
      changedAt: '2026-03-03T12:00:01Z',
      changeId: 'item-1-change-1'
    });
    expect(result.current.getItemCursor('missing')).toBeNull();
    expect(result.current.getItemCursor('')).toBeNull();
    expect(result.current.getItemCursor('   ')).toBeNull();
    expect(result.current.updatedAtMs).not.toBeNull();
  });

  it('does not update timestamp when refresh sees identical snapshot', async () => {
    mockUseVfsOrchestratorInstance.mockReturnValue(
      createMockOrchestrator({
        cursor: { changedAt: '2026-03-03T12:10:00Z', changeId: 'global-2' },
        containerClocks: [
          {
            containerId: 'item-2',
            changedAt: '2026-03-03T12:10:01Z',
            changeId: 'item-2-change-1'
          }
        ]
      })
    );

    const { result } = renderHook(() => useVfsSyncState(), { wrapper });

    await waitFor(() => {
      expect(result.current.updatedAtMs).not.toBeNull();
    });
    const initialUpdatedAt = result.current.updatedAtMs;

    act(() => {
      result.current.refresh();
    });

    expect(result.current.updatedAtMs).toBe(initialUpdatedAt);
  });

  it('clears cursor state when orchestrator becomes unavailable', async () => {
    let orchestrator: MockOrchestrator | null = createMockOrchestrator({
      cursor: { changedAt: '2026-03-03T12:20:00Z', changeId: 'global-3' },
      containerClocks: [
        {
          containerId: 'item-3',
          changedAt: '2026-03-03T12:20:01Z',
          changeId: 'item-3-change-1'
        }
      ]
    });
    mockUseVfsOrchestratorInstance.mockImplementation(() => orchestrator);

    const { result, rerender } = renderHook(() => useVfsSyncState(), {
      wrapper
    });

    await waitFor(() => {
      expect(result.current.getItemCursor('item-3')).toEqual({
        changedAt: '2026-03-03T12:20:01Z',
        changeId: 'item-3-change-1'
      });
    });

    orchestrator = null;
    rerender();
    act(() => {
      result.current.refresh();
    });

    expect(result.current.globalCursor).toBeNull();
    expect(result.current.getItemCursor('item-3')).toBeNull();
    expect(result.current.updatedAtMs).toBeNull();
  });
});
