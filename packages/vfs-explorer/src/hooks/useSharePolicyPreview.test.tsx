import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWrapper } from '../test/testUtils';
import { useSharePolicyPreview } from './useSharePolicyPreview';

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
            objectType: 'walletItem',
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
});
