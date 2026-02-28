import type {
  VfsSharePolicyPreviewNode,
  VfsSharePolicyPreviewSummary,
  VfsShareType
} from '@tearleads/shared';
import { useCallback, useEffect, useState } from 'react';
import { useVfsExplorerContext } from '../context';

interface UseSharePolicyPreviewOptions {
  rootItemId: string;
  principalType: VfsShareType;
  principalId: string | null;
  limit?: number;
  search?: string;
  maxDepth?: number | null;
  objectType?: string[] | null;
  enabled?: boolean;
}

interface UseSharePolicyPreviewResult {
  nodes: VfsSharePolicyPreviewNode[];
  summary: VfsSharePolicyPreviewSummary;
  nextCursor: string | null;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  loadMore: () => Promise<void>;
}

const EMPTY_SUMMARY: VfsSharePolicyPreviewSummary = {
  totalMatchingNodes: 0,
  returnedNodes: 0,
  directCount: 0,
  derivedCount: 0,
  deniedCount: 0,
  includedCount: 0,
  excludedCount: 0
};

export function useSharePolicyPreview(
  options: UseSharePolicyPreviewOptions
): UseSharePolicyPreviewResult {
  const { vfsShareApi } = useVfsExplorerContext();
  const previewApi = vfsShareApi?.getSharePolicyPreview;
  const [nodes, setNodes] = useState<VfsSharePolicyPreviewNode[]>([]);
  const [summary, setSummary] =
    useState<VfsSharePolicyPreviewSummary>(EMPTY_SUMMARY);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const limit = options.limit ?? 100;
  const search = options.search?.trim() ?? '';

  const fetchPreview = useCallback(
    async (cursor: string | null, append: boolean) => {
      if (!previewApi || !options.principalId || !options.enabled) {
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const response = await previewApi({
          rootItemId: options.rootItemId,
          principalType: options.principalType,
          principalId: options.principalId,
          limit,
          cursor,
          maxDepth: options.maxDepth ?? null,
          q: search.length > 0 ? search : null,
          objectType: options.objectType ?? null
        });
        setNodes((prev) =>
          append ? [...prev, ...response.nodes] : response.nodes
        );
        setSummary(response.summary);
        setNextCursor(response.nextCursor);
      } catch (err) {
        console.error('Failed to fetch share policy preview:', err);
        setError('Failed to load preview');
      } finally {
        setLoading(false);
      }
    },
    [
      previewApi,
      options.principalId,
      options.enabled,
      options.rootItemId,
      options.principalType,
      limit,
      options.maxDepth,
      search,
      options.objectType
    ]
  );

  const refetch = useCallback(async () => {
    setNodes([]);
    setSummary(EMPTY_SUMMARY);
    setNextCursor(null);
    await fetchPreview(null, false);
  }, [fetchPreview]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loading) {
      return;
    }
    await fetchPreview(nextCursor, true);
  }, [nextCursor, loading, fetchPreview]);

  useEffect(() => {
    if (!options.enabled || !options.principalId || !previewApi) {
      setNodes([]);
      setSummary(EMPTY_SUMMARY);
      setNextCursor(null);
      setLoading(false);
      setError(null);
      return;
    }
    void refetch();
  }, [options.enabled, options.principalId, previewApi, refetch]);

  return {
    nodes,
    summary,
    nextCursor,
    hasMore: nextCursor !== null,
    loading,
    error,
    refetch,
    loadMore
  };
}
