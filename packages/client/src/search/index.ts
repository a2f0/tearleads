/**
 * Full-text search module exports.
 * Provides encrypted, persistent search with Orama and OPFS.
 */

export type { IndexableEntity } from './integration';
// Integration helpers
export {
  createAIConversationDocument,
  createAlbumDocument,
  createContactDocument,
  createDocumentFromEntity,
  createEmailDocument,
  createFileDocument,
  createNoteDocument,
  createPlaylistDocument,
  indexDocument,
  indexDocuments,
  indexEntity,
  removeFromIndex
} from './integration';
// Provider
export { SearchProvider, useSearchContext } from './SearchProvider';
// Store
export {
  closeSearchStoreForInstance,
  deleteSearchIndexForInstance,
  getSearchStoreForInstance,
  SearchStore
} from './SearchStore';
// Storage
export {
  deleteSearchIndexFromStorage,
  getSearchIndexStorageSize,
  INDEX_VERSION,
  isSearchIndexStorageSupported,
  loadSearchIndexFromStorage,
  saveSearchIndexToStorage
} from './searchIndexStorage';
// Types
export type {
  SearchableDocument,
  SearchableEntityType,
  SearchOptions,
  SearchResponse,
  SearchResult,
  SearchStoreState,
  StoredSearchIndex
} from './types';
// React hooks
export { useSearch, useSearchState } from './useSearch';
