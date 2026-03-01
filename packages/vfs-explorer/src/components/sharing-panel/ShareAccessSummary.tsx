import type { VfsShareType } from '@tearleads/shared';
import { ChevronDown, ChevronRight, Loader2, RefreshCcw } from 'lucide-react';
import { useState } from 'react';
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

  const preview = useSharePolicyPreview({
    rootItemId: itemId,
    principalType: shareType,
    principalId: selectedTargetId,
    limit: 50,
    search,
    enabled: selectedTargetId !== null && expanded
  });

  if (!selectedTargetId) return null;

  const accessibleCount =
    preview.summary.directCount +
    preview.summary.derivedCount +
    preview.summary.includedCount;
  const noAccessCount =
    preview.summary.deniedCount + preview.summary.excludedCount;

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
