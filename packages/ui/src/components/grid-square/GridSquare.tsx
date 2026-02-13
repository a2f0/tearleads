import { cn } from '../../lib/utils.js';

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
        !selected && 'ring-1 ring-border',
        selected && 'ring-2 ring-primary',
        'hover:ring-2 hover:ring-primary',
        className
      )}
      style={{ aspectRatio: '1 / 1' }}
    >
      {children}
    </button>
  );
}
