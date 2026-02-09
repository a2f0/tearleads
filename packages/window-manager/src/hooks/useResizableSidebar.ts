import { useCallback, useEffect, useMemo, useRef } from 'react';

interface UseResizableSidebarOptions {
  width: number;
  onWidthChange: (width: number) => void;
  ariaLabel: string;
  resizeFrom?: 'left' | 'right';
  minWidth?: number;
  maxWidth?: number;
  keyboardStep?: number;
}

interface ResizeHandleProps {
  role: 'separator';
  tabIndex: number;
  'aria-orientation': 'vertical';
  'aria-valuenow': number;
  'aria-valuemin': number;
  'aria-valuemax': number;
  'aria-label': string;
  onMouseDown: (event: React.MouseEvent<HTMLElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}

export interface UseResizableSidebarResult {
  resizeHandleProps: ResizeHandleProps;
}

export function useResizableSidebar({
  width,
  onWidthChange,
  ariaLabel,
  resizeFrom = 'right',
  minWidth = 150,
  maxWidth = 400,
  keyboardStep = 10
}: UseResizableSidebarOptions): UseResizableSidebarResult {
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const mouseMoveHandlerRef = useRef<((event: MouseEvent) => void) | null>(
    null
  );
  const mouseUpHandlerRef = useRef<(() => void) | null>(null);

  const cleanupDragListeners = useCallback(() => {
    if (mouseMoveHandlerRef.current) {
      document.removeEventListener('mousemove', mouseMoveHandlerRef.current);
      mouseMoveHandlerRef.current = null;
    }
    if (mouseUpHandlerRef.current) {
      document.removeEventListener('mouseup', mouseUpHandlerRef.current);
      mouseUpHandlerRef.current = null;
    }
    isDraggingRef.current = false;
  }, []);

  const onMouseDown = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      isDraggingRef.current = true;
      startXRef.current = event.clientX;
      startWidthRef.current = width;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const delta =
          resizeFrom === 'left'
            ? startXRef.current - moveEvent.clientX
            : moveEvent.clientX - startXRef.current;
        const nextWidth = Math.max(
          minWidth,
          Math.min(maxWidth, startWidthRef.current + delta)
        );
        onWidthChange(nextWidth);
      };

      const handleMouseUp = () => {
        cleanupDragListeners();
      };

      mouseMoveHandlerRef.current = handleMouseMove;
      mouseUpHandlerRef.current = handleMouseUp;

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [cleanupDragListeners, maxWidth, minWidth, onWidthChange, resizeFrom, width]
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return;
      }
      event.preventDefault();
      const delta = event.key === 'ArrowRight' ? keyboardStep : -keyboardStep;
      const nextWidth = Math.max(minWidth, Math.min(maxWidth, width + delta));
      onWidthChange(nextWidth);
    },
    [keyboardStep, maxWidth, minWidth, onWidthChange, width]
  );

  useEffect(() => cleanupDragListeners, [cleanupDragListeners]);

  const resizeHandleProps = useMemo<ResizeHandleProps>(
    () => ({
      role: 'separator',
      tabIndex: 0,
      'aria-orientation': 'vertical',
      'aria-valuenow': width,
      'aria-valuemin': minWidth,
      'aria-valuemax': maxWidth,
      'aria-label': ariaLabel,
      onMouseDown,
      onKeyDown
    }),
    [ariaLabel, maxWidth, minWidth, onKeyDown, onMouseDown, width]
  );

  return { resizeHandleProps };
}
