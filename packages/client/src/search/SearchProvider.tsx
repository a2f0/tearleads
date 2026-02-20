/**
 * SearchProvider - Initializes and manages the search index lifecycle.
 * Handles initialization on unlock and cleanup on lock/instance switch.
 */

import {
  contactEmails,
  contactPhones,
  contacts,
  files,
  notes
} from '@tearleads/db/sqlite';
import type { SearchableDocument } from '@tearleads/search';
import {
  closeSearchStoreForInstance,
  createContactDocument,
  createFileDocument,
  createNoteDocument,
  getSearchStoreForInstance
} from '@tearleads/search';
import { eq, inArray } from 'drizzle-orm';
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
import { useOnInstanceChange } from '@/hooks/app';
import { createSearchableAppDocuments } from './appCatalog';
import { createSearchableHelpDocuments } from './helpCatalog';

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

function runAfterUiPaint(callback: () => void): () => void {
  if (typeof window === 'undefined') {
    callback();
    return () => {};
  }

  let animationFrame1: number | null = null;
  let animationFrame2: number | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  animationFrame1 = window.requestAnimationFrame(() => {
    animationFrame2 = window.requestAnimationFrame(() => {
      timeoutId = setTimeout(callback, 0);
    });
  });

  return () => {
    if (animationFrame1 !== null) {
      window.cancelAnimationFrame(animationFrame1);
    }
    if (animationFrame2 !== null) {
      window.cancelAnimationFrame(animationFrame2);
    }
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  };
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

  const contactIds = contactRows.map((c) => c.id);

  // Fetch emails and phones for all contacts in parallel
  const [emailRows, phoneRows] =
    contactIds.length > 0
      ? await Promise.all([
          db
            .select()
            .from(contactEmails)
            .where(inArray(contactEmails.contactId, contactIds)),
          db
            .select()
            .from(contactPhones)
            .where(inArray(contactPhones.contactId, contactIds))
        ])
      : [[], []];

  // Group emails by contact ID
  const emailsByContact = emailRows.reduce<Record<string, string[]>>(
    (acc, row) => {
      const existing = acc[row.contactId] ?? [];
      existing.push(row.email);
      acc[row.contactId] = existing;
      return acc;
    },
    {}
  );

  // Group phones by contact ID
  const phonesByContact = phoneRows.reduce<Record<string, string[]>>(
    (acc, row) => {
      const existing = acc[row.contactId] ?? [];
      existing.push(row.phoneNumber);
      acc[row.contactId] = existing;
      return acc;
    },
    {}
  );

  for (const contact of contactRows) {
    docs.push(
      createContactDocument(
        contact.id,
        contact.firstName,
        contact.lastName,
        emailsByContact[contact.id]?.join(' ') ?? null,
        phonesByContact[contact.id]?.join(' ') ?? null,
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
    let cancelDeferredAppIndex: (() => void) | null = null;

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

          cancelDeferredAppIndex = runAfterUiPaint(() => {
            if (!mounted) {
              return;
            }
            const catalogDocuments = [
              ...createSearchableAppDocuments(),
              ...createSearchableHelpDocuments()
            ];
            void store.upsertBatch(catalogDocuments).catch((appIndexErr) => {
              console.error(
                'Search: Failed to index app/help catalog:',
                appIndexErr
              );
            });
          });
        }
      } catch (err) {
        console.error('Search: Failed to initialize store:', err);
      }
    }

    initializeSearch();

    return () => {
      mounted = false;
      if (cancelDeferredAppIndex) {
        cancelDeferredAppIndex();
      }
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
