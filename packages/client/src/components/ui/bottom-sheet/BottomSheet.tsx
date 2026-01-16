import { GripHorizontal } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
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
const HANDLE_HEIGHT = 40; // Coupled to classes: h-5 icon, pt-3, pb-2
const TITLE_HEIGHT = 36; // Coupled to classes: text-lg, pb-2
const CONTENT_PADDING = 16; // Coupled to class: pb-4
const MIN_SNAP_SEPARATION = 25; // Minimum gap between snap points

interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  title?: string;
  'data-testid'?: string;
  snapPoints?: SnapPoint[];
  initialSnapPoint?: string;
  /** When true, the sheet will measure its content and open to fit it */
  fitContent?: boolean;
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
  initialSnapPoint = 'collapsed',
  fitContent = false
}: BottomSheetProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(open);
  const [windowHeight, setWindowHeight] = useState(
    typeof window !== 'undefined' ? window.innerHeight : 0
  );
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleResize = () => {
      setWindowHeight(window.innerHeight);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Measure content height when fitContent is enabled
  useLayoutEffect(() => {
    if (!fitContent || !open || !contentRef.current) return;

    const measureContent = () => {
      if (contentRef.current) {
        const height = contentRef.current.scrollHeight;
        setContentHeight(height);
      }
    };

    measureContent();

    // Use ResizeObserver to handle dynamic content changes
    const observer = new ResizeObserver(measureContent);
    observer.observe(contentRef.current);

    return () => observer.disconnect();
  }, [fitContent, open]);

  const snapPoints = useMemo(() => {
    if (customSnapPoints) return customSnapPoints;

    const defaultPoints = getDefaultSnapPoints(windowHeight);

    // Add content-based snap point when fitContent is enabled and measured
    if (fitContent && contentHeight !== null) {
      const totalHeight =
        HANDLE_HEIGHT +
        (title ? TITLE_HEIGHT : 0) +
        contentHeight +
        CONTENT_PADDING;
      const maxHeight = windowHeight * MAX_HEIGHT_PERCENT;
      const clampedHeight = Math.min(
        Math.max(totalHeight, MIN_HEIGHT),
        maxHeight
      );

      return [
        { name: 'content', height: clampedHeight },
        ...defaultPoints.filter(
          (p) => p.height > clampedHeight + MIN_SNAP_SEPARATION
        )
      ];
    }

    return defaultPoints;
  }, [customSnapPoints, windowHeight, fitContent, contentHeight, title]);

  const effectiveInitialSnapPoint = fitContent ? 'content' : initialSnapPoint;

  const handleDismiss = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const {
    height,
    sheetRef,
    handleRef,
    isAnimating: isGestureAnimating,
    snapTo
  } = useBottomSheetGesture({
    snapPoints,
    initialSnapPoint: effectiveInitialSnapPoint,
    minHeight: MIN_HEIGHT,
    maxHeightPercent: MAX_HEIGHT_PERCENT,
    onDismiss: handleDismiss,
    dismissThreshold: DISMISS_THRESHOLD,
    velocityThreshold: VELOCITY_THRESHOLD
  });

  // Snap to content height when it's first measured
  const hasSnappedToContent = useRef(false);
  useEffect(() => {
    if (fitContent && contentHeight !== null && !hasSnappedToContent.current) {
      hasSnappedToContent.current = true;
      snapTo('content');
    }
  }, [fitContent, contentHeight, snapTo]);

  // Reset the snap flag when the sheet closes
  useEffect(() => {
    if (!open) {
      hasSnappedToContent.current = false;
    }
  }, [open]);

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

        <div ref={contentRef} className="flex-1 overflow-y-auto px-4 pb-4">
          {children}
        </div>
      </div>
    </div>
  );
}
