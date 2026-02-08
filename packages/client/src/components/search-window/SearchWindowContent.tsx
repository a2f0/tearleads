import {
  Contact,
  File,
  Loader2,
  Mail,
  MessageSquare,
  Music,
  Search,
  StickyNote
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import type { SearchableEntityType, SearchResult } from '@/search';
import { useSearch } from '@/search';

const ENTITY_TYPE_LABELS: Record<SearchableEntityType, string> = {
  contact: 'Contact',
  note: 'Note',
  email: 'Email',
  file: 'File',
  playlist: 'Playlist',
  album: 'Album',
  ai_conversation: 'AI Chat'
};

const ENTITY_TYPE_ICONS: Record<
  SearchableEntityType,
  React.ComponentType<{ className?: string }>
> = {
  contact: Contact,
  note: StickyNote,
  email: Mail,
  file: File,
  playlist: Music,
  album: Music,
  ai_conversation: MessageSquare
};

const ENTITY_TYPE_ROUTES: Record<SearchableEntityType, (id: string) => string> =
  {
    contact: (id) => `/contacts/${id}`,
    note: (id) => `/notes/${id}`,
    email: (id) => `/emails/${id}`,
    file: (id) => `/documents/${id}`,
    playlist: (id) => `/audio?playlist=${id}`,
    album: (id) => `/audio?album=${id}`,
    ai_conversation: (id) => `/ai?conversation=${id}`
  };

const FILTER_OPTIONS: { label: string; value: SearchableEntityType | 'all' }[] =
  [
    { label: 'All', value: 'all' },
    { label: 'Contacts', value: 'contact' },
    { label: 'Notes', value: 'note' },
    { label: 'Emails', value: 'email' },
    { label: 'Files', value: 'file' },
    { label: 'Playlists', value: 'playlist' },
    { label: 'AI Chats', value: 'ai_conversation' }
  ];

export function SearchWindowContent() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedFilters, setSelectedFilters] = useState<
    SearchableEntityType[]
  >([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [searchDurationMs, setSearchDurationMs] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  const searchOptions =
    selectedFilters.length === 0
      ? { limit: 50 }
      : { entityTypes: selectedFilters, limit: 50 };
  const { search, isInitialized, isIndexing, documentCount } =
    useSearch(searchOptions);

  const isAllSelected = selectedFilters.length === 0;

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

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search
  const performSearch = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setResults([]);
        setTotalCount(0);
        setSearchDurationMs(null);
        return;
      }

      setIsSearching(true);
      const startTime = performance.now();
      try {
        const response = await search(searchQuery);
        setResults(response.hits);
        setTotalCount(response.count);
      } catch (err) {
        console.error('Search failed:', err);
        setResults([]);
        setTotalCount(0);
      } finally {
        const elapsedMs = Math.max(
          0,
          Math.round(performance.now() - startTime)
        );
        setSearchDurationMs(elapsedMs);
        setIsSearching(false);
      }
    },
    [search]
  );

  // Handle query changes with debounce
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      performSearch(query);
    }, 200);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, performSearch]);

  const handleResultClick = (result: SearchResult) => {
    const route = ENTITY_TYPE_ROUTES[result.entityType](result.id);
    navigate(route);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Search input */}
      <div className="border-b p-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="text"
            placeholder="Search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 overflow-x-auto border-b px-3 py-2">
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
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

      {/* Results area */}
      <div className="flex-1 overflow-auto">
        {!isInitialized ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Initializing search...
          </div>
        ) : isIndexing ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Building search index...
          </div>
        ) : documentCount === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
            <Search className="h-12 w-12" />
            <p>Search index is empty</p>
            <p className="text-sm">
              Add some contacts, notes, or emails to get started
            </p>
          </div>
        ) : !query.trim() ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
            <Search className="h-12 w-12" />
            <p>Enter a search term to find your data</p>
            <p className="text-sm">{documentCount} items indexed</p>
          </div>
        ) : isSearching ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Searching...
          </div>
        ) : results.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
            <Search className="h-12 w-12" />
            <p>No results found for "{query}"</p>
          </div>
        ) : (
          <div className="divide-y">
            <div className="px-3 py-2 text-muted-foreground text-xs">
              {totalCount === results.length
                ? `${totalCount} result${totalCount === 1 ? '' : 's'}`
                : `Showing ${results.length} of ${totalCount} results`}
            </div>
            {results.map((result) => {
              const Icon = ENTITY_TYPE_ICONS[result.entityType];
              return (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => handleResultClick(result)}
                  className="flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-muted/50"
                >
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {result.document.title}
                      </span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">
                        {ENTITY_TYPE_LABELS[result.entityType]}
                      </span>
                    </div>
                    {(result.document.content || result.document.metadata) && (
                      <p className="mt-0.5 truncate text-muted-foreground text-sm">
                        {result.document.content?.slice(0, 100) ||
                          result.document.metadata?.slice(0, 100)}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t px-3 py-1 text-muted-foreground text-xs">
        {!isInitialized
          ? 'Initializing search...'
          : isIndexing
            ? 'Building search index...'
            : isSearching
              ? 'Searching...'
              : !query.trim()
                ? `${documentCount} items indexed`
                : searchDurationMs === null
                  ? 'Ready'
                  : `Search took ${searchDurationMs} ms`}
      </div>
    </div>
  );
}
