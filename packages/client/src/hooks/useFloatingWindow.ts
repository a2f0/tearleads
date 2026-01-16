import { useCallback, useEffect, useRef, useState } from 'react';

type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

function getCursorForCorner(corner: Corner): string {
  switch (corner) {
    case 'top-left':
      return 'nwse-resize';
    case 'top-right':
      return 'nesw-resize';
    case 'bottom-left':
      return 'nesw-resize';
    case 'bottom-right':
      return 'nwse-resize';
  }
}

interface UseFloatingWindowOptions {
  defaultWidth: number;
  defaultHeight: number;
  defaultX?: number;
  defaultY?: number;
  minWidth: number;
  minHeight: number;
  maxWidthPercent: number;
  maxHeightPercent: number;
}

interface UseFloatingWindowReturn {
  width: number;
  height: number;
  x: number;
  y: number;
  createCornerHandlers: (corner: Corner) => {
    onMouseDown: (e: React.MouseEvent) => void;
    onTouchStart: (e: React.TouchEvent) => void;
  };
  createDragHandlers: () => {
    onMouseDown: (e: React.MouseEvent) => void;
    onTouchStart: (e: React.TouchEvent) => void;
  };
}

export function useFloatingWindow({
  defaultWidth,
  defaultHeight,
  defaultX,
  defaultY,
  minWidth,
  minHeight,
  maxWidthPercent,
  maxHeightPercent
}: UseFloatingWindowOptions): UseFloatingWindowReturn {
  const [width, setWidth] = useState(defaultWidth);
  const [height, setHeight] = useState(defaultHeight);
  const [x, setX] = useState(defaultX ?? 0);
  const [y, setY] = useState(defaultY ?? 0);

  // Refs to track current dimensions for use in callbacks without causing re-renders
  const widthRef = useRef(width);
  const heightRef = useRef(height);
  widthRef.current = width;
  heightRef.current = height;

  const isDraggingRef = useRef(false);
  const modeRef = useRef<'drag' | Corner>('drag');
  const startMouseXRef = useRef(0);
  const startMouseYRef = useRef(0);
  const startWidthRef = useRef(0);
  const startHeightRef = useRef(0);
  const startXRef = useRef(0);
  const startYRef = useRef(0);

  const handleMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!isDraggingRef.current) return;

      const maxWidth = window.innerWidth * maxWidthPercent;
      const maxHeight = window.innerHeight * maxHeightPercent;
      const deltaX = clientX - startMouseXRef.current;
      const deltaY = clientY - startMouseYRef.current;

      if (modeRef.current === 'drag') {
        const newX = startXRef.current + deltaX;
        const newY = startYRef.current + deltaY;

        // Constrain position to be within the viewport (use refs for current dimensions)
        const constrainedX = Math.max(
          0,
          Math.min(newX, window.innerWidth - widthRef.current)
        );
        const constrainedY = Math.max(
          0,
          Math.min(newY, window.innerHeight - heightRef.current)
        );

        setX(constrainedX);
        setY(constrainedY);
        return;
      }

      switch (modeRef.current) {
        case 'top-left': {
          const newWidth = Math.min(
            maxWidth,
            Math.max(minWidth, startWidthRef.current - deltaX)
          );
          const newHeight = Math.min(
            maxHeight,
            Math.max(minHeight, startHeightRef.current - deltaY)
          );
          const widthDiff = newWidth - startWidthRef.current;
          const heightDiff = newHeight - startHeightRef.current;
          setWidth(newWidth);
          setHeight(newHeight);
          setX(startXRef.current - widthDiff);
          setY(startYRef.current - heightDiff);
          break;
        }
        case 'top-right': {
          const newWidth = Math.min(
            maxWidth,
            Math.max(minWidth, startWidthRef.current + deltaX)
          );
          const newHeight = Math.min(
            maxHeight,
            Math.max(minHeight, startHeightRef.current - deltaY)
          );
          const heightDiff = newHeight - startHeightRef.current;
          setWidth(newWidth);
          setHeight(newHeight);
          setY(startYRef.current - heightDiff);
          break;
        }
        case 'bottom-left': {
          const newWidth = Math.min(
            maxWidth,
            Math.max(minWidth, startWidthRef.current - deltaX)
          );
          const newHeight = Math.min(
            maxHeight,
            Math.max(minHeight, startHeightRef.current + deltaY)
          );
          const widthDiff = newWidth - startWidthRef.current;
          setWidth(newWidth);
          setHeight(newHeight);
          setX(startXRef.current - widthDiff);
          break;
        }
        case 'bottom-right': {
          const newWidth = Math.min(
            maxWidth,
            Math.max(minWidth, startWidthRef.current + deltaX)
          );
          const newHeight = Math.min(
            maxHeight,
            Math.max(minHeight, startHeightRef.current + deltaY)
          );
          setWidth(newWidth);
          setHeight(newHeight);
          break;
        }
      }
    },
    [maxWidthPercent, maxHeightPercent, minWidth, minHeight]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => handleMove(e.clientX, e.clientY),
    [handleMove]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) handleMove(touch.clientX, touch.clientY);
    },
    [handleMove]
  );

  // Use a ref for handleEnd to avoid stale closure issues with event listeners
  const handleEndRef = useRef<() => void>(() => {});

  const handleEnd = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleEndRef.current);
    document.removeEventListener('touchmove', handleTouchMove);
    document.removeEventListener('touchend', handleEndRef.current);
  }, [handleMouseMove, handleTouchMove]);

  // Keep the ref updated with the latest handleEnd
  handleEndRef.current = handleEnd;

  // Cleanup on unmount only - using ref to avoid re-running on handleEnd changes
  useEffect(() => {
    return () => {
      handleEndRef.current();
    };
  }, []);

  // Keep window within viewport on browser resize
  useEffect(() => {
    const handleResize = () => {
      setX((currentX) =>
        Math.max(0, Math.min(currentX, window.innerWidth - width))
      );
      setY((currentY) =>
        Math.max(0, Math.min(currentY, window.innerHeight - height))
      );
    };

    window.addEventListener('resize', handleResize);

    return () => window.removeEventListener('resize', handleResize);
  }, [width, height]);

  const handleStart = useCallback(
    (clientX: number, clientY: number, mode: 'drag' | Corner) => {
      isDraggingRef.current = true;
      modeRef.current = mode;
      startMouseXRef.current = clientX;
      startMouseYRef.current = clientY;
      startWidthRef.current = width;
      startHeightRef.current = height;
      startXRef.current = x;
      startYRef.current = y;
      document.body.style.cursor =
        mode === 'drag' ? 'grabbing' : getCursorForCorner(mode);
      document.body.style.userSelect = 'none';
    },
    [width, height, x, y]
  );

  const createCornerHandlers = useCallback(
    (corner: Corner) => ({
      onMouseDown: (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        handleStart(e.clientX, e.clientY, corner);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleEndRef.current);
      },
      onTouchStart: (e: React.TouchEvent) => {
        const touch = e.touches[0];
        if (!touch) return;
        e.preventDefault();
        e.stopPropagation();
        handleStart(touch.clientX, touch.clientY, corner);
        document.addEventListener('touchmove', handleTouchMove, {
          passive: true
        });
        document.addEventListener('touchend', handleEndRef.current);
      }
    }),
    [handleStart, handleMouseMove, handleTouchMove]
  );

  const createDragHandlers = useCallback(
    () => ({
      onMouseDown: (e: React.MouseEvent) => {
        e.preventDefault();
        handleStart(e.clientX, e.clientY, 'drag');
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleEndRef.current);
      },
      onTouchStart: (e: React.TouchEvent) => {
        const touch = e.touches[0];
        if (!touch) return;
        e.preventDefault();
        handleStart(touch.clientX, touch.clientY, 'drag');
        document.addEventListener('touchmove', handleTouchMove, {
          passive: true
        });
        document.addEventListener('touchend', handleEndRef.current);
      }
    }),
    [handleStart, handleMouseMove, handleTouchMove]
  );

  return {
    width,
    height,
    x,
    y,
    createCornerHandlers,
    createDragHandlers
  };
}
