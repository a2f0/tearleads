/**
 * Types for the full-text search system.
 */

/**
 * Searchable entity types in the system.
 */
export type SearchableEntityType =
  | 'contact'
  | 'note'
  | 'file'
  | 'email'
  | 'playlist'
  | 'album'
  | 'ai_conversation';

/**
 * A document that can be indexed for search.
 */
export interface SearchableDocument {
  /** Unique identifier (matches entity ID) */
  id: string;
  /** Type of entity this document represents */
  entityType: SearchableEntityType;
  /** Primary searchable field (name, title, subject, etc.) */
  title: string;
  /** Optional body content for full-text search (note body, email body, etc.) */
  content?: string;
  /** JSON stringified additional searchable metadata */
  metadata?: string;
  /** Unix timestamp in milliseconds */
  createdAt: number;
  /** Unix timestamp in milliseconds */
  updatedAt: number;
}

/**
 * A search result with relevance score.
 */
export interface SearchResult {
  id: string;
  entityType: SearchableEntityType;
  score: number;
  document: SearchableDocument;
}

/**
 * Search response with hits and total count.
 */
export interface SearchResponse {
  /** Array of search results */
  hits: SearchResult[];
  /** Total number of matching documents (may be more than hits.length if limited) */
  count: number;
}

/**
 * Options for search queries.
 */
export interface SearchOptions {
  /** Filter to specific entity types */
  entityTypes?: SearchableEntityType[];
  /** Maximum number of results (default: 50) */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * State of the search store.
 */
export interface SearchStoreState {
  /** Whether the store has been initialized with an encryption key */
  isInitialized: boolean;
  /** Whether a full index rebuild is in progress */
  isIndexing: boolean;
  /** Number of documents in the index */
  documentCount: number;
  /** Timestamp of last successful persistence to OPFS */
  lastPersistedAt: number | null;
  /** Last error that occurred */
  error: Error | null;
}

/**
 * Format of the stored index in OPFS.
 */
export interface StoredSearchIndex {
  /** Version number for migrations */
  version: number;
  /** Serialized Orama index data */
  data: string;
  /** Document count at time of save */
  documentCount: number;
  /** When the index was first created */
  createdAt: number;
  /** When the index was last updated */
  updatedAt: number;
}
