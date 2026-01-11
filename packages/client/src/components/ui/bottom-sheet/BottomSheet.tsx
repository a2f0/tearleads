import { useCallback, useEffect, useId, useRef, useState } from 'react';
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
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const titleId = useId();
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
