import { WindowStatusBar } from '@tearleads/window-manager';
import { Search } from 'lucide-react';
import type { FormEvent, KeyboardEvent, MouseEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Input } from '@/components/ui/input';
import type { HelpDocId } from '@/constants/help';
import { useWindowManagerActions } from '@/contexts/WindowManagerContext';
import { useDatabaseContext } from '@/db/hooks/useDatabaseContext';
import { useIsMobile } from '@/hooks/device';
import { type FileOpenTarget, resolveFileOpenTarget } from '@/lib/vfsOpen';
import type { SearchableEntityType, SearchResult } from '@/search';
import { useSearch } from '@/search';
import { getSearchableAppById } from '@/search/appCatalog';
import {
  getSearchableHelpDocById,
  HELP_DOC_ID_PREFIX
} from '@/search/helpCatalog';
import type { SearchViewMode } from './SearchWindowMenuBar';
import { SearchWindowResults } from './SearchWindowResults';

const ENTITY_TYPE_ROUTES: Record<SearchableEntityType, (id: string) => string> =
  {
    app: (_id) => '/',
    help_doc: (_id) => '/help',
    contact: (id) => `/contacts/${id}`,
    note: (id) => `/notes/${id}`,
    email: (id) => `/emails/${id}`,
    file: (_id) => `/files`,
    playlist: (id) => `/audio?playlist=${id}`,
    album: (id) => `/audio?album=${id}`,
    ai_conversation: (id) => `/ai?conversation=${id}`
  };

const FILTER_OPTION_KEYS: {
  labelKey: string;
  value: SearchableEntityType | 'all';
}[] = [
  { labelKey: 'all', value: 'all' },
  { labelKey: 'apps', value: 'app' },
  { labelKey: 'helpDocs', value: 'help_doc' },
  { labelKey: 'contacts', value: 'contact' },
  { labelKey: 'notes', value: 'note' },
  { labelKey: 'emails', value: 'email' },
  { labelKey: 'files', value: 'file' },
  { labelKey: 'playlists', value: 'playlist' },
  { labelKey: 'aiChats', value: 'ai_conversation' }
];

interface SearchWindowContentProps {
  viewMode?: SearchViewMode;
  autoFocusOnMount?: boolean;
}

export function SearchWindowContent({
  viewMode = 'list',
  autoFocusOnMount = true
}: SearchWindowContentProps) {
  const { t } = useTranslation('search');
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { openWindow, requestWindowOpen } = useWindowManagerActions();
  const { isUnlocked, isLoading: isDatabaseLoading } = useDatabaseContext();

  const filterOptions = useMemo(
    () =>
      FILTER_OPTION_KEYS.map((option) => ({
        label: t(option.labelKey as keyof typeof t),
        value: option.value
      })),
    [t]
  );
  const [query, setQuery] = useState('');
  const [selectedFilters, setSelectedFilters] = useState<
    SearchableEntityType[]
  >([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchDurationMs, setSearchDurationMs] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsContainerRef = useRef<HTMLDivElement>(null);
  const searchGenerationRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchOptions =
    selectedFilters.length === 0
      ? { limit: 50 }
      : { entityTypes: selectedFilters, limit: 50 };
  const { search, isInitialized, isIndexing, documentCount } =
    useSearch(searchOptions);

  const isAllSelected = selectedFilters.length === 0;

  const resetSearch = useCallback(() => {
    searchGenerationRef.current += 1;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    setQuery('');
    setSelectedFilters([]);
    setResults([]);
    setTotalCount(0);
    setIsSearching(false);
    setHasSearched(false);
    setSearchDurationMs(null);
    setSelectedIndex(-1);
  }, []);

  const handleFilterToggle = (value: SearchableEntityType | 'all') => {
    if (value === 'all') {
      setSelectedFilters([]);
      return;
    }

    setSelectedFilters((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    );
  };

  // Keep keyboard flow in search input when opening or changing view mode.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus input when the view mode prop changes.
  useEffect(() => {
    if (!autoFocusOnMount) {
      return;
    }
    inputRef.current?.focus();
  }, [autoFocusOnMount, viewMode]);

  // Search function
  const performSearch = useCallback(
    async (searchQuery: string) => {
      const normalizedQuery = searchQuery.trim();
      const generation = ++searchGenerationRef.current;

      setIsSearching(true);
      const startTime = performance.now();
      try {
        const response = await search(normalizedQuery);
        if (generation !== searchGenerationRef.current) {
          return;
        }
        setSelectedIndex(-1);
        setResults(response.hits);
        setTotalCount(response.count);
      } catch (err) {
        if (generation !== searchGenerationRef.current) {
          return;
        }
        console.error('Search failed:', err);
        setSelectedIndex(-1);
        setResults([]);
        setTotalCount(0);
      } finally {
        if (generation === searchGenerationRef.current) {
          const elapsedMs = Math.max(
            0,
            Math.round(performance.now() - startTime)
          );
          setSearchDurationMs(elapsedMs);
          setHasSearched(true);
          setIsSearching(false);
        }
      }
    },
    [search]
  );

  // Typeahead: search as user types (only for non-empty queries)
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length > 0) {
      debounceTimerRef.current = setTimeout(() => {
        void performSearch(query);
      }, 300);
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query, performSearch]);

  const handleSearchSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      void performSearch(query);
    },
    [performSearch, query]
  );

  const handleResultClick = useCallback(
    async (result: SearchResult, event?: MouseEvent<HTMLElement>) => {
      event?.stopPropagation();

      if (result.entityType === 'app') {
        const app = getSearchableAppById(result.id);
        if (!app) {
          return;
        }

        if (isMobile) {
          navigate(app.path);
          return;
        }

        openWindow(app.windowType);
        return;
      }

      if (result.entityType === 'file') {
        const fileTarget = await resolveFileOpenTarget(result.id);

        if (isMobile) {
          const fileMobileRouteMap: Partial<Record<FileOpenTarget, string>> = {
            audio: `/audio/${result.id}`,
            photo: `/photos/${result.id}`,
            video: `/videos/${result.id}`,
            document: `/documents/${result.id}`
          };
          navigate(fileMobileRouteMap[fileTarget] ?? '/files');
          return;
        }

        switch (fileTarget) {
          case 'audio':
            openWindow('audio');
            requestWindowOpen('audio', { audioId: result.id });
            return;
          case 'photo':
            openWindow('photos');
            requestWindowOpen('photos', { photoId: result.id });
            return;
          case 'video':
            openWindow('videos');
            requestWindowOpen('videos', { videoId: result.id });
            return;
          case 'document':
            openWindow('documents');
            requestWindowOpen('documents', { documentId: result.id });
            return;
          default:
            openWindow('files');
            requestWindowOpen('files', { fileId: result.id });
            return;
        }
      }

      if (result.entityType === 'help_doc') {
        const helpDoc = getSearchableHelpDocById(result.id);
        if (isMobile) {
          navigate(helpDoc?.path ?? '/help');
          return;
        }

        if (helpDoc) {
          const helpDocId = result.id.replace(
            HELP_DOC_ID_PREFIX,
            ''
          ) as HelpDocId;
          openWindow('help');
          requestWindowOpen('help', { helpDocId });
        } else {
          navigate('/help');
        }
        return;
      }

      const route = ENTITY_TYPE_ROUTES[result.entityType](result.id);
      if (isMobile) {
        navigate(route);
        return;
      }

      switch (result.entityType) {
        case 'contact':
          openWindow('contacts');
          requestWindowOpen('contacts', { contactId: result.id });
          return;
        case 'note':
          openWindow('notes');
          requestWindowOpen('notes', { noteId: result.id });
          return;
        case 'email':
          openWindow('email');
          requestWindowOpen('email', { emailId: result.id });
          return;
        case 'playlist':
          openWindow('audio');
          requestWindowOpen('audio', { playlistId: result.id });
          return;
        case 'album':
          openWindow('audio');
          requestWindowOpen('audio', { albumId: result.id });
          return;
        case 'ai_conversation':
          openWindow('ai');
          requestWindowOpen('ai', { conversationId: result.id });
          return;
        default:
          navigate(route);
      }
    },
    [isMobile, navigate, openWindow, requestWindowOpen]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        resetSearch();
        return;
      }

      if (results.length === 0) return;

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setSelectedIndex((prev) => {
            const next = prev < results.length - 1 ? prev + 1 : prev;
            // Scroll selected item into view
            requestAnimationFrame(() => {
              const container = resultsContainerRef.current;
              const selectedElement = container?.querySelector(
                `[data-result-index="${next}"]`
              );
              if (selectedElement && 'scrollIntoView' in selectedElement) {
                selectedElement.scrollIntoView({ block: 'nearest' });
              }
            });
            return next;
          });
          break;
        case 'ArrowUp':
          event.preventDefault();
          setSelectedIndex((prev) => {
            const next = prev > 0 ? prev - 1 : prev;
            // Scroll selected item into view
            requestAnimationFrame(() => {
              const container = resultsContainerRef.current;
              const selectedElement = container?.querySelector(
                `[data-result-index="${next}"]`
              );
              if (selectedElement && 'scrollIntoView' in selectedElement) {
                selectedElement.scrollIntoView({ block: 'nearest' });
              }
            });
            return next;
          });
          break;
        case 'Enter': {
          const selectedResult = results[selectedIndex];
          if (selectedIndex >= 0 && selectedResult) {
            event.preventDefault();
            void handleResultClick(selectedResult);
          }
          break;
        }
      }
    },
    [results, selectedIndex, handleResultClick, resetSearch]
  );

  if (!isDatabaseLoading && !isUnlocked) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center p-8">
        <InlineUnlock description="search" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Search input */}
      <div className="border-b p-3 [border-color:var(--soft-border)]">
        <form onSubmit={handleSearchSubmit}>
          <div className="relative">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              type="text"
              placeholder={t('searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="pl-9"
            />
          </div>
        </form>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 overflow-x-auto border-b px-3 py-2 [border-color:var(--soft-border)]">
        {filterOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => handleFilterToggle(option.value)}
            data-selected={
              option.value === 'all'
                ? isAllSelected
                : selectedFilters.includes(option.value)
            }
            className={`shrink-0 rounded-full px-3 py-1 text-sm transition-colors ${
              (
                option.value === 'all'
                  ? isAllSelected
                  : selectedFilters.includes(option.value)
              )
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <SearchWindowResults
          documentCount={documentCount}
          hasSearched={hasSearched}
          isIndexing={isIndexing}
          isInitialized={isInitialized}
          isSearching={isSearching}
          query={query}
          results={results}
          resultsContainerRef={resultsContainerRef}
          selectedIndex={selectedIndex}
          t={t}
          totalCount={totalCount}
          viewMode={viewMode}
          onResultClick={handleResultClick}
        />
      </div>

      <WindowStatusBar>
        {!isInitialized
          ? t('initializingSearch')
          : isIndexing
            ? t('buildingSearchIndex')
            : isSearching
              ? t('searching')
              : searchDurationMs === null
                ? documentCount === 1
                  ? t('itemIndexed', { count: documentCount })
                  : t('itemsIndexed', { count: documentCount })
                : t('searchTook', { ms: searchDurationMs })}
      </WindowStatusBar>
    </div>
  );
}
