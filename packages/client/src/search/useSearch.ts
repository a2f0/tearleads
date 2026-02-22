/**
 * React hook for consuming the search store.
 * Provides search functionality with state tracking.
 */

import {
  getSearchStoreForInstance,
  type SearchableEntityType,
  type SearchOptions,
  type SearchResponse,
  type SearchStoreState
} from '@tearleads/search';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useDatabaseContext } from '@/db/hooks/useDatabase';

interface UseSearchOptions {
  /** Filter results to specific entity types */
  entityTypes?: SearchableEntityType[];
  /** Maximum number of results per search (default: 50) */
  limit?: number;
}

interface UseSearchReturn {
  /** Execute a search query, returns hits and total count */
  search: (query: string, offset?: number) => Promise<SearchResponse>;
  /** Whether the search store is initialized */
  isInitialized: boolean;
  /** Whether a full index rebuild is in progress */
  isIndexing: boolean;
  /** Number of documents in the index */
  documentCount: number;
  /** Timestamp of last successful persistence */
  lastPersistedAt: number | null;
  /** Last error that occurred */
  error: Error | null;
}

const defaultState: SearchStoreState = {
  isInitialized: false,
  isIndexing: false,
  documentCount: 0,
  lastPersistedAt: null,
  error: null
};

/**
 * Hook to search the indexed documents.
 * Automatically uses the current database instance's search store.
 */
export function useSearch(options?: UseSearchOptions): UseSearchReturn {
  const { currentInstanceId } = useDatabaseContext();

  // Get or create the search store for this instance
  const store = useMemo(() => {
    if (!currentInstanceId) return null;
    return getSearchStoreForInstance(currentInstanceId);
  }, [currentInstanceId]);

  // Subscribe to store state changes
  const state = useSyncExternalStore(
    useCallback(
      (onStoreChange) => {
        if (!store) return () => {};
        return store.subscribe(onStoreChange);
      },
      [store]
    ),
    useCallback(() => {
      if (!store) return defaultState;
      return store.getState();
    }, [store]),
    // Server snapshot (same as client for this use case)
    useCallback(() => defaultState, [])
  );

  // Search function with options baked in
  const search = useCallback(
    async (query: string, offset = 0): Promise<SearchResponse> => {
      if (!store) return { hits: [], count: 0 };

      const searchOptions: SearchOptions = {
        limit: options?.limit ?? 50,
        offset
      };

      if (options?.entityTypes) {
        searchOptions.entityTypes = options.entityTypes;
      }

      return store.search(query, searchOptions);
    },
    [store, options?.entityTypes, options?.limit]
  );

  return {
    search,
    isInitialized: state.isInitialized,
    isIndexing: state.isIndexing,
    documentCount: state.documentCount,
    lastPersistedAt: state.lastPersistedAt,
    error: state.error
  };
}
