import type {
  VfsAclPrincipalType,
  VfsObjectType,
  VfsSharePolicyPreviewNode,
  VfsSharePolicyPreviewRequest,
  VfsSharePolicyPreviewResponse,
  VfsSharePolicyPreviewSummary
} from '@tearleads/shared';
import { useCallback, useEffect, useState } from 'react';
import { useVfsExplorerContext } from '../context';

export interface UseSharePolicyPreviewOptions {
  rootItemId: string;
  principalType: VfsAclPrincipalType;
  principalId: string;
  enabled?: boolean;
  limit?: number;
  maxDepth?: number | null;
  q?: string | null;
  objectType?: VfsObjectType[] | null;
}

export interface UseSharePolicyPreviewResult {
  nodes: VfsSharePolicyPreviewNode[];
  summary: VfsSharePolicyPreviewSummary | null;
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
  // Filters
  maxDepth: number | null;
  setMaxDepth: (depth: number | null) => void;
  q: string;
  setQ: (query: string) => void;
  selectedObjectTypes: VfsObjectType[];
  toggleObjectType: (type: VfsObjectType) => void;
  clearFilters: () => void;
}

export function useSharePolicyPreview(
  options: UseSharePolicyPreviewOptions
): UseSharePolicyPreviewResult {
  const { vfsShareApi } = useVfsExplorerContext();
  const [nodes, setNodes] = useState<VfsSharePolicyPreviewNode[]>([]);
  const [summary, setSummary] = useState<VfsSharePolicyPreviewSummary | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // Filters
  const [maxDepth, setMaxDepth] = useState<number | null>(
    options.maxDepth ?? null
  );
  const [q, setQ] = useState(options.q ?? '');
  const [selectedObjectTypes, setSelectedObjectTypes] = useState<
    VfsObjectType[]
  >(options.objectType ?? []);

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      if (!options.enabled) return;
      if (!vfsShareApi?.getSharePolicyPreview) {
        setError(new Error('VFS share API is unavailable'));
        return;
      }

      setLoading(true);
      try {
        const request: VfsSharePolicyPreviewRequest = {
          rootItemId: options.rootItemId,
          principalType: options.principalType,
          principalId: options.principalId,
          limit: options.limit ?? 20,
          cursor,
          maxDepth,
          q: q.trim() || null,
          objectType:
            selectedObjectTypes.length > 0 ? selectedObjectTypes : null
        };

        const response: VfsSharePolicyPreviewResponse =
          await vfsShareApi.getSharePolicyPreview(request);

        if (cursor) {
          setNodes((prev) => [...prev, ...response.nodes]);
        } else {
          setNodes(response.nodes);
        }
        setSummary(response.summary);
        setNextCursor(response.nextCursor ?? null);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setLoading(false);
      }
    },
    [
      options.enabled,
      options.rootItemId,
      options.principalType,
      options.principalId,
      options.limit,
      maxDepth,
      q,
      selectedObjectTypes,
      vfsShareApi
    ]
  );

  useEffect(() => {
    fetchPage(null);
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (nextCursor && !loading) {
      await fetchPage(nextCursor);
    }
  }, [nextCursor, loading, fetchPage]);

  const refetch = useCallback(async () => {
    await fetchPage(null);
  }, [fetchPage]);

  const toggleObjectType = useCallback((type: VfsObjectType) => {
    setSelectedObjectTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }, []);

  const clearFilters = useCallback(() => {
    setMaxDepth(null);
    setQ('');
    setSelectedObjectTypes([]);
  }, []);

  return {
    nodes,
    summary,
    loading,
    error,
    hasMore: nextCursor !== null,
    loadMore,
    refetch,
    maxDepth,
    setMaxDepth,
    q,
    setQ,
    selectedObjectTypes,
    toggleObjectType,
    clearFilters
  };
}
