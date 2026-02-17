import {
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import {
  AppWindow,
  BookText,
  Contact,
  File,
  Loader2,
  Mail,
  MessageSquare,
  Music,
  Search,
  StickyNote
} from 'lucide-react';
import type { TFunction } from 'i18next';
import type { ComponentType, MouseEvent, RefObject } from 'react';
import type { SearchableEntityType, SearchResult } from '@/search';
import type { SearchViewMode } from './SearchWindowMenuBar';

const ENTITY_TYPE_LABEL_KEYS: Record<SearchableEntityType, string> = {
  app: 'app',
  help_doc: 'helpDoc',
  contact: 'contact',
  note: 'note',
  email: 'email',
  file: 'file',
  playlist: 'playlist',
  album: 'album',
  ai_conversation: 'aiConversation'
};

const ENTITY_TYPE_ICONS: Record<
  SearchableEntityType,
  ComponentType<{ className?: string }>
> = {
  app: AppWindow,
  help_doc: BookText,
  contact: Contact,
  note: StickyNote,
  email: Mail,
  file: File,
  playlist: Music,
  album: Music,
  ai_conversation: MessageSquare
};

function getPreviewText(result: SearchResult): string | null {
  if (result.entityType === 'app') {
    return null;
  }

  return (
    result.document.content?.slice(0, 100) ??
    result.document.metadata?.slice(0, 100) ??
    null
  );
}

interface SearchWindowResultsProps {
  documentCount: number;
  hasSearched: boolean;
  isIndexing: boolean;
  isInitialized: boolean;
  isSearching: boolean;
  query: string;
  results: SearchResult[];
  resultsContainerRef: RefObject<HTMLDivElement | null>;
  selectedIndex: number;
  t: TFunction<'search'>;
  totalCount: number;
  viewMode: SearchViewMode;
  onResultClick: (
    result: SearchResult,
    event?: MouseEvent<HTMLElement>
  ) => Promise<void>;
}

export function SearchWindowResults({
  documentCount,
  hasSearched,
  isIndexing,
  isInitialized,
  isSearching,
  query,
  results,
  resultsContainerRef,
  selectedIndex,
  t,
  totalCount,
  viewMode,
  onResultClick
}: SearchWindowResultsProps) {
  if (!isInitialized) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t('initializingSearch')}
      </div>
    );
  }

  if (isIndexing) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t('buildingSearchIndex')}
      </div>
    );
  }

  if (documentCount === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <Search className="h-12 w-12" />
        <p>{t('searchIndexEmpty')}</p>
        <p className="text-sm">{t('addSomeContent')}</p>
      </div>
    );
  }

  if (isSearching) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t('searching')}
      </div>
    );
  }

  if (!hasSearched) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <Search className="h-12 w-12" />
        <p>{t('startTypingToSearch')}</p>
        <p className="text-sm">{t('pressEnterToList')}</p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <Search className="h-12 w-12" />
        <p>{query.trim() ? t('noResultsFoundFor', { query }) : t('noResultsFound')}</p>
      </div>
    );
  }

  return (
    <div
      ref={resultsContainerRef}
      className="divide-y [--tw-divide-opacity:1] divide-[var(--soft-border)]"
    >
      <div className="px-3 py-2 text-muted-foreground text-xs">
        {totalCount === results.length
          ? totalCount === 1
            ? t('result', { count: totalCount })
            : t('results', { count: totalCount })
          : t('showingResults', {
              shown: results.length,
              total: totalCount
            })}
      </div>
      {viewMode === 'table' ? (
        <div className="overflow-x-auto">
          <table className={WINDOW_TABLE_TYPOGRAPHY.table}>
            <thead className={WINDOW_TABLE_TYPOGRAPHY.header}>
              <tr>
                <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>{t('title')}</th>
                <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>{t('type')}</th>
                <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                  {t('preview')}
                </th>
              </tr>
            </thead>
            <tbody>
              {results.map((result, index) => (
                <WindowTableRow
                  key={result.id}
                  data-result-index={index}
                  isSelected={selectedIndex === index}
                  onClick={(event) => {
                    void onResultClick(result, event);
                  }}
                >
                  <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                    {result.document.title}
                  </td>
                  <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                    {t(
                      ENTITY_TYPE_LABEL_KEYS[result.entityType] as keyof typeof t
                    )}
                  </td>
                  <td
                    className={`max-w-[300px] truncate ${WINDOW_TABLE_TYPOGRAPHY.mutedCell}`}
                  >
                    {result.entityType === 'app'
                      ? null
                      : (getPreviewText(result) ?? '—')}
                  </td>
                </WindowTableRow>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        results.map((result, index) => {
          const Icon = ENTITY_TYPE_ICONS[result.entityType];
          return (
            <button
              key={result.id}
              type="button"
              data-result-index={index}
              onClick={(event) => {
                void onResultClick(result, event);
              }}
              className={`flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-muted/50 ${
                selectedIndex === index ? 'bg-accent' : ''
              }`}
            >
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">
                    {result.document.title}
                  </span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">
                    {t(
                      ENTITY_TYPE_LABEL_KEYS[result.entityType] as keyof typeof t
                    )}
                  </span>
                </div>
                {(() => {
                  const previewText = getPreviewText(result);
                  return previewText ? (
                    <p className="mt-0.5 truncate text-muted-foreground text-sm">
                      {previewText}
                    </p>
                  ) : null;
                })()}
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}
