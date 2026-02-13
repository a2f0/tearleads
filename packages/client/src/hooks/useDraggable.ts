import { useCallback, useEffect, useRef, useState } from 'react';

interface UseDraggableOptions {
  /** Initial position. Use { left: -1, top: -1 } to indicate "not yet positioned" */
  initialPosition?: { left: number; top: number };
  /** Element dimensions for boundary clamping */
  dimensions: { width: number; height: number };
  /** Bottom margin to account for fixed footer */
  bottomMargin?: number;
  /** Side margin from viewport edges */
  margin?: number;
  /** Minimum mouse movement before drag starts */
  dragThreshold?: number;
  /** Whether dragging is enabled */
  enabled?: boolean;
}

interface UseDraggableResult {
  /** Current position */
  position: { left: number; top: number };
  /** Whether position has been initialized */
  isPositioned: boolean;
  /** Ref to attach to the draggable element */
  elementRef: React.RefObject<HTMLElement | null>;
  /** Mouse down handler to attach to the element */
  handleMouseDown: (e: React.MouseEvent<HTMLElement>) => void;
  /** Whether the element was dragged (useful to prevent click after drag) */
  wasDragged: () => boolean;
}

/**
 * Hook for making an element draggable within viewport bounds.
 * Positions element in bottom-right corner by default and clamps on resize.
 */
export function useDraggable({
  initialPosition,
  dimensions,
  bottomMargin = 0,
  margin = 16,
  dragThreshold = 3,
  enabled = true
}: UseDraggableOptions): UseDraggableResult {
  const [position, setPosition] = useState<{ left: number; top: number }>(
    initialPosition ?? { left: -1, top: -1 }
  );

  const elementRef = useRef<HTMLElement | null>(null);
  const isDraggingRef = useRef(false);
  const hasDraggedRef = useRef(false);
  const startMouseXRef = useRef(0);
  const startMouseYRef = useRef(0);
  const startXRef = useRef(0);
  const startYRef = useRef(0);

  const { width, height } = dimensions;

  // Initialize position to bottom-right corner and clamp on resize
  useEffect(() => {
    if (!enabled) return;

    const computeDefault = () => ({
      left: window.innerWidth - width - margin,
      top: window.innerHeight - bottomMargin - margin - height
    });

    setPosition(computeDefault());

    const handleResize = () => {
      setPosition((prev) => {
        const rect = elementRef.current?.getBoundingClientRect();
        const w = rect?.width ?? width;
        const h = rect?.height ?? height;
        return {
          left: Math.max(0, Math.min(prev.left, window.innerWidth - w)),
          top: Math.max(0, Math.min(prev.top, window.innerHeight - h))
        };
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [enabled, width, height, bottomMargin, margin]);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDraggingRef.current) return;

      const deltaX = e.clientX - startMouseXRef.current;
      const deltaY = e.clientY - startMouseYRef.current;

      if (
        !hasDraggedRef.current &&
        Math.abs(deltaX) + Math.abs(deltaY) > dragThreshold
      ) {
        hasDraggedRef.current = true;
      }

      if (!hasDraggedRef.current) return;

      const rect = elementRef.current?.getBoundingClientRect();
      const w = rect?.width ?? width;
      const h = rect?.height ?? height;

      const newX = Math.max(
        0,
        Math.min(startXRef.current + deltaX, window.innerWidth - w)
      );
      const newY = Math.max(
        0,
        Math.min(startYRef.current + deltaY, window.innerHeight - h)
      );

      setPosition({ left: newX, top: newY });
    },
    [dragThreshold, width, height]
  );

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (!enabled || !elementRef.current) return;

      // Don't initiate drag from buttons
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;

      isDraggingRef.current = true;
      hasDraggedRef.current = false;
      startMouseXRef.current = e.clientX;
      startMouseYRef.current = e.clientY;

      const rect = elementRef.current.getBoundingClientRect();
      startXRef.current = rect.left;
      startYRef.current = rect.top;

      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [enabled, handleMouseMove, handleMouseUp]
  );

  // Clean up listeners on unmount
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const wasDragged = useCallback(() => hasDraggedRef.current, []);

  const isPositioned = position.left >= 0 && position.top >= 0;

  return {
    position,
    isPositioned,
    elementRef,
    handleMouseDown,
    wasDragged
  };
}
