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
      className={cn(
        'relative overflow-hidden rounded-lg border bg-muted transition-all',
        'hover:ring-2 hover:ring-primary hover:ring-offset-2',
        selected && 'ring-2 ring-primary ring-offset-2',
        className
      )}
      style={{ aspectRatio: '1 / 1' }}
    >
      {children}
    </button>
  );
}
