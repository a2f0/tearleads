import type { VfsSharePolicyPreviewResponse } from '@tearleads/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWrapper } from '../test/testUtils';
import { useSharePolicyPreview } from './useSharePolicyPreview';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('useSharePolicyPreview', () => {
  it('fetches preview nodes for selected principal', async () => {
    const getSharePolicyPreview = vi.fn(async () => ({
      nodes: [
        {
          itemId: 'root-1',
          objectType: 'contact',
          depth: 0,
          path: 'root-1',
          state: 'direct' as const,
          effectiveAccessLevel: 'read' as const,
          sourcePolicyIds: []
        }
      ],
      summary: {
        totalMatchingNodes: 1,
        returnedNodes: 1,
        directCount: 1,
        derivedCount: 0,
        deniedCount: 0,
        includedCount: 1,
        excludedCount: 0
      },
      nextCursor: null
    }));
    const wrapper = createWrapper({
      vfsShareApi: {
        getSharePolicyPreview
      }
    });

    const { result } = renderHook(
      () =>
        useSharePolicyPreview({
          rootItemId: 'root-1',
          principalType: 'user',
          principalId: 'target-1',
          enabled: true,
          limit: 10,
          search: 'wallet'
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.nodes).toHaveLength(1);
    });

    expect(getSharePolicyPreview).toHaveBeenCalledWith({
      rootItemId: 'root-1',
      principalType: 'user',
      principalId: 'target-1',
      limit: 10,
      cursor: null,
      maxDepth: null,
      q: 'wallet',
      objectType: null
    });
    expect(result.current.summary.directCount).toBe(1);
  });

  it('appends additional nodes when loading next page', async () => {
    const getSharePolicyPreview = vi
      .fn()
      .mockResolvedValueOnce({
        nodes: [
          {
            itemId: 'root-1',
            objectType: 'contact',
            depth: 0,
            path: 'root-1',
            state: 'direct' as const,
            effectiveAccessLevel: 'read' as const,
            sourcePolicyIds: []
          }
        ],
        summary: {
          totalMatchingNodes: 2,
          returnedNodes: 1,
          directCount: 1,
          derivedCount: 0,
          deniedCount: 0,
          includedCount: 1,
          excludedCount: 0
        },
        nextCursor: 'root-1'
      })
      .mockResolvedValueOnce({
        nodes: [
          {
            itemId: 'root-1/wallet-1',
            objectType: 'file',
            depth: 1,
            path: 'root-1/wallet-1',
            state: 'derived' as const,
            effectiveAccessLevel: 'write' as const,
            sourcePolicyIds: ['policy-1']
          }
        ],
        summary: {
          totalMatchingNodes: 2,
          returnedNodes: 1,
          directCount: 0,
          derivedCount: 1,
          deniedCount: 0,
          includedCount: 1,
          excludedCount: 0
        },
        nextCursor: null
      });
    const wrapper = createWrapper({
      vfsShareApi: {
        getSharePolicyPreview
      }
    });

    const { result } = renderHook(
      () =>
        useSharePolicyPreview({
          rootItemId: 'root-1',
          principalType: 'user',
          principalId: 'target-1',
          enabled: true
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.nodes).toHaveLength(1);
      expect(result.current.hasMore).toBe(true);
    });

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.nodes).toHaveLength(2);
    expect(result.current.nodes[1]?.itemId).toBe('root-1/wallet-1');
    expect(getSharePolicyPreview).toHaveBeenNthCalledWith(2, {
      rootItemId: 'root-1',
      principalType: 'user',
      principalId: 'target-1',
      limit: 100,
      cursor: 'root-1',
      maxDepth: null,
      q: null,
      objectType: null
    });
  });

  it('ignores stale responses after principal changes', async () => {
    const first = createDeferred<VfsSharePolicyPreviewResponse>();
    const second = createDeferred<VfsSharePolicyPreviewResponse>();

    const getSharePolicyPreview = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const wrapper = createWrapper({
      vfsShareApi: {
        getSharePolicyPreview
      }
    });

    const { result, rerender } = renderHook(
      ({ principalId }: { principalId: string }) =>
        useSharePolicyPreview({
          rootItemId: 'root-1',
          principalType: 'user',
          principalId,
          enabled: true
        }),
      {
        wrapper,
        initialProps: { principalId: 'target-1' }
      }
    );

    await waitFor(() => {
      expect(getSharePolicyPreview).toHaveBeenCalledTimes(1);
    });

    rerender({ principalId: 'target-2' });

    await waitFor(() => {
      expect(getSharePolicyPreview).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      second.resolve({
        nodes: [
          {
            itemId: 'root-2',
            objectType: 'contact',
            depth: 0,
            path: 'root-2',
            state: 'direct',
            effectiveAccessLevel: 'read',
            sourcePolicyIds: []
          }
        ],
        summary: {
          totalMatchingNodes: 1,
          returnedNodes: 1,
          directCount: 1,
          derivedCount: 0,
          deniedCount: 0,
          includedCount: 1,
          excludedCount: 0
        },
        nextCursor: null
      });
      await second.promise;
    });

    await waitFor(() => {
      expect(result.current.nodes).toHaveLength(1);
      expect(result.current.nodes[0]?.itemId).toBe('root-2');
    });

    await act(async () => {
      first.resolve({
        nodes: [
          {
            itemId: 'root-1',
            objectType: 'contact',
            depth: 0,
            path: 'root-1',
            state: 'direct',
            effectiveAccessLevel: 'read',
            sourcePolicyIds: []
          }
        ],
        summary: {
          totalMatchingNodes: 1,
          returnedNodes: 1,
          directCount: 1,
          derivedCount: 0,
          deniedCount: 0,
          includedCount: 1,
          excludedCount: 0
        },
        nextCursor: null
      });
      await first.promise;
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.nodes[0]?.itemId).toBe('root-2');
  });

  it('walks a deep paginated tree deterministically', async () => {
    const getSharePolicyPreview = vi
      .fn()
      .mockResolvedValueOnce({
        nodes: [
          {
            itemId: 'root-1',
            objectType: 'contact',
            depth: 0,
            path: 'root-1',
            state: 'direct' as const,
            effectiveAccessLevel: 'read' as const,
            sourcePolicyIds: []
          },
          {
            itemId: 'root-1/folder-1',
            objectType: 'folder',
            depth: 1,
            path: 'root-1/folder-1',
            state: 'derived' as const,
            effectiveAccessLevel: 'read' as const,
            sourcePolicyIds: ['policy-1']
          }
        ],
        summary: {
          totalMatchingNodes: 5,
          returnedNodes: 2,
          directCount: 1,
          derivedCount: 1,
          deniedCount: 0,
          includedCount: 2,
          excludedCount: 0
        },
        nextCursor: 'root-1/folder-1'
      })
      .mockResolvedValueOnce({
        nodes: [
          {
            itemId: 'root-1/folder-1/wallet-1',
            objectType: 'file',
            depth: 2,
            path: 'root-1/folder-1/wallet-1',
            state: 'derived' as const,
            effectiveAccessLevel: 'write' as const,
            sourcePolicyIds: ['policy-1']
          },
          {
            itemId: 'root-1/folder-1/workout-1',
            objectType: 'note',
            depth: 2,
            path: 'root-1/folder-1/workout-1',
            state: 'excluded' as const,
            effectiveAccessLevel: null,
            sourcePolicyIds: []
          }
        ],
        summary: {
          totalMatchingNodes: 5,
          returnedNodes: 2,
          directCount: 0,
          derivedCount: 1,
          deniedCount: 0,
          includedCount: 1,
          excludedCount: 1
        },
        nextCursor: 'root-1/folder-1/workout-1'
      })
      .mockResolvedValueOnce({
        nodes: [
          {
            itemId: 'root-1/folder-1/workout-1/stats-1',
            objectType: 'audio',
            depth: 3,
            path: 'root-1/folder-1/workout-1/stats-1',
            state: 'excluded' as const,
            effectiveAccessLevel: null,
            sourcePolicyIds: []
          }
        ],
        summary: {
          totalMatchingNodes: 5,
          returnedNodes: 1,
          directCount: 0,
          derivedCount: 0,
          deniedCount: 0,
          includedCount: 0,
          excludedCount: 1
        },
        nextCursor: null
      });
    const wrapper = createWrapper({
      vfsShareApi: {
        getSharePolicyPreview
      }
    });

    const { result } = renderHook(
      () =>
        useSharePolicyPreview({
          rootItemId: 'root-1',
          principalType: 'user',
          principalId: 'target-1',
          enabled: true,
          limit: 2
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.nodes).toHaveLength(2);
      expect(result.current.hasMore).toBe(true);
    });

    await act(async () => {
      await result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.nodes).toHaveLength(4);
      expect(result.current.hasMore).toBe(true);
    });

    await act(async () => {
      await result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.nodes).toHaveLength(5);
      expect(result.current.hasMore).toBe(false);
    });

    expect(result.current.nodes.map((node) => node.path)).toEqual([
      'root-1',
      'root-1/folder-1',
      'root-1/folder-1/wallet-1',
      'root-1/folder-1/workout-1',
      'root-1/folder-1/workout-1/stats-1'
    ]);
    expect(getSharePolicyPreview).toHaveBeenNthCalledWith(2, {
      rootItemId: 'root-1',
      principalType: 'user',
      principalId: 'target-1',
      limit: 2,
      cursor: 'root-1/folder-1',
      maxDepth: null,
      q: null,
      objectType: null
    });
    expect(getSharePolicyPreview).toHaveBeenNthCalledWith(3, {
      rootItemId: 'root-1',
      principalType: 'user',
      principalId: 'target-1',
      limit: 2,
      cursor: 'root-1/folder-1/workout-1',
      maxDepth: null,
      q: null,
      objectType: null
    });
  });
});
