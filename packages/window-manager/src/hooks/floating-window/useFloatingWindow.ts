import { useCallback, useEffect, useRef, useState } from 'react';
import { calculateResizeForCorner, constrainPosition } from './geometry.js';
import { getCursorForCorner } from './getCursorForCorner.js';
import type {
  Corner,
  UseFloatingWindowOptions,
  UseFloatingWindowReturn
} from './types.js';

export type { Corner } from './types.js';

export function useFloatingWindow({
  defaultWidth,
  defaultHeight,
  defaultX,
  defaultY,
  minWidth,
  minHeight,
  maxWidthPercent,
  maxHeightPercent,
  onDimensionsChange,
  elementRef
}: UseFloatingWindowOptions): UseFloatingWindowReturn {
  const [width, setWidth] = useState(defaultWidth);
  const [height, setHeight] = useState(defaultHeight);
  const [x, setX] = useState(defaultX ?? 0);
  const [y, setY] = useState(defaultY ?? 0);

  const widthRef = useRef(width);
  const heightRef = useRef(height);
  const xRef = useRef(x);
  const yRef = useRef(y);

  useEffect(() => {
    widthRef.current = width;
    heightRef.current = height;
    xRef.current = x;
    yRef.current = y;
  }, [width, height, x, y]);

  const onDimensionsChangeRef = useRef(onDimensionsChange);
  useEffect(() => {
    onDimensionsChangeRef.current = onDimensionsChange;
  }, [onDimensionsChange]);

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
        const rect = elementRef?.current?.getBoundingClientRect();
        const constrained = constrainPosition(
          {
            x: startXRef.current + deltaX,
            y: startYRef.current + deltaY
          },
          {
            width: rect?.width || widthRef.current,
            height: rect?.height || heightRef.current
          },
          {
            width: window.innerWidth,
            height: window.innerHeight
          }
        );

        setX(constrained.x);
        setY(constrained.y);
        return;
      }

      const resized = calculateResizeForCorner(
        modeRef.current,
        {
          width: startWidthRef.current,
          height: startHeightRef.current,
          x: startXRef.current,
          y: startYRef.current
        },
        { deltaX, deltaY },
        { minWidth, minHeight },
        { maxWidth, maxHeight }
      );

      setWidth(resized.width);
      setHeight(resized.height);
      setX(resized.x);
      setY(resized.y);
    },
    [elementRef, maxHeightPercent, maxWidthPercent, minHeight, minWidth]
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

    onDimensionsChangeRef.current?.({
      width: widthRef.current,
      height: heightRef.current,
      x: xRef.current,
      y: yRef.current
    });
  }, [handleMouseMove, handleTouchMove]);

  handleEndRef.current = handleEnd;

  useEffect(() => {
    return () => {
      handleEndRef.current();
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const rect = elementRef?.current?.getBoundingClientRect();
      const constrained = constrainPosition(
        { x: xRef.current, y: yRef.current },
        {
          width: rect?.width || widthRef.current,
          height: rect?.height || heightRef.current
        },
        {
          width: window.innerWidth,
          height: window.innerHeight
        }
      );

      setX(constrained.x);
      setY(constrained.y);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [elementRef]);

  const handleStart = useCallback(
    (clientX: number, clientY: number, mode: 'drag' | Corner) => {
      isDraggingRef.current = true;
      modeRef.current = mode;
      startMouseXRef.current = clientX;
      startMouseYRef.current = clientY;
      startWidthRef.current = widthRef.current;
      startHeightRef.current = heightRef.current;
      startXRef.current = xRef.current;
      startYRef.current = yRef.current;
      document.body.style.cursor =
        mode === 'drag' ? 'grabbing' : getCursorForCorner(mode);
      document.body.style.userSelect = 'none';
    },
    []
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

  const setDimensions = useCallback(
    (newWidth: number, newHeight: number, newX: number, newY: number) => {
      setWidth(newWidth);
      setHeight(newHeight);
      setX(newX);
      setY(newY);
    },
    []
  );

  return {
    width,
    height,
    x,
    y,
    setDimensions,
    createCornerHandlers,
    createDragHandlers
  };
}
