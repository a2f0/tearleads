/**
 * SearchProvider - Initializes and manages the search index lifecycle.
 * Handles initialization on unlock and cleanup on lock/instance switch.
 */

import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect } from 'react';
import { getKeyManagerForInstance } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks/useDatabase';
import { useOnInstanceChange } from '@/hooks/useInstanceChange';
import {
  closeSearchStoreForInstance,
  getSearchStoreForInstance
} from './SearchStore';
import type { SearchableDocument } from './types';

interface SearchContextValue {
  /**
   * Trigger a full rebuild of the search index.
   * Should only be needed on first setup or corruption recovery.
   */
  rebuildIndex: (
    fetchAllDocuments: () => Promise<SearchableDocument[]>
  ) => Promise<void>;
}

const SearchContext = createContext<SearchContextValue | null>(null);

interface SearchProviderProps {
  children: ReactNode;
}

/**
 * Provider that manages search index lifecycle.
 * Must be placed inside DatabaseProvider.
 */
export function SearchProvider({ children }: SearchProviderProps) {
  const { currentInstanceId, isUnlocked } = useDatabaseContext();

  // Initialize search store when database is unlocked
  useEffect(() => {
    let mounted = true;

    async function initializeSearch() {
      if (!currentInstanceId || !isUnlocked) {
        return;
      }

      try {
        const keyManager = getKeyManagerForInstance(currentInstanceId);
        const encryptionKey = keyManager.getCurrentKey();

        if (!encryptionKey) {
          console.warn('Search: No encryption key available');
          return;
        }

        const store = getSearchStoreForInstance(currentInstanceId);
        await store.initialize(encryptionKey, currentInstanceId);

        if (mounted) {
          const state = store.getState();
          if (state.documentCount === 0 && state.isInitialized) {
            console.info(
              'Search: Empty index initialized, rebuild recommended'
            );
          }
        }
      } catch (err) {
        console.error('Search: Failed to initialize store:', err);
      }
    }

    initializeSearch();

    return () => {
      mounted = false;
    };
  }, [currentInstanceId, isUnlocked]);

  // Close search store when instance changes
  useOnInstanceChange(
    useCallback(
      async (newInstanceId: string | null, prevInstanceId: string | null) => {
        if (prevInstanceId && prevInstanceId !== newInstanceId) {
          await closeSearchStoreForInstance(prevInstanceId);
        }
      },
      []
    )
  );

  // Close search store when database locks
  useEffect(() => {
    if (!isUnlocked && currentInstanceId) {
      closeSearchStoreForInstance(currentInstanceId).catch((err) => {
        console.error('Search: Failed to close store on lock:', err);
      });
    }
  }, [isUnlocked, currentInstanceId]);

  const rebuildIndex = useCallback(
    async (fetchAllDocuments: () => Promise<SearchableDocument[]>) => {
      if (!currentInstanceId) {
        throw new Error('No active instance');
      }

      const store = getSearchStoreForInstance(currentInstanceId);
      if (!store.getState().isInitialized) {
        throw new Error('Search store not initialized');
      }

      await store.rebuildFromDatabase(fetchAllDocuments);
    },
    [currentInstanceId]
  );

  return (
    <SearchContext.Provider value={{ rebuildIndex }}>
      {children}
    </SearchContext.Provider>
  );
}

/**
 * Hook to access search context (rebuild functionality).
 */
export function useSearchContext(): SearchContextValue {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error('useSearchContext must be used within a SearchProvider');
  }
  return context;
}
