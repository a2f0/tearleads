interface VfsStatusBarProps {
  itemCount: number;
  selectedItemName?: string | null;
  /** Transient message to display (e.g., paste error) */
  message?: { text: string; type: 'error' | 'info' } | null;
}

export function VfsStatusBar({
  itemCount,
  selectedItemName,
  message
}: VfsStatusBarProps) {
  if (message) {
    return (
      <div
        className={`flex h-6 shrink-0 items-center border-t px-3 text-xs ${
          message.type === 'error'
            ? 'bg-destructive/10 text-destructive'
            : 'bg-muted/30 text-muted-foreground'
        }`}
      >
        <span className="truncate">{message.text}</span>
      </div>
    );
  }

  return (
    <div className="flex h-6 shrink-0 items-center border-t bg-muted/30 px-3 text-muted-foreground text-xs">
      {selectedItemName ? (
        <span className="truncate">{selectedItemName}</span>
      ) : (
        <span>
          {itemCount} item{itemCount !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}
