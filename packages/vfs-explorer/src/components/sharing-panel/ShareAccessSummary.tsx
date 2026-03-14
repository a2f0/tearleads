import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { VfsObjectType, VfsShareType } from '@tearleads/shared';
import { useSharePolicyPreview } from '../../hooks/useSharePolicyPreview.js';
import { ShareAccessSummaryFilters } from './ShareAccessSummaryFilters.js';
import { ShareAccessSummaryResults } from './ShareAccessSummaryResults.js';

interface ShareAccessSummaryProps {
  itemId: string;
  shareType: VfsShareType;
  selectedTargetId: string | null;
  selectedTargetName: string;
}

export function ShareAccessSummary({
  itemId,
  shareType,
  selectedTargetId,
  selectedTargetName
}: ShareAccessSummaryProps) {
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const [maxDepth, setMaxDepth] = useState<number | null>(null);
  const [selectedObjectTypes, setSelectedObjectTypes] = useState<
    VfsObjectType[]
  >([]);

  const objectTypeFilter =
    selectedObjectTypes.length > 0 ? selectedObjectTypes : null;

  const preview = useSharePolicyPreview({
    rootItemId: itemId,
    principalType: shareType,
    principalId: selectedTargetId ?? '',
    limit: 50,
    q: search,
    maxDepth,
    objectType: objectTypeFilter,
    enabled: selectedTargetId !== null && expanded
  });

  if (!selectedTargetId) return null;

  const accessibleCount = preview.summary
    ? preview.summary.directCount +
      preview.summary.derivedCount +
      preview.summary.includedCount
    : 0;
  const noAccessCount = preview.summary
    ? preview.summary.deniedCount + preview.summary.excludedCount
    : 0;

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
          preview.summary &&
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

          <ShareAccessSummaryFilters
            search={search}
            onSearchChange={setSearch}
            loading={preview.loading}
            onRefetch={() => void preview.refetch()}
            maxDepth={maxDepth}
            onMaxDepthChange={setMaxDepth}
            selectedObjectTypes={selectedObjectTypes}
            onToggleObjectType={toggleObjectTypeFilter}
            onClearFilters={clearAllFilters}
          />

          <ShareAccessSummaryResults
            nodes={preview.nodes}
            loading={preview.loading}
            error={preview.error ? preview.error.message : null}
            hasMore={preview.hasMore}
            onLoadMore={() => void preview.loadMore()}
          />
        </div>
      )}
    </div>
  );
}
