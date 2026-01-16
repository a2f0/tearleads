import { useCallback, useEffect, useRef, useState } from 'react';

interface UseResizableBidirectionalOptions {
  defaultWidth: number;
  defaultHeight: number;
  minWidth: number;
  minHeight: number;
  maxWidthPercent: number;
  maxHeightPercent: number;
}

interface UseResizableBidirectionalReturn {
  width: number;
  height: number;
  handleCornerMouseDown: (e: React.MouseEvent) => void;
  handleCornerTouchStart: (e: React.TouchEvent) => void;
  handleVerticalMouseDown: (e: React.MouseEvent) => void;
  handleVerticalTouchStart: (e: React.TouchEvent) => void;
}

export function useResizableBidirectional({
  defaultWidth,
  defaultHeight,
  minWidth,
  minHeight,
  maxWidthPercent,
  maxHeightPercent
}: UseResizableBidirectionalOptions): UseResizableBidirectionalReturn {
  const [width, setWidth] = useState(defaultWidth);
  const [height, setHeight] = useState(defaultHeight);
  const isDraggingRef = useRef(false);
  const dragModeRef = useRef<'corner' | 'vertical'>('corner');
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startWidthRef = useRef(0);
  const startHeightRef = useRef(0);

  const handleDragMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!isDraggingRef.current) return;

      const maxHeight = window.innerHeight * maxHeightPercent;
      const maxWidth = window.innerWidth * maxWidthPercent;

      // Height: dragging up increases height (delta is negative when moving up)
      const deltaY = startYRef.current - clientY;
      const newHeight = Math.min(
        maxHeight,
        Math.max(minHeight, startHeightRef.current + deltaY)
      );
      setHeight(newHeight);

      // Width: only adjust in corner mode
      // Dragging left increases width (panel is on right side, so negative X delta = wider)
      if (dragModeRef.current === 'corner') {
        const deltaX = startXRef.current - clientX;
        const newWidth = Math.min(
          maxWidth,
          Math.max(minWidth, startWidthRef.current + deltaX)
        );
        setWidth(newWidth);
      }
    },
    [maxHeightPercent, maxWidthPercent, minHeight, minWidth]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => handleDragMove(e.clientX, e.clientY),
    [handleDragMove]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) handleDragMove(touch.clientX, touch.clientY);
    },
    [handleDragMove]
  );

  const handleDragEnd = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleDragEnd);
    document.removeEventListener('touchmove', handleTouchMove);
    document.removeEventListener('touchend', handleDragEnd);
  }, [handleMouseMove, handleTouchMove]);

  useEffect(() => {
    return () => {
      handleDragEnd();
    };
  }, [handleDragEnd]);

  const handleDragStart = useCallback(
    (clientX: number, clientY: number, mode: 'corner' | 'vertical') => {
      isDraggingRef.current = true;
      dragModeRef.current = mode;
      startXRef.current = clientX;
      startYRef.current = clientY;
      startWidthRef.current = width;
      startHeightRef.current = height;
      document.body.style.cursor =
        mode === 'corner' ? 'nwse-resize' : 'ns-resize';
      document.body.style.userSelect = 'none';
    },
    [width, height]
  );

  const handleCornerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      handleDragStart(e.clientX, e.clientY, 'corner');
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleDragEnd);
    },
    [handleDragStart, handleMouseMove, handleDragEnd]
  );

  const handleCornerTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      handleDragStart(touch.clientX, touch.clientY, 'corner');
      document.addEventListener('touchmove', handleTouchMove, {
        passive: true
      });
      document.addEventListener('touchend', handleDragEnd);
    },
    [handleDragStart, handleTouchMove, handleDragEnd]
  );

  const handleVerticalMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      handleDragStart(e.clientX, e.clientY, 'vertical');
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleDragEnd);
    },
    [handleDragStart, handleMouseMove, handleDragEnd]
  );

  const handleVerticalTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      handleDragStart(touch.clientX, touch.clientY, 'vertical');
      document.addEventListener('touchmove', handleTouchMove, {
        passive: true
      });
      document.addEventListener('touchend', handleDragEnd);
    },
    [handleDragStart, handleTouchMove, handleDragEnd]
  );

  return {
    width,
    height,
    handleCornerMouseDown,
    handleCornerTouchStart,
    handleVerticalMouseDown,
    handleVerticalTouchStart
  };
}
