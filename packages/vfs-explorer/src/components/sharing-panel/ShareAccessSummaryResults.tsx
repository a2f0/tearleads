import type { VfsSharePolicyPreviewNode } from '@tearleads/shared';
import { Loader2 } from 'lucide-react';
import { useVfsExplorerContext } from '../../context';
import { cn } from '../../lib';
import { FRIENDLY_STATE_COLORS, FRIENDLY_STATE_LABELS } from './types';

interface ShareAccessSummaryResultsProps {
  nodes: VfsSharePolicyPreviewNode[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
}

export function ShareAccessSummaryResults({
  nodes,
  loading,
  error,
  hasMore,
  onLoadMore
}: ShareAccessSummaryResultsProps) {
  const {
    ui: { Button }
  } = useVfsExplorerContext();

  return (
    <>
      {error && <div className="text-destructive text-xs">{error}</div>}

      <div className="max-h-48 space-y-1 overflow-y-auto rounded border p-1">
        {nodes.length === 0 && !loading && (
          <div className="px-2 py-1 text-muted-foreground text-xs">
            No items in preview scope.
          </div>
        )}
        {loading && nodes.length === 0 && (
          <div className="flex items-center justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {nodes.map((node) => (
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

      {hasMore && (
        <Button
          className="w-full"
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={onLoadMore}
        >
          Load More
        </Button>
      )}
    </>
  );
}
