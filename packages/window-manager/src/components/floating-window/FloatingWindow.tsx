import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react';
import { useFloatingWindow } from '../../hooks/useFloatingWindow.js';
import { WINDOW_FIT_CONTENT_EVENT } from '../../lib/events.js';
import { cn } from '../../lib/utils.js';
import {
  DESKTOP_BREAKPOINT,
  MAX_FIT_CONTENT_ATTEMPTS,
  NEAR_MAXIMIZED_INSET
} from './constants.js';
import { ResizeHandle } from './ResizeHandle.js';
import type {
  FloatingWindowProps,
  PreMaximizeState,
  WindowDimensions
} from './types.js';
import { WindowTitleBar } from './WindowTitleBar.js';
import { buildFloatingWindowStyles } from './windowStyles.js';

export type { FloatingWindowProps, WindowDimensions } from './types.js';

export function FloatingWindow({
  id,
  title,
  children,
  onClose,
  onMinimize,
  onDimensionsChange,
  initialDimensions,
  defaultWidth = 500,
  defaultHeight = 400,
  defaultX,
  defaultY,
  minWidth = 300,
  minHeight = 200,
  maxWidthPercent = 0.8,
  maxHeightPercent = 0.8,
  zIndex = 50,
  onFocus,
  fitContent,
  footerHeight = 0
}: FloatingWindowProps) {
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== 'undefined' && window.innerWidth >= DESKTOP_BREAKPOINT
  );
  const [isMaximized, setIsMaximized] = useState(
    initialDimensions?.isMaximized ?? false
  );
  const [isNearMaximized, setIsNearMaximized] = useState(false);
  const preMaximizeStateRef = useRef<PreMaximizeState | null>(
    initialDimensions?.preMaximizeDimensions ?? null
  );
  const hasFitContentRef = useRef(false);
  const fitContentAttemptsRef = useRef(0);
  const windowRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const titleBarRef = useRef<HTMLDivElement | null>(null);

  const handleDimensionsChange = useCallback(
    (dimensions: WindowDimensions) => {
      onDimensionsChange?.({
        ...dimensions,
        isMaximized,
        ...(preMaximizeStateRef.current && {
          preMaximizeDimensions: preMaximizeStateRef.current
        })
      });
    },
    [onDimensionsChange, isMaximized]
  );

  const effectiveDefaultWidth = initialDimensions?.width ?? defaultWidth;
  const effectiveDefaultHeight = initialDimensions?.height ?? defaultHeight;

  const {
    width,
    height,
    x,
    y,
    setDimensions,
    createCornerHandlers,
    createDragHandlers
  } = useFloatingWindow({
    defaultWidth: effectiveDefaultWidth,
    defaultHeight: effectiveDefaultHeight,
    defaultX:
      initialDimensions?.x ??
      defaultX ??
      (typeof window !== 'undefined'
        ? Math.max(50, (window.innerWidth - effectiveDefaultWidth) / 2)
        : 0),
    defaultY:
      initialDimensions?.y ??
      defaultY ??
      (typeof window !== 'undefined'
        ? Math.max(50, (window.innerHeight - effectiveDefaultHeight) / 2)
        : 0),
    minWidth,
    minHeight,
    maxWidthPercent,
    maxHeightPercent,
    onDimensionsChange: handleDimensionsChange,
    elementRef: windowRef
  });

  const dragHandlers = createDragHandlers();
  const widthRef = useRef(width);
  const heightRef = useRef(height);

  useEffect(() => {
    widthRef.current = width;
    heightRef.current = height;
  }, [width, height]);

  const getFitContentDimensions = useCallback(() => {
    const contentElement = contentRef.current;
    if (!contentElement) return null;

    const contentHeight = contentElement.scrollHeight;
    const contentWidth = contentElement.scrollWidth;
    if (contentHeight <= 0 || contentWidth <= 0) return null;

    const titleBarHeight = titleBarRef.current?.offsetHeight ?? 0;
    const desiredHeight = Math.ceil(contentHeight + titleBarHeight);
    const desiredWidth = Math.ceil(contentWidth);
    const maxWidth = window.innerWidth * maxWidthPercent;
    const maxHeight = (window.innerHeight - footerHeight) * maxHeightPercent;

    const nextWidth = Math.max(minWidth, Math.min(desiredWidth, maxWidth));
    const nextHeight = Math.max(minHeight, Math.min(desiredHeight, maxHeight));
    const nextX = Math.max(0, Math.round((window.innerWidth - nextWidth) / 2));
    const nextY = Math.max(0, Math.round((maxHeight - nextHeight) / 2));

    return {
      width: nextWidth,
      height: nextHeight,
      x: nextX,
      y: nextY
    };
  }, [footerHeight, maxHeightPercent, maxWidthPercent, minHeight, minWidth]);

  useLayoutEffect(() => {
    if (
      !fitContent ||
      !isDesktop ||
      isMaximized ||
      initialDimensions ||
      hasFitContentRef.current
    ) {
      return;
    }

    let observer: ResizeObserver | null = null;

    const measureAndFit = () => {
      if (hasFitContentRef.current) return;
      const nextDimensions = getFitContentDimensions();
      if (!nextDimensions) return;

      const widthDelta = Math.abs(nextDimensions.width - widthRef.current);
      const heightDelta = Math.abs(nextDimensions.height - heightRef.current);
      if (widthDelta < 1 && heightDelta < 1) {
        hasFitContentRef.current = true;
        observer?.disconnect();
        return;
      }

      setDimensions(
        nextDimensions.width,
        nextDimensions.height,
        nextDimensions.x,
        nextDimensions.y
      );
      onDimensionsChange?.({
        width: nextDimensions.width,
        height: nextDimensions.height,
        x: nextDimensions.x,
        y: nextDimensions.y
      });
      fitContentAttemptsRef.current += 1;
      if (fitContentAttemptsRef.current >= MAX_FIT_CONTENT_ATTEMPTS) {
        hasFitContentRef.current = true;
        observer?.disconnect();
      }
    };

    measureAndFit();

    if (hasFitContentRef.current) return;

    const contentElement = contentRef.current;
    if (!contentElement) return;

    observer = new ResizeObserver(measureAndFit);
    observer.observe(contentElement);

    return () => observer?.disconnect();
  }, [
    fitContent,
    isDesktop,
    isMaximized,
    initialDimensions,
    getFitContentDimensions,
    onDimensionsChange,
    setDimensions
  ]);

  const handleFitContentRequest = useCallback(() => {
    if (!isDesktop) return;

    const nextDimensions = getFitContentDimensions();
    if (!nextDimensions) return;

    if (isMaximized) {
      preMaximizeStateRef.current = null;
      setIsMaximized(false);
      setIsNearMaximized(false);
    }

    setDimensions(
      nextDimensions.width,
      nextDimensions.height,
      nextDimensions.x,
      nextDimensions.y
    );
    onDimensionsChange?.({
      width: nextDimensions.width,
      height: nextDimensions.height,
      x: nextDimensions.x,
      y: nextDimensions.y,
      isMaximized: false
    });
  }, [
    getFitContentDimensions,
    isDesktop,
    isMaximized,
    onDimensionsChange,
    setDimensions
  ]);

  useEffect(() => {
    const element = windowRef.current;
    if (!element) return undefined;

    const handleEvent = () => handleFitContentRequest();
    element.addEventListener(WINDOW_FIT_CONTENT_EVENT, handleEvent);

    return () => {
      element.removeEventListener(WINDOW_FIT_CONTENT_EVENT, handleEvent);
    };
  }, [handleFitContentRequest]);

  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!isNearMaximized) return;
    const maxWidth = window.innerWidth * maxWidthPercent;
    const maxHeight = (window.innerHeight - footerHeight) * maxHeightPercent;
    if (width <= maxWidth && height <= maxHeight) {
      setIsNearMaximized(false);
    }
  }, [
    height,
    isNearMaximized,
    maxHeightPercent,
    maxWidthPercent,
    width,
    footerHeight
  ]);

  const handleWindowClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('[data-no-window-focus="true"]')
    ) {
      return;
    }
    onFocus?.();
  };

  const handleMaximize = useCallback(() => {
    if (isMaximized) {
      const maxWidth = window.innerWidth;
      const maxHeight = window.innerHeight - footerHeight;
      const nextWidth = Math.max(minWidth, maxWidth - NEAR_MAXIMIZED_INSET * 2);
      const nextHeight = Math.max(
        minHeight,
        maxHeight - NEAR_MAXIMIZED_INSET * 2
      );
      const nextX = Math.max(0, Math.round((maxWidth - nextWidth) / 2));
      const nextY = Math.max(0, Math.round((maxHeight - nextHeight) / 2));
      setDimensions(nextWidth, nextHeight, nextX, nextY);
      onDimensionsChange?.({
        width: nextWidth,
        height: nextHeight,
        x: nextX,
        y: nextY,
        isMaximized: false
      });
      preMaximizeStateRef.current = null;
      setIsMaximized(false);
      setIsNearMaximized(true);
    } else {
      preMaximizeStateRef.current = { width, height, x, y };
      const maxWidth = window.innerWidth;
      const maxHeight = window.innerHeight - footerHeight;
      setDimensions(maxWidth, maxHeight, 0, 0);
      onDimensionsChange?.({
        width: maxWidth,
        height: maxHeight,
        x: 0,
        y: 0,
        isMaximized: true,
        ...(preMaximizeStateRef.current && {
          preMaximizeDimensions: preMaximizeStateRef.current
        })
      });
      setIsMaximized(true);
      setIsNearMaximized(false);
    }
  }, [
    height,
    isMaximized,
    minHeight,
    minWidth,
    onDimensionsChange,
    setDimensions,
    width,
    x,
    y,
    footerHeight
  ]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Window focus on click
    <div
      ref={windowRef}
      className={cn(
        'floating-window fixed flex flex-col overflow-hidden border bg-background/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80',
        isDesktop && !isMaximized && 'rounded-lg',
        !isDesktop && 'inset-x-0 bottom-0 rounded-t-lg'
      )}
      style={buildFloatingWindowStyles({
        isDesktop,
        isMaximized,
        isNearMaximized,
        width,
        height,
        x,
        y,
        zIndex,
        maxWidthPercent,
        maxHeightPercent
      })}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      onClick={handleWindowClick}
      data-testid={`floating-window-${id}`}
      data-maximized={isMaximized}
    >
      {isDesktop && !isMaximized && (
        <>
          <ResizeHandle
            corner="top-left"
            windowId={id}
            handlers={createCornerHandlers('top-left')}
          />
          <ResizeHandle
            corner="top-right"
            windowId={id}
            handlers={createCornerHandlers('top-right')}
          />
          <ResizeHandle
            corner="bottom-left"
            windowId={id}
            handlers={createCornerHandlers('bottom-left')}
          />
          <ResizeHandle
            corner="bottom-right"
            windowId={id}
            handlers={createCornerHandlers('bottom-right')}
          />
        </>
      )}

      <WindowTitleBar
        id={id}
        title={title}
        isDesktop={isDesktop}
        isMaximized={isMaximized}
        width={width}
        height={height}
        x={x}
        y={y}
        onMinimize={onMinimize}
        onClose={onClose}
        onToggleMaximize={handleMaximize}
        dragHandlers={dragHandlers}
        titleBarRef={titleBarRef}
        preMaximizeDimensions={preMaximizeStateRef.current}
      />

      <div ref={contentRef} className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
}
