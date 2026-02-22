import type { ShareTargetSearchResult, VfsShareType } from '@tearleads/shared';
import { useCallback, useState } from 'react';
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

      setLoading(true);
      setError(null);

      try {
        const response = await vfsShareApi.searchTargets(query, type);
        setResults(response.results);
      } catch (err) {
        console.error('Failed to search share targets:', err);
        setError(err instanceof Error ? err.message : String(err));
        setResults([]);
      } finally {
        setLoading(false);
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
