/**
 * Full-text search module exports.
 * Provides encrypted, persistent search with Orama and OPFS.
 */

export * from '@tearleads/search';
export {
  createSearchableAppDocuments,
  getSearchableAppById,
  toAppSearchId
} from './appCatalog';
export {
  createSearchableHelpDocuments,
  getSearchableHelpDocById,
  HELP_DOC_ID_PREFIX
} from './helpCatalog';
export { SearchProvider, useSearchContext } from './SearchProvider';
export { useSearch, useSearchState } from './useSearch';
