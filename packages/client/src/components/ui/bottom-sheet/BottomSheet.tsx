import { useCallback, useEffect, useId, useState } from 'react';
import { useResizable } from '@/hooks/useResizable';
import { cn } from '@/lib/utils';

export const ANIMATION_DURATION_MS = 300;
const DEFAULT_HEIGHT = 300;
const MIN_HEIGHT = 150;
const MAX_HEIGHT_PERCENT = 0.85;

interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  title?: string;
  'data-testid'?: string;
}

export function BottomSheet({
  open,
  onOpenChange,
  children,
  title,
  'data-testid': testId = 'bottom-sheet'
}: BottomSheetProps) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [shouldRender, setShouldRender] = useState(open);
  const titleId = useId();
  const { height, handleMouseDown, handleTouchStart } = useResizable({
    defaultHeight: DEFAULT_HEIGHT,
    minHeight: MIN_HEIGHT,
    maxHeightPercent: MAX_HEIGHT_PERCENT
  });

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      requestAnimationFrame(() => setIsAnimating(true));
      return;
    }
    setIsAnimating(false);
    const timer = setTimeout(
      () => setShouldRender(false),
      ANIMATION_DURATION_MS
    );
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, onOpenChange]);

  const handleBackdropClick = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  if (!shouldRender) return null;

  return (
    <div className="fixed inset-0 z-50" data-testid={testId}>
      <div
        className={cn(
          'fixed inset-0 bg-black/50 transition-opacity duration-300',
          isAnimating ? 'opacity-100' : 'opacity-0'
        )}
        onClick={handleBackdropClick}
        aria-hidden="true"
        data-testid={`${testId}-backdrop`}
      />

      <div
        className={cn(
          'fixed right-0 bottom-0 left-0 z-10 flex flex-col overflow-hidden',
          'rounded-t-2xl border-t bg-background shadow-lg',
          'transition-transform duration-300 ease-out',
          'pb-[env(safe-area-inset-bottom)]',
          isAnimating ? 'translate-y-0' : 'translate-y-full'
        )}
        style={{ height: `${height}px`, maxHeight: '85vh' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        data-testid={`${testId}-content`}
      >
        <button
          type="button"
          className="flex w-full cursor-ns-resize touch-none justify-center border-0 bg-transparent pt-3 pb-2"
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          aria-label="Resize handle"
          data-testid={`${testId}-resize-handle`}
        >
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
        </button>

        {title && (
          <h2 id={titleId} className="px-4 pb-2 font-semibold text-lg">
            {title}
          </h2>
        )}

        <div className="flex-1 overflow-y-auto px-4 pb-4">{children}</div>
      </div>
    </div>
  );
}
