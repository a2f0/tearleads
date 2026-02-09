import { cn } from '../lib/utils.js';

type WindowStatusBarTone = 'default' | 'info' | 'error';

export interface WindowStatusBarProps {
  children: React.ReactNode;
  tone?: WindowStatusBarTone | undefined;
  className?: string | undefined;
}

const TONE_CLASSNAMES: Record<WindowStatusBarTone, string> = {
  default: 'bg-muted/30 text-muted-foreground',
  info: 'bg-muted/30 text-muted-foreground',
  error: 'bg-destructive/10 text-destructive'
};

export function WindowStatusBar({
  children,
  tone = 'default',
  className
}: WindowStatusBarProps) {
  return (
    <div
      className={cn(
        'flex h-6 shrink-0 items-center border-t px-3 text-xs',
        TONE_CLASSNAMES[tone],
        className
      )}
    >
      {children}
    </div>
  );
}
