import { Settings, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useResizableBidirectional } from '@/hooks/useResizableBidirectional';
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

export function HUD({ isOpen, onClose }: HUDProps) {
  const [activeTab, setActiveTab] = useState<TabId>('logs');
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== 'undefined' && window.innerWidth >= DESKTOP_BREAKPOINT
  );
  const {
    width,
    height,
    handleCornerMouseDown,
    handleCornerTouchStart,
    handleVerticalMouseDown,
    handleVerticalTouchStart
  } = useResizableBidirectional({
    defaultWidth: DEFAULT_WIDTH,
    defaultHeight: DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    maxWidthPercent: MAX_WIDTH_PERCENT,
    maxHeightPercent: MAX_HEIGHT_PERCENT
  });

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
        className="fixed inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden rounded-t-lg border bg-background/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80 md:inset-x-auto md:right-4 md:bottom-16 md:rounded-lg"
        style={{
          height: `${height}px`,
          maxHeight: '70vh',
          ...(isDesktop && { width: `${width}px`, maxWidth: '60vw' })
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Head's Up Display"
      >
        {/* Mobile: vertical-only resize handle (top center) */}
        <button
          type="button"
          className="flex w-full cursor-ns-resize touch-none justify-center border-0 bg-transparent py-1 md:hidden"
          onMouseDown={handleVerticalMouseDown}
          onTouchStart={handleVerticalTouchStart}
          aria-label="Resize handle"
          data-testid="hud-resize-handle"
        >
          <Settings className="h-4 w-4 text-muted-foreground/50" />
        </button>
        {/* Desktop: corner resize handle (top-left) for bidirectional resize */}
        <button
          type="button"
          className="absolute top-1 left-1 hidden cursor-nwse-resize touch-none rounded p-1 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-muted-foreground md:block"
          onMouseDown={handleCornerMouseDown}
          onTouchStart={handleCornerTouchStart}
          aria-label="Resize handle"
          data-testid="hud-resize-handle-corner"
        >
          <Settings className="h-4 w-4" />
        </button>
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="flex gap-1">
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
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close HUD"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-3">
          {activeTab === 'analytics' && <AnalyticsTab />}
          {activeTab === 'logs' && <LogsTab />}
        </div>
      </div>
    </>
  );
}
