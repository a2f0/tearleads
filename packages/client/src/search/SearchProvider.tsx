/**
 * SearchProvider - Initializes and manages the search index lifecycle.
 * Handles initialization on unlock and cleanup on lock/instance switch.
 */

import { contacts, files, notes } from '@rapid/db/sqlite';
import { eq } from 'drizzle-orm';
import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef
} from 'react';
import { getDatabase } from '@/db';
import { getKeyManagerForInstance } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks/useDatabase';
import { useOnInstanceChange } from '@/hooks/useInstanceChange';
import {
  createContactDocument,
  createFileDocument,
  createNoteDocument
} from './integration';
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
 * Fetch all searchable documents from the database.
 * Queries contacts, notes, and files that are not deleted.
 */
async function fetchAllDocuments(): Promise<SearchableDocument[]> {
  const db = getDatabase();
  const docs: SearchableDocument[] = [];

  // Fetch all non-deleted contacts
  const contactRows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.deleted, false));

  for (const contact of contactRows) {
    docs.push(
      createContactDocument(
        contact.id,
        contact.firstName,
        contact.lastName,
        null, // email - would need join with contactEmails
        null, // phone - would need join with contactPhones
        contact.createdAt.getTime(),
        contact.updatedAt.getTime()
      )
    );
  }

  // Fetch all non-deleted notes
  const noteRows = await db
    .select()
    .from(notes)
    .where(eq(notes.deleted, false));

  for (const note of noteRows) {
    docs.push(
      createNoteDocument(
        note.id,
        note.title,
        note.content,
        note.createdAt.getTime(),
        note.updatedAt.getTime()
      )
    );
  }

  // Fetch all non-deleted files
  const fileRows = await db
    .select()
    .from(files)
    .where(eq(files.deleted, false));

  for (const file of fileRows) {
    docs.push(
      createFileDocument(
        file.id,
        file.name,
        file.mimeType,
        file.uploadDate.getTime(),
        file.uploadDate.getTime()
      )
    );
  }

  return docs;
}

/**
 * Provider that manages search index lifecycle.
 * Must be placed inside DatabaseProvider.
 */
export function SearchProvider({ children }: SearchProviderProps) {
  const { currentInstanceId, isUnlocked } = useDatabaseContext();
  const hasRebuiltRef = useRef(false);

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
          // Auto-rebuild when index is empty (first time setup)
          if (
            state.documentCount === 0 &&
            state.isInitialized &&
            !hasRebuiltRef.current
          ) {
            hasRebuiltRef.current = true;
            console.info(
              'Search: Empty index detected, starting initial rebuild...'
            );
            try {
              await store.rebuildFromDatabase(fetchAllDocuments);
              console.info('Search: Initial rebuild complete');
            } catch (rebuildErr) {
              console.error('Search: Initial rebuild failed:', rebuildErr);
            }
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

  // Close search store when instance changes and reset rebuild flag
  useOnInstanceChange(
    useCallback(
      async (newInstanceId: string | null, prevInstanceId: string | null) => {
        if (prevInstanceId && prevInstanceId !== newInstanceId) {
          hasRebuiltRef.current = false;
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
