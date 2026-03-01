import { cn } from '@tearleads/ui';

export interface WindowSidebarItemProps {
  label: string;
  icon: React.ReactNode;
  selected: boolean;
  onClick: () => void;
  count?: number | string | undefined;
  className?: string | undefined;
  onContextMenu?: ((event: React.MouseEvent) => void) | undefined;
  onDragOver?: ((event: React.DragEvent) => void) | undefined;
  onDragEnter?: ((event: React.DragEvent) => void) | undefined;
  onDragLeave?: ((event: React.DragEvent) => void) | undefined;
  onDrop?: ((event: React.DragEvent) => void) | undefined;
  leadingSpacer?: boolean | undefined;
}

export function WindowSidebarItem({
  label,
  icon,
  selected,
  onClick,
  count,
  className,
  onContextMenu,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  leadingSpacer = false
}: WindowSidebarItemProps) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm transition-colors',
        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
        className
      )}
      style={{ paddingLeft: '8px' }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {leadingSpacer ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center" />
      ) : null}
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined ? (
        <span className="text-muted-foreground text-xs">{count}</span>
      ) : null}
    </button>
  );
}
