import type { LucideIcon } from 'lucide-react';
import { GridSquare } from './GridSquare.js';

export interface IconSquareProps {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  selected?: boolean;
  'data-testid'?: string;
}

export function IconSquare({
  icon: Icon,
  label,
  onClick,
  selected,
  'data-testid': testId
}: IconSquareProps) {
  return (
    <GridSquare
      {...(onClick && { onClick })}
      {...(selected !== undefined && { selected })}
      {...(testId && { 'data-testid': testId })}
    >
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
        <Icon className="h-12 w-12 text-muted-foreground" />
        <span className="text-center font-medium text-sm">{label}</span>
      </div>
    </GridSquare>
  );
}
