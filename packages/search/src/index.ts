/**
 * Core full-text search exports for Tearleads.
 */

export type { IndexableEntity } from './integration';
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
export {
  closeSearchStoreForInstance,
  deleteSearchIndexForInstance,
  getSearchStoreForInstance,
  SearchStore
} from './SearchStore';
export {
  deleteSearchIndexFromStorage,
  getSearchIndexStorageSize,
  INDEX_VERSION,
  isSearchIndexStorageSupported,
  loadSearchIndexFromStorage,
  saveSearchIndexToStorage
} from './searchIndexStorage';
export type {
  SearchableDocument,
  SearchableEntityType,
  SearchOptions,
  SearchResponse,
  SearchResult,
  SearchStoreState,
  StoredSearchIndex
} from './types';
