import { CREATE_CLASSIC_TAG_ARIA_LABEL } from '../../lib/constants';

interface TagSidebarEmptyStateProps {
  canCreateTag: boolean;
  onCreateTag?: (() => void | Promise<void>) | undefined;
}

export function TagSidebarEmptyState({
  canCreateTag,
  onCreateTag
}: TagSidebarEmptyStateProps) {
  if (!canCreateTag) {
    return (
      <button
        type="button"
        disabled
        className="w-full border border-border border-dashed bg-card px-2 py-0.5"
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="flex items-center gap-2">
          <span className="w-4 shrink-0 text-center text-muted-foreground/50 text-xs">
            ⋮⋮
          </span>
          <div className="min-w-0 flex-1 px-1.5 py-0.5">
            <span className="block h-4 rounded bg-muted" />
          </div>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void onCreateTag?.()}
      onContextMenu={(event) => event.preventDefault()}
      className="w-full border border-border border-dashed bg-card px-2 py-0.5 text-left hover:border-foreground/30 hover:bg-accent"
      aria-label={CREATE_CLASSIC_TAG_ARIA_LABEL}
    >
      <div className="flex items-center gap-2">
        <span className="w-4 shrink-0 text-center text-muted-foreground/50 text-xs">
          ⋮⋮
        </span>
        <div className="min-w-0 flex-1 px-1.5 py-0.5">
          <span className="block h-4 rounded bg-muted" />
        </div>
      </div>
    </button>
  );
}
