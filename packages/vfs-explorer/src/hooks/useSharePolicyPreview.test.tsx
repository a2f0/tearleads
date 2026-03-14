import type {
  VfsSharePolicyPreviewRequest,
  VfsSharePolicyPreviewResponse
} from '@tearleads/shared';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSharePolicyPreview } from './useSharePolicyPreview.js';

const { mockGetSharePolicyPreview } = vi.hoisted(() => ({
  mockGetSharePolicyPreview:
    vi.fn<
      (
        request: VfsSharePolicyPreviewRequest
      ) => Promise<VfsSharePolicyPreviewResponse>
    >()
}));

vi.mock('../context', () => ({
  useVfsExplorerContext: () => ({
    vfsShareApi: {
      getSharePolicyPreview: mockGetSharePolicyPreview
    }
  })
}));

beforeEach(() => {
  mockGetSharePolicyPreview.mockReset();
});

describe('useSharePolicyPreview', () => {
  it('fetches and returns preview data', async () => {
    const mockResponse: VfsSharePolicyPreviewResponse = {
      nodes: [
        {
          itemId: 'item-1',
          objectType: 'file',
          depth: 0,
          path: 'item-1',
          state: 'included',
          effectiveAccessLevel: 'read',
          sourcePolicyIds: ['policy-1']
        }
      ],
      summary: {
        totalMatchingNodes: 1,
        returnedNodes: 1,
        directCount: 1,
        derivedCount: 0,
        deniedCount: 0,
        includedCount: 0,
        excludedCount: 0
      },
      nextCursor: null
    };

    mockGetSharePolicyPreview.mockResolvedValue(mockResponse);

    const { result } = renderHook(() =>
      useSharePolicyPreview({
        rootItemId: 'root-1',
        principalType: 'user',
        principalId: 'target-1',
        enabled: true
      })
    );

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.summary?.directCount).toBe(1);
    expect(mockGetSharePolicyPreview).toHaveBeenCalledWith({
      rootItemId: 'root-1',
      principalType: 'user',
      principalId: 'target-1',
      limit: 20,
      cursor: null,
      maxDepth: null,
      q: null,
      objectType: null
    });
  });
});
