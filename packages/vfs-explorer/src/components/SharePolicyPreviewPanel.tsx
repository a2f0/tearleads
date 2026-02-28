import type { VfsShareType } from '@tearleads/shared';
import { Loader2, RefreshCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useVfsExplorerContext } from '../context';
import { useSharePolicyPreview } from '../hooks';
import { cn } from '../lib';

interface SharePolicyPreviewPanelProps {
  itemId: string;
  shareType: VfsShareType;
  selectedTargetId: string | null;
  selectedTargetName: string;
}

const STATE_BADGE_CLASS: Record<string, string> = {
  direct: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200',
  derived:
    'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200',
  denied: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  included:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  excluded: 'bg-muted text-muted-foreground'
};

function parseMaxDepth(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function parseObjectTypeFilter(value: string): string[] | null {
  const parsed = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(
      (entry, index, array) =>
        entry.length > 0 && array.indexOf(entry) === index
    );
  return parsed.length > 0 ? parsed : null;
}

function stateExplanation(state: string, sourcePolicyIds: string[]): string {
  if (state === 'denied') {
    return 'Denied by policy precedence';
  }
  if (state === 'direct') {
    return 'Direct ACL grant';
  }
  if (state === 'derived') {
    return sourcePolicyIds.length > 0
      ? `Derived from ${sourcePolicyIds.join(', ')}`
      : 'Derived from compiled policy scope';
  }
  if (state === 'included') {
    return 'Included by effective ACL';
  }
  return 'No effective access';
}

export function SharePolicyPreviewPanel({
  itemId,
  shareType,
  selectedTargetId,
  selectedTargetName
}: SharePolicyPreviewPanelProps) {
  const {
    ui: { Button, Input }
  } = useVfsExplorerContext();
  const [search, setSearch] = useState('');
  const [maxDepthRaw, setMaxDepthRaw] = useState('');
  const [objectTypeRaw, setObjectTypeRaw] = useState('');
  const objectTypeFilter = useMemo(
    () => parseObjectTypeFilter(objectTypeRaw),
    [objectTypeRaw]
  );

  const preview = useSharePolicyPreview({
    rootItemId: itemId,
    principalType: shareType,
    principalId: selectedTargetId,
    limit: 50,
    search,
    maxDepth: parseMaxDepth(maxDepthRaw),
    objectType: objectTypeFilter,
    enabled: selectedTargetId !== null
  });

  return (
    <div className="space-y-2 border-b p-3 [border-color:var(--soft-border)]">
      <div className="flex items-center justify-between">
        <div className="font-medium text-muted-foreground text-xs">
          Policy Preview
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={selectedTargetId === null || preview.loading}
          onClick={() => void preview.refetch()}
        >
          {preview.loading ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <RefreshCcw className="mr-1 h-3 w-3" />
          )}
          Refresh
        </Button>
      </div>

      {selectedTargetId === null ? (
        <div className="rounded border bg-muted/20 px-2 py-1.5 text-muted-foreground text-xs">
          Select a share target to preview effective scope.
        </div>
      ) : (
        <>
          <div className="rounded border bg-muted/20 px-2 py-1.5 text-xs">
            Previewing for{' '}
            <span className="font-medium">{selectedTargetName}</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Input
              type="text"
              placeholder="Search nodes"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="text-base"
            />
            <Input
              type="number"
              min={0}
              placeholder="Max depth"
              value={maxDepthRaw}
              onChange={(event) => setMaxDepthRaw(event.target.value)}
              className="text-base"
            />
            <Input
              type="text"
              placeholder="Types (comma-separated)"
              value={objectTypeRaw}
              onChange={(event) => setObjectTypeRaw(event.target.value)}
              className="text-base"
            />
          </div>
          <div className="flex flex-wrap gap-1 text-[11px]">
            <span className="rounded bg-muted px-1.5 py-0.5">
              Total {preview.summary.totalMatchingNodes}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5">
              Direct {preview.summary.directCount}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5">
              Derived {preview.summary.derivedCount}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5">
              Denied {preview.summary.deniedCount}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5">
              Excluded {preview.summary.excludedCount}
            </span>
          </div>
          {preview.error && (
            <div className="text-destructive text-xs">{preview.error}</div>
          )}
          <div className="max-h-48 space-y-1 overflow-y-auto rounded border p-1">
            {preview.nodes.length === 0 && !preview.loading && (
              <div className="px-2 py-1 text-muted-foreground text-xs">
                No nodes in preview scope.
              </div>
            )}
            {preview.nodes.map((node) => (
              <div
                key={node.path}
                className="rounded border bg-muted/10 px-2 py-1 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate">
                    {node.path} ({node.objectType})
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 font-medium',
                      STATE_BADGE_CLASS[node.state]
                    )}
                  >
                    {node.state}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {stateExplanation(node.state, node.sourcePolicyIds)}
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
        </>
      )}
    </div>
  );
}
