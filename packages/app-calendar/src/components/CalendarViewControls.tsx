import { clsx } from 'clsx';

interface CalendarViewControlsProps<TViewMode extends string> {
  viewModes: readonly TViewMode[];
  viewMode: TViewMode;
  onViewModeChange: (viewMode: TViewMode) => void;
  onPeriodNavigation: (direction: -1 | 1) => void;
}

export function CalendarViewControls<TViewMode extends string>({
  viewModes,
  viewMode,
  onViewModeChange,
  onPeriodNavigation
}: CalendarViewControlsProps<TViewMode>) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="inline-flex items-center rounded-full border bg-muted/30 p-1 [border-color:var(--soft-border)]"
        role="tablist"
        aria-label="Calendar view mode"
      >
        {viewModes.map((mode) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={viewMode === mode}
            onClick={() => onViewModeChange(mode)}
            className={clsx(
              'rounded-full px-3 py-1 font-medium text-xs transition-colors',
              viewMode === mode
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {mode}
          </button>
        ))}
      </div>
      <div className="inline-flex items-center rounded-full border bg-muted/30 p-1 [border-color:var(--soft-border)]">
        <button
          type="button"
          aria-label="Go to previous period"
          onClick={() => onPeriodNavigation(-1)}
          className="rounded-full px-2 py-1 font-medium text-muted-foreground/60 text-xs transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {'<'}
        </button>
        <button
          type="button"
          aria-label="Go to next period"
          onClick={() => onPeriodNavigation(1)}
          className="rounded-full px-2 py-1 font-medium text-muted-foreground/60 text-xs transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {'>'}
        </button>
      </div>
    </div>
  );
}
