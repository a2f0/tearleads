import { GripHorizontal } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  type SnapPoint,
  useBottomSheetGesture
} from '@/hooks/useBottomSheetGesture';
import { cn } from '@/lib/utils';

export const ANIMATION_DURATION_MS = 300;
const MIN_HEIGHT = 150;
const MAX_HEIGHT_PERCENT = 0.85;
const VELOCITY_THRESHOLD = 0.5;
const DISMISS_THRESHOLD = 100;

interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  title?: string;
  'data-testid'?: string;
  snapPoints?: SnapPoint[];
  initialSnapPoint?: string;
}

function getDefaultSnapPoints(windowHeight: number): SnapPoint[] {
  return [
    { name: 'collapsed', height: 200 },
    { name: 'half', height: Math.round(windowHeight * 0.5) },
    { name: 'expanded', height: Math.round(windowHeight * 0.85) }
  ];
}

export function BottomSheet({
  open,
  onOpenChange,
  children,
  title,
  'data-testid': testId = 'bottom-sheet',
  snapPoints: customSnapPoints,
  initialSnapPoint = 'collapsed'
}: BottomSheetProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(open);
  const [windowHeight, setWindowHeight] = useState(
    typeof window !== 'undefined' ? window.innerHeight : 0
  );
  const titleId = useId();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleResize = () => {
      setWindowHeight(window.innerHeight);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const snapPoints = useMemo(
    () => customSnapPoints ?? getDefaultSnapPoints(windowHeight),
    [customSnapPoints, windowHeight]
  );

  const handleDismiss = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const {
    height,
    sheetRef,
    handleRef,
    isAnimating: isGestureAnimating
  } = useBottomSheetGesture({
    snapPoints,
    initialSnapPoint,
    minHeight: MIN_HEIGHT,
    maxHeightPercent: MAX_HEIGHT_PERCENT,
    onDismiss: handleDismiss,
    dismissThreshold: DISMISS_THRESHOLD,
    velocityThreshold: VELOCITY_THRESHOLD
  });

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      requestAnimationFrame(() => setIsVisible(true));
      return;
    }
    setIsVisible(false);
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
          isVisible ? 'opacity-100' : 'opacity-0'
        )}
        onClick={handleBackdropClick}
        aria-hidden="true"
        data-testid={`${testId}-backdrop`}
      />

      <div
        ref={sheetRef}
        className={cn(
          'fixed right-0 bottom-0 left-0 z-10 flex flex-col overflow-hidden',
          'rounded-t-2xl border-t bg-background shadow-lg',
          'pb-[env(safe-area-inset-bottom)]',
          isVisible ? 'translate-y-0' : 'translate-y-full',
          !isGestureAnimating && 'transition-transform duration-300 ease-out'
        )}
        style={{ height: `${height}px`, maxHeight: '85vh' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        data-testid={`${testId}-content`}
      >
        <div
          ref={handleRef}
          className="flex w-full cursor-ns-resize touch-none select-none justify-center pt-3 pb-2"
          role="slider"
          aria-label="Resize handle"
          aria-valuemin={MIN_HEIGHT}
          aria-valuemax={windowHeight * MAX_HEIGHT_PERCENT}
          aria-valuenow={height}
          tabIndex={0}
          data-testid={`${testId}-resize-handle`}
        >
          <GripHorizontal className="h-5 w-5 text-muted-foreground/50" />
        </div>

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
