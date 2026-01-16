import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFloatingWindow } from '@/hooks/useFloatingWindow';
import { cn } from '@/lib/utils';
import { AnalyticsTab } from './AnalyticsTab';
import { LogsTab } from './LogsTab';

const DESKTOP_BREAKPOINT = 768;

type TabId = 'analytics' | 'logs';

const TABS: { id: TabId; label: string }[] = [
  { id: 'analytics', label: 'Analytics' },
  { id: 'logs', label: 'Logs' }
];

const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 300;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 150;
const MAX_WIDTH_PERCENT = 0.6;
const MAX_HEIGHT_PERCENT = 0.7;

interface HUDProps {
  isOpen: boolean;
  onClose: () => void;
}

function ResizeHandle({
  corner,
  handlers
}: {
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  handlers: {
    onMouseDown: (e: React.MouseEvent) => void;
    onTouchStart: (e: React.TouchEvent) => void;
  };
}) {
  const positionClasses = {
    'top-left': 'top-0 left-0 cursor-nwse-resize',
    'top-right': 'top-0 right-0 cursor-nesw-resize',
    'bottom-left': 'bottom-0 left-0 cursor-nesw-resize',
    'bottom-right': 'bottom-0 right-0 cursor-nwse-resize'
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Resize handle for mouse/touch drag only
    <div
      className={cn(
        'absolute z-10 h-3 w-3 touch-none',
        positionClasses[corner]
      )}
      onMouseDown={handlers.onMouseDown}
      onTouchStart={handlers.onTouchStart}
      data-testid={`hud-resize-handle-${corner}`}
    />
  );
}

export function HUD({ isOpen, onClose }: HUDProps) {
  const [activeTab, setActiveTab] = useState<TabId>('logs');
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== 'undefined' && window.innerWidth >= DESKTOP_BREAKPOINT
  );

  const { width, height, x, y, createCornerHandlers, createDragHandlers } =
    useFloatingWindow({
      defaultWidth: DEFAULT_WIDTH,
      defaultHeight: DEFAULT_HEIGHT,
      defaultX:
        typeof window !== 'undefined'
          ? window.innerWidth - DEFAULT_WIDTH - 16
          : 0,
      defaultY:
        typeof window !== 'undefined'
          ? window.innerHeight - DEFAULT_HEIGHT - 64
          : 0,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      maxWidthPercent: MAX_WIDTH_PERCENT,
      maxHeightPercent: MAX_HEIGHT_PERCENT
    });

  const dragHandlers = createDragHandlers();

  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
        data-testid="hud-backdrop"
      />
      <div
        className={cn(
          'fixed z-50 flex flex-col overflow-hidden border bg-background/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80',
          isDesktop ? 'rounded-lg' : 'inset-x-0 bottom-0 rounded-t-lg'
        )}
        style={
          isDesktop
            ? {
                width: `${width}px`,
                height: `${height}px`,
                left: `${x}px`,
                top: `${y}px`,
                maxWidth: `${MAX_WIDTH_PERCENT * 100}vw`,
                maxHeight: `${MAX_HEIGHT_PERCENT * 100}vh`
              }
            : {
                height: `${height}px`,
                maxHeight: `${MAX_HEIGHT_PERCENT * 100}vh`
              }
        }
        role="dialog"
        aria-modal="true"
        aria-label="Head's Up Display"
      >
        {/* Desktop: 4 corner resize handles */}
        {isDesktop && (
          <>
            <ResizeHandle
              corner="top-left"
              handlers={createCornerHandlers('top-left')}
            />
            <ResizeHandle
              corner="top-right"
              handlers={createCornerHandlers('top-right')}
            />
            <ResizeHandle
              corner="bottom-left"
              handlers={createCornerHandlers('bottom-left')}
            />
            <ResizeHandle
              corner="bottom-right"
              handlers={createCornerHandlers('bottom-right')}
            />
          </>
        )}

        {/* Title bar - draggable on desktop */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: Title bar for mouse/touch drag only */}
        <div
          className={cn(
            'flex h-7 shrink-0 items-center justify-between border-b bg-muted/50 px-2',
            isDesktop && 'cursor-grab active:cursor-grabbing'
          )}
          onMouseDown={isDesktop ? dragHandlers.onMouseDown : undefined}
          onTouchStart={isDesktop ? dragHandlers.onTouchStart : undefined}
          data-testid="hud-title-bar"
        >
          <span className="select-none font-medium text-muted-foreground text-xs">
            HUD
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close HUD"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Tab navigation */}
        <div className="flex items-center gap-1 border-b px-3 py-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'rounded px-3 py-1 font-mono text-xs transition-colors',
                activeTab === tab.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-auto p-3">
          {activeTab === 'analytics' && <AnalyticsTab />}
          {activeTab === 'logs' && <LogsTab />}
        </div>
      </div>
    </>
  );
}
