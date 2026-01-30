interface VfsStatusBarProps {
  itemCount: number;
  selectedItemName?: string | null;
}

export function VfsStatusBar({
  itemCount,
  selectedItemName
}: VfsStatusBarProps) {
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
