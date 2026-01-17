import { StickyNote, Terminal } from 'lucide-react';
import type { WindowType } from '@/contexts/WindowManagerContext';
import { cn } from '@/lib/utils';

const WINDOW_ICONS: Record<WindowType, React.ReactNode> = {
  notes: <StickyNote className="h-3 w-3" />,
  console: <Terminal className="h-3 w-3" />
};

const WINDOW_LABELS: Record<WindowType, string> = {
  notes: 'Notes',
  console: 'Console'
};

interface TaskbarButtonProps {
  type: WindowType;
  isActive: boolean;
  isMinimized?: boolean;
  onClick: () => void;
}

export function TaskbarButton({
  type,
  isActive,
  isMinimized = false,
  onClick
}: TaskbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded border px-2 py-1 text-xs transition-colors',
        isActive
          ? 'border-primary/50 bg-primary/10 text-foreground'
          : 'border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
        isMinimized && 'opacity-60'
      )}
      data-testid={`taskbar-button-${type}`}
      data-minimized={isMinimized}
    >
      {WINDOW_ICONS[type]}
      <span>{WINDOW_LABELS[type]}</span>
    </button>
  );
}
