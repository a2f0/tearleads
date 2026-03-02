import {
  VFS_OBJECT_TYPES,
  type VfsObjectType,
  type VfsShareType
} from '@tearleads/shared';
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCcw,
  X
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useVfsExplorerContext } from '../../context';
import { useSharePolicyPreview } from '../../hooks';
import { cn } from '../../lib';
import { FRIENDLY_STATE_COLORS, FRIENDLY_STATE_LABELS } from './types';

interface ShareAccessSummaryProps {
  itemId: string;
  shareType: VfsShareType;
  selectedTargetId: string | null;
  selectedTargetName: string;
}

const MAX_DEPTH_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: 'All depths', value: null },
  { label: 'Root only', value: 0 },
  { label: '1 level', value: 1 },
  { label: '2 levels', value: 2 },
  { label: '3 levels', value: 3 },
  { label: '5 levels', value: 5 },
  { label: '10 levels', value: 10 }
];

const OBJECT_TYPE_LABELS: Record<VfsObjectType, string> = {
  file: 'File',
  photo: 'Photo',
  audio: 'Audio',
  video: 'Video',
  contact: 'Contact',
  note: 'Note',
  email: 'Email',
  mlsMessage: 'MLS Message',
  conversation: 'Conversation',
  folder: 'Folder',
  emailFolder: 'Email Folder',
  playlist: 'Playlist',
  album: 'Album',
  contactGroup: 'Contact Group',
  tag: 'Tag'
};

export function ShareAccessSummary({
  itemId,
  shareType,
  selectedTargetId,
  selectedTargetName
}: ShareAccessSummaryProps) {
  const {
    ui: { Button, Input }
  } = useVfsExplorerContext();
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const [maxDepth, setMaxDepth] = useState<number | null>(null);
  const [selectedObjectTypes, setSelectedObjectTypes] = useState<
    VfsObjectType[]
  >([]);
  const previousTargetIdRef = useRef<string | null>(selectedTargetId);

  useEffect(() => {
    if (previousTargetIdRef.current === selectedTargetId) {
      return;
    }
    previousTargetIdRef.current = selectedTargetId;
    setSearch('');
    setMaxDepth(null);
    setSelectedObjectTypes([]);
  }, [selectedTargetId]);

  const hasActiveFilters = maxDepth !== null || selectedObjectTypes.length > 0;
  const objectTypeFilter =
    selectedObjectTypes.length > 0 ? selectedObjectTypes : null;

  const preview = useSharePolicyPreview({
    rootItemId: itemId,
    principalType: shareType,
    principalId: selectedTargetId,
    limit: 50,
    search,
    maxDepth,
    objectType: objectTypeFilter,
    enabled: selectedTargetId !== null && expanded
  });

  if (!selectedTargetId) return null;

  const accessibleCount =
    preview.summary.directCount +
    preview.summary.derivedCount +
    preview.summary.includedCount;
  const noAccessCount =
    preview.summary.deniedCount + preview.summary.excludedCount;

  const toggleObjectTypeFilter = (objectType: VfsObjectType) => {
    setSelectedObjectTypes((previous) =>
      previous.includes(objectType)
        ? previous.filter((value) => value !== objectType)
        : [...previous, objectType]
    );
  };

  const clearAllFilters = () => {
    setSearch('');
    setMaxDepth(null);
    setSelectedObjectTypes([]);
  };

  return (
    <div
      className="border-b [border-color:var(--soft-border)]"
      data-testid="share-access-summary"
    >
      <button
        type="button"
        className="flex w-full items-center gap-1 px-3 py-2 text-left text-muted-foreground text-xs hover:bg-accent/30"
        onClick={() => setExpanded((prev) => !prev)}
        data-testid="access-details-toggle"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <span className="font-medium">Access details</span>
        {expanded &&
          preview.summary.totalMatchingNodes > 0 &&
          !preview.loading && (
            <span className="ml-auto text-[11px]">
              {preview.summary.totalMatchingNodes} items &mdash;{' '}
              {accessibleCount} accessible, {noAccessCount} no access
            </span>
          )}
      </button>

      {expanded && (
        <div className="space-y-2 px-3 pb-3">
          <div className="rounded border bg-muted/20 px-2 py-1.5 text-xs">
            Previewing access for{' '}
            <span className="font-medium">{selectedTargetName}</span>
          </div>

          <div className="flex items-center gap-2">
            <Input
              type="text"
              placeholder="Search items..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 text-base"
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={preview.loading}
              onClick={() => void preview.refetch()}
            >
              {preview.loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCcw className="h-3 w-3" />
              )}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground text-xs">
              Max depth
              <select
                value={maxDepth === null ? 'all' : String(maxDepth)}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setMaxDepth(
                    nextValue === 'all' ? null : Number.parseInt(nextValue, 10)
                  );
                }}
                className="h-8 min-w-0 flex-1 rounded border bg-background px-2 text-base"
                data-testid="access-depth-filter"
              >
                {MAX_DEPTH_OPTIONS.map((option) => (
                  <option
                    key={option.label}
                    value={option.value === null ? 'all' : String(option.value)}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {hasActiveFilters && (
              <Button
                size="sm"
                variant="ghost"
                onClick={clearAllFilters}
                data-testid="access-filter-clear"
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-muted-foreground text-xs">Object types</div>
            <div className="flex gap-1 overflow-x-auto pb-1">
              {VFS_OBJECT_TYPES.map((objectType) => {
                const selected = selectedObjectTypes.includes(objectType);
                return (
                  <button
                    key={objectType}
                    type="button"
                    aria-pressed={selected}
                    className={cn(
                      'shrink-0 rounded border px-2 py-1 text-xs',
                      selected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-background hover:bg-accent/30'
                    )}
                    onClick={() => toggleObjectTypeFilter(objectType)}
                    data-testid={`access-object-type-${objectType}`}
                  >
                    {OBJECT_TYPE_LABELS[objectType]}
                  </button>
                );
              })}
            </div>
          </div>

          {preview.error && (
            <div className="text-destructive text-xs">{preview.error}</div>
          )}

          <div className="max-h-48 space-y-1 overflow-y-auto rounded border p-1">
            {preview.nodes.length === 0 && !preview.loading && (
              <div className="px-2 py-1 text-muted-foreground text-xs">
                No items in preview scope.
              </div>
            )}
            {preview.loading && preview.nodes.length === 0 && (
              <div className="flex items-center justify-center py-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {preview.nodes.map((node) => (
              <div
                key={node.path}
                className="rounded border bg-muted/10 px-2 py-1 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate">{node.path}</div>
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 font-medium',
                      FRIENDLY_STATE_COLORS[node.state]
                    )}
                  >
                    {FRIENDLY_STATE_LABELS[node.state] ?? node.state}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {preview.hasMore && (
            <Button
              className="w-full"
              size="sm"
              variant="outline"
              disabled={preview.loading}
              onClick={() => void preview.loadMore()}
            >
              Load More
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
