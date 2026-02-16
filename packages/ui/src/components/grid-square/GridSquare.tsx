import type { CSSProperties } from 'react';

import { cn } from '../../lib/utils.js';

export interface GridSquareProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  selected?: boolean;
  'data-testid'?: string;
  style?: CSSProperties;
}

export function GridSquare({
  children,
  className,
  onClick,
  selected = false,
  'data-testid': testId,
  style
}: GridSquareProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-pressed={selected}
      className={cn(
        'relative overflow-hidden rounded-lg border border-border bg-muted transition-all',
        !selected && 'ring-1 ring-border hover:border-primary',
        selected && 'border-2 border-primary ring-2 ring-primary',
        'hover:ring-2 hover:ring-primary hover:ring-offset-2 hover:ring-offset-background',
        className
      )}
      style={{
        ...style,
        aspectRatio: '1 / 1'
      }}
    >
      {children}
    </button>
  );
}
