/**
 * SearchStore - Core search functionality wrapping Orama.
 * Provides encrypted, persistent full-text search with incremental updates.
 */

import {
  count,
  create,
  insert,
  insertMultiple,
  load,
  type Orama,
  type Result,
  remove,
  type SearchParams,
  save,
  search,
  type TypedDocument
} from '@orama/orama';
import {
  deleteSearchIndexFromStorage,
  isSearchIndexStorageSupported,
  loadSearchIndexFromStorage,
  saveSearchIndexToStorage
} from './searchIndexStorage';
import type {
  SearchableDocument,
  SearchOptions,
  SearchResponse,
  SearchResult,
  SearchStoreState
} from './types';

/** Debounce time for persisting index to OPFS */
const PERSIST_DEBOUNCE_MS = 5000;

/** Orama schema for searchable documents */
const INDEX_SCHEMA = {
  id: 'string',
  entityType: 'string',
  title: 'string',
  content: 'string',
  metadata: 'string',
  createdAt: 'number',
  updatedAt: 'number'
} as const;

type OramaSchema = typeof INDEX_SCHEMA;
type OramaDocument = TypedDocument<Orama<OramaSchema>>;

/**
 * SearchStore manages the full-text search index for a database instance.
 * Follows the singleton-per-instance pattern.
 */
export class SearchStore {
  private db: Orama<OramaSchema> | null = null;
  private instanceId: string | null = null;
  private encryptionKey: Uint8Array | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners: Set<() => void> = new Set();
  private isDirty = false;

  private state: SearchStoreState = {
    isInitialized: false,
    isIndexing: false,
    documentCount: 0,
    lastPersistedAt: null,
    error: null
  };

  /**
   * Initialize the search store with encryption key and instance ID.
   * Loads existing index from OPFS if available.
   */
  async initialize(
    encryptionKey: Uint8Array,
    instanceId: string
  ): Promise<void> {
    if (this.state.isInitialized && this.instanceId === instanceId) {
      return;
    }

    this.instanceId = instanceId;
    this.encryptionKey = encryptionKey;

    try {
      if (isSearchIndexStorageSupported()) {
        const stored = await loadSearchIndexFromStorage(
          instanceId,
          encryptionKey
        );

        if (stored) {
          // Create an empty instance first, then load data into it
          this.db = await create({ schema: INDEX_SCHEMA });
          load(this.db, JSON.parse(stored.data));
          const docCount = await count(this.db);
          this.updateState({
            isInitialized: true,
            documentCount: docCount,
            lastPersistedAt: stored.updatedAt,
            error: null
          });
          return;
        }
      }

      // No stored index or storage not supported - create new
      await this.createEmptyIndex();
    } catch (err) {
      console.warn('Failed to load search index, creating new:', err);
      await this.createEmptyIndex();
    }
  }

  /**
   * Create a new empty Orama index.
   */
  private async createEmptyIndex(): Promise<void> {
    this.db = await create({
      schema: INDEX_SCHEMA
    });
    this.updateState({
      isInitialized: true,
      documentCount: 0,
      error: null
    });
  }

  /**
   * Upsert a document in the index.
   * Called by Context Providers when entities are created/updated.
   */
  async upsert(doc: SearchableDocument): Promise<void> {
    if (!this.db) {
      throw new Error('Search store not initialized');
    }

    // Remove existing document if present (Orama doesn't have native upsert)
    try {
      await remove(this.db, doc.id);
    } catch {
      // Document didn't exist, that's fine
    }

    const oramaDoc: OramaDocument = {
      id: doc.id,
      entityType: doc.entityType,
      title: doc.title,
      content: doc.content ?? '',
      metadata: doc.metadata ?? '',
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    };

    await insert(this.db, oramaDoc);
    const docCount = await count(this.db);
    this.updateState({ documentCount: docCount });
    this.isDirty = true;
    this.schedulePersist();
  }

  /**
   * Upsert multiple documents in batch.
   * More efficient for bulk operations using insertMultiple.
   */
  async upsertBatch(docs: SearchableDocument[]): Promise<void> {
    if (!this.db) {
      throw new Error('Search store not initialized');
    }

    const db = this.db;

    // Parallelize remove operations
    await Promise.all(
      docs.map((doc) =>
        Promise.resolve(remove(db, doc.id)).catch(() => {
          /* ignore */
        })
      )
    );

    // Convert to Orama documents
    const oramaDocs: OramaDocument[] = docs.map((doc) => ({
      id: doc.id,
      entityType: doc.entityType,
      title: doc.title,
      content: doc.content ?? '',
      metadata: doc.metadata ?? '',
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    }));

    // Batch insert
    if (oramaDocs.length > 0) {
      await insertMultiple(this.db, oramaDocs);
    }

    const docCount = await count(this.db);
    this.updateState({ documentCount: docCount });
    this.isDirty = true;
    this.schedulePersist();
  }

  /**
   * Remove a document from the index.
   * Called by Context Providers when entities are deleted.
   */
  async removeDocument(id: string): Promise<void> {
    if (!this.db) {
      throw new Error('Search store not initialized');
    }

    try {
      await remove(this.db, id);
      const docCount = await count(this.db);
      this.updateState({ documentCount: docCount });
      this.isDirty = true;
      this.schedulePersist();
    } catch {
      // Document not found, ignore
    }
  }

  /**
   * Search the index.
   * Returns both hits and total count for accurate pagination/display.
   */
  async search(
    query: string,
    options?: SearchOptions
  ): Promise<SearchResponse> {
    if (!this.db || !query.trim()) {
      return { hits: [], count: 0 };
    }

    const searchParams: SearchParams<Orama<OramaSchema>> = {
      term: query,
      limit: options?.limit ?? 50,
      offset: options?.offset ?? 0,
      properties: ['title', 'content', 'metadata']
    };

    if (options?.entityTypes?.length) {
      searchParams.where = {
        entityType: options.entityTypes
      };
    }

    const results = await search(this.db, searchParams);

    const hits = results.hits.map(
      (hit: Result<OramaDocument>): SearchResult => {
        const doc: SearchableDocument = {
          id: hit.document.id,
          entityType: hit.document
            .entityType as SearchableDocument['entityType'],
          title: hit.document.title,
          createdAt: hit.document.createdAt,
          updatedAt: hit.document.updatedAt
        };

        if (hit.document.content) {
          doc.content = hit.document.content;
        }
        if (hit.document.metadata) {
          doc.metadata = hit.document.metadata;
        }

        return {
          id: hit.document.id,
          entityType: hit.document
            .entityType as SearchableDocument['entityType'],
          score: hit.score,
          document: doc
        };
      }
    );

    return { hits, count: results.count };
  }

  /**
   * Rebuild the entire index from scratch.
   * Used for first-time build or recovery from corruption.
   */
  async rebuildFromDatabase(
    fetchAllDocuments: () => Promise<SearchableDocument[]>
  ): Promise<void> {
    this.updateState({ isIndexing: true, error: null });

    try {
      await this.createEmptyIndex();
      const docs = await fetchAllDocuments();

      const db = this.db;
      if (!db) {
        throw new Error('Database not initialized');
      }

      for (const doc of docs) {
        const oramaDoc: OramaDocument = {
          id: doc.id,
          entityType: doc.entityType,
          title: doc.title,
          content: doc.content ?? '',
          metadata: doc.metadata ?? '',
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt
        };
        await insert(db, oramaDoc);
      }

      this.updateState({
        isIndexing: false,
        documentCount: docs.length
      });

      this.isDirty = true;
      await this.persist();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.updateState({
        isIndexing: false,
        error
      });
      throw err;
    }
  }

  /**
   * Force persist the index to OPFS immediately.
   */
  async persist(): Promise<void> {
    if (!this.db || !this.instanceId || !this.encryptionKey) {
      return;
    }

    if (!this.isDirty) {
      return;
    }

    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    if (!isSearchIndexStorageSupported()) {
      return;
    }

    try {
      const serialized = JSON.stringify(await save(this.db));
      const docCount = await count(this.db);

      await saveSearchIndexToStorage(
        this.instanceId,
        serialized,
        docCount,
        this.encryptionKey
      );

      this.isDirty = false;
      this.updateState({ lastPersistedAt: Date.now() });
    } catch (err) {
      console.error('Failed to persist search index:', err);
    }
  }

  /**
   * Schedule a debounced persist operation.
   */
  private schedulePersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }

    this.persistTimer = setTimeout(() => {
      this.persist().catch((err) => {
        console.error('Failed to persist search index:', err);
      });
    }, PERSIST_DEBOUNCE_MS);
  }

  /**
   * Close the store and persist any pending changes.
   */
  async close(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    if (this.db && this.isDirty) {
      await this.persist();
    }

    this.db = null;
    this.encryptionKey = null;
    this.instanceId = null;
    this.isDirty = false;
    this.updateState({
      isInitialized: false,
      documentCount: 0,
      lastPersistedAt: null
    });
  }

  /**
   * Delete all stored index data for an instance.
   */
  async deleteStorageForInstance(instanceId: string): Promise<void> {
    await deleteSearchIndexFromStorage(instanceId);
  }

  // --- Subscription API (follows existing store patterns) ---

  /**
   * Subscribe to state changes.
   * Returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Get current state snapshot.
   */
  getState(): SearchStoreState {
    return { ...this.state };
  }

  private updateState(partial: Partial<SearchStoreState>): void {
    this.state = { ...this.state, ...partial };
    this.notifyListeners();
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

// --- Singleton instances per database instance ---

const searchStoreInstances = new Map<string, SearchStore>();

/**
 * Get the SearchStore instance for a database instance.
 * Creates a new store if one doesn't exist.
 */
export function getSearchStoreForInstance(instanceId: string): SearchStore {
  let store = searchStoreInstances.get(instanceId);
  if (!store) {
    store = new SearchStore();
    searchStoreInstances.set(instanceId, store);
  }
  return store;
}

/**
 * Close and remove the SearchStore for an instance.
 */
export async function closeSearchStoreForInstance(
  instanceId: string
): Promise<void> {
  const store = searchStoreInstances.get(instanceId);
  if (store) {
    await store.close();
    searchStoreInstances.delete(instanceId);
  }
}

/**
 * Delete the search index storage for an instance.
 */
export async function deleteSearchIndexForInstance(
  instanceId: string
): Promise<void> {
  const store = searchStoreInstances.get(instanceId);
  if (store) {
    await store.close();
    await store.deleteStorageForInstance(instanceId);
    searchStoreInstances.delete(instanceId);
  } else {
    await deleteSearchIndexFromStorage(instanceId);
  }
}
