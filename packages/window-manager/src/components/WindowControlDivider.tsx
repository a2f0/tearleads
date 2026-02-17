import { cn } from '../lib/utils.js';

export interface WindowControlDividerProps {
  className?: string | undefined;
}

export function WindowControlDivider({ className }: WindowControlDividerProps) {
  return <div className={cn('mx-0.5 h-3 w-px bg-border/60', className)} />;
}
