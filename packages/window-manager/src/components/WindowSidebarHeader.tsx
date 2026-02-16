export interface WindowSidebarHeaderProps {
  title: string;
  actionLabel: string;
  onAction: () => void;
  actionIcon: React.ReactNode;
}

export function WindowSidebarHeader({
  title,
  actionLabel,
  onAction,
  actionIcon
}: WindowSidebarHeaderProps) {
  return (
    <div className="flex items-center justify-between border-border/70 border-b px-3 py-2">
      <span className="font-medium text-muted-foreground text-xs">{title}</span>
      <button
        type="button"
        onClick={onAction}
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        title={actionLabel}
      >
        {actionIcon}
      </button>
    </div>
  );
}
