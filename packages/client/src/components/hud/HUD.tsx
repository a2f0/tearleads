import { X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { AnalyticsTab } from './AnalyticsTab';
import { LogsTab } from './LogsTab';

type TabId = 'analytics' | 'logs';

const TABS: { id: TabId; label: string }[] = [
  { id: 'analytics', label: 'Analytics' },
  { id: 'logs', label: 'Logs' }
];

const DEFAULT_HEIGHT = 300;
const MIN_HEIGHT = 150;
const MAX_HEIGHT_PERCENT = 0.7;

interface HUDProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HUD({ isOpen, onClose }: HUDProps) {
  const [activeTab, setActiveTab] = useState<TabId>('analytics');
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const handleDragStart = useCallback(
    (clientY: number) => {
      isDraggingRef.current = true;
      startYRef.current = clientY;
      startHeightRef.current = height;
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
    },
    [height]
  );

  const handleDragMove = useCallback((clientY: number) => {
    if (!isDraggingRef.current) return;
    const delta = startYRef.current - clientY;
    const maxHeight = window.innerHeight * MAX_HEIGHT_PERCENT;
    const newHeight = Math.min(
      maxHeight,
      Math.max(MIN_HEIGHT, startHeightRef.current + delta)
    );
    setHeight(newHeight);
  }, []);

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      handleDragStart(e.clientY);

      const onMouseMove = (e: MouseEvent) => handleDragMove(e.clientY);
      const onMouseUp = () => {
        handleDragEnd();
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [handleDragStart, handleDragMove, handleDragEnd]
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      handleDragStart(touch.clientY);

      const onTouchMove = (e: TouchEvent) => {
        const touch = e.touches[0];
        if (!touch) return;
        handleDragMove(touch.clientY);
      };
      const onTouchEnd = () => {
        handleDragEnd();
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
      };

      document.addEventListener('touchmove', onTouchMove, { passive: true });
      document.addEventListener('touchend', onTouchEnd);
    },
    [handleDragStart, handleDragMove, handleDragEnd]
  );

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
        className="fixed inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden rounded-t-lg border bg-background/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80 md:inset-x-auto md:right-4 md:bottom-16 md:w-[min(400px,calc(100vw-2rem))] md:rounded-lg"
        style={{ height: `${height}px`, maxHeight: '70vh' }}
        role="dialog"
        aria-modal="true"
        aria-label="Head's Up Display"
      >
        <button
          type="button"
          className="flex w-full cursor-ns-resize touch-none justify-center border-0 bg-transparent py-1"
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          aria-label="Resize handle"
          data-testid="hud-resize-handle"
        >
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
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
