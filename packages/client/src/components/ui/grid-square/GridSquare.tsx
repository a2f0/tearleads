import { cn } from '@/lib/utils';

export interface GridSquareProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  selected?: boolean;
  'data-testid'?: string;
}

export function GridSquare({
  children,
  className,
  onClick,
  selected = false,
  'data-testid': testId
}: GridSquareProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-pressed={selected}
      className={cn(
        'relative overflow-hidden rounded-lg bg-muted transition-all',
        'ring-1 ring-border',
        'hover:ring-2 hover:ring-primary',
        selected && 'ring-2 ring-primary',
        className
      )}
      style={{ aspectRatio: '1 / 1' }}
    >
      {children}
    </button>
  );
}
