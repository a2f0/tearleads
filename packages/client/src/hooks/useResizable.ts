import { useCallback, useEffect, useRef, useState } from 'react';

interface UseResizableOptions {
  defaultHeight: number;
  minHeight: number;
  maxHeightPercent: number;
}

interface UseResizableReturn {
  height: number;
  handleMouseDown: (e: React.MouseEvent) => void;
  handleTouchStart: (e: React.TouchEvent) => void;
}

export function useResizable({
  defaultHeight,
  minHeight,
  maxHeightPercent
}: UseResizableOptions): UseResizableReturn {
  const [height, setHeight] = useState(defaultHeight);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const handleDragMove = useCallback(
    (clientY: number) => {
      if (!isDraggingRef.current) return;
      const delta = startYRef.current - clientY;
      const maxHeight = window.innerHeight * maxHeightPercent;
      const newHeight = Math.min(
        maxHeight,
        Math.max(minHeight, startHeightRef.current + delta)
      );
      setHeight(newHeight);
    },
    [maxHeightPercent, minHeight]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => handleDragMove(e.clientY),
    [handleDragMove]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) handleDragMove(touch.clientY);
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
    (clientY: number) => {
      isDraggingRef.current = true;
      startYRef.current = clientY;
      startHeightRef.current = height;
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
    },
    [height]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      handleDragStart(e.clientY);
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleDragEnd);
    },
    [handleDragStart, handleMouseMove, handleDragEnd]
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      handleDragStart(touch.clientY);
      document.addEventListener('touchmove', handleTouchMove, {
        passive: true
      });
      document.addEventListener('touchend', handleDragEnd);
    },
    [handleDragStart, handleTouchMove, handleDragEnd]
  );

  return {
    height,
    handleMouseDown,
    handleTouchStart
  };
}
