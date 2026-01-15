import {
  ChevronDown,
  ChevronRight,
  FileIcon,
  FolderIcon,
  FolderOpen
} from 'lucide-react';
import { formatFileSize } from '@/lib/utils';
import { CacheDeleteButton } from './CacheDeleteButton';

export interface CacheEntry {
  url: string;
  size: number;
}

export interface CacheInfo {
  name: string;
  entries: CacheEntry[];
  totalSize: number;
}

function getDisplayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Show just the pathname and search params
    // CSS truncate class handles overflow responsively
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

interface CacheTreeNodeProps {
  cache: CacheInfo;
  isExpanded: boolean;
  onToggle: () => void;
  onDeleteCache: (name: string) => void;
  onDeleteEntry: (cacheName: string, url: string) => void;
}

export function CacheTreeNode({
  cache,
  isExpanded,
  onToggle,
  onDeleteCache,
  onDeleteEntry
}: CacheTreeNodeProps) {
  const hasEntries = cache.entries.length > 0;

  return (
    <div>
      <div className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-accent">
        <button
          type="button"
          className="flex flex-1 cursor-pointer items-center gap-2 text-left"
          onClick={onToggle}
          aria-expanded={hasEntries ? isExpanded : undefined}
        >
          {hasEntries ? (
            isExpanded ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )
          ) : (
            <span className="w-4" />
          )}
          {isExpanded ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-info" />
          ) : (
            <FolderIcon className="h-4 w-4 shrink-0 text-info" />
          )}
          <span className="truncate font-medium text-sm">{cache.name}</span>
          <span className="ml-auto shrink-0 text-muted-foreground text-xs">
            {cache.entries.length} items ({formatFileSize(cache.totalSize)})
          </span>
        </button>
        <CacheDeleteButton
          onClick={() => onDeleteCache(cache.name)}
          title="Delete cache"
        />
      </div>
      {isExpanded && hasEntries && (
        <div>
          {cache.entries.map((entry) => (
            <div
              key={entry.url}
              className="group flex items-center gap-2 rounded py-1 pr-2 pl-10 hover:bg-accent"
              title={entry.url}
            >
              <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono text-xs">
                {getDisplayUrl(entry.url)}
              </span>
              <span className="ml-auto shrink-0 text-muted-foreground text-xs">
                {formatFileSize(entry.size)}
              </span>
              <CacheDeleteButton
                onClick={() => onDeleteEntry(cache.name, entry.url)}
                title="Delete entry"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
