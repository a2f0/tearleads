import type { ShareTargetSearchResult, VfsShareType } from '@tearleads/shared';
import { useCallback, useRef, useState } from 'react';
import { useVfsExplorerContext } from '../context';

interface UseShareTargetSearchResult {
  results: ShareTargetSearchResult[];
  loading: boolean;
  error: string | null;
  search: (query: string, type?: VfsShareType) => Promise<void>;
  clear: () => void;
}

export function useShareTargetSearch(): UseShareTargetSearchResult {
  const { vfsShareApi } = useVfsExplorerContext();
  const [results, setResults] = useState<ShareTargetSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRequestIdRef = useRef(0);

  const search = useCallback(
    async (query: string, type?: VfsShareType): Promise<void> => {
      if (!vfsShareApi) {
        setError('Share API not available');
        return;
      }

      if (!query.trim()) {
        setResults([]);
        return;
      }

      const requestId = latestRequestIdRef.current + 1;
      latestRequestIdRef.current = requestId;
      setLoading(true);
      setError(null);

      try {
        const response = await vfsShareApi.searchTargets(query, type);
        if (requestId !== latestRequestIdRef.current) return;
        setResults(response.results);
      } catch (err) {
        if (requestId !== latestRequestIdRef.current) return;
        console.error('Failed to search share targets:', err);
        setError(err instanceof Error ? err.message : String(err));
        setResults([]);
      } finally {
        if (requestId === latestRequestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [vfsShareApi]
  );

  const clear = useCallback(() => {
    setResults([]);
    setError(null);
  }, []);

  return {
    results,
    loading,
    error,
    search,
    clear
  };
}
