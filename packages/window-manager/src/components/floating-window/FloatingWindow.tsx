import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react';
import { useFloatingWindow } from '../../hooks/useFloatingWindow.js';
import {
  DESKTOP_BREAKPOINT,
  MAX_FIT_CONTENT_ATTEMPTS,
  NEAR_MAXIMIZED_INSET
} from './constants.js';
import { FloatingWindowBody } from './FloatingWindowBody.js';
import { FloatingWindowResizeHandles } from './FloatingWindowResizeHandles.js';
import { FloatingWindowSurface } from './FloatingWindowSurface.js';
import type {
  FloatingWindowProps,
  PreMaximizeState,
  WindowDimensions
} from './types.js';

export type { FloatingWindowProps, WindowDimensions } from './types.js';

export function FloatingWindow({
  id,
  title,
  children,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
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
  footerHeight = 0,
  contentClassName
}: FloatingWindowProps) {
  const [windowTitle, setWindowTitle] = useState(title);
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

  useEffect(() => {
    setWindowTitle(title);
  }, [title]);

  const handleRenameTitle = useCallback(
    (newTitle: string) => {
      setWindowTitle(newTitle);
      onRename?.(newTitle);
    },
    [onRename]
  );

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
    <FloatingWindowSurface
      windowRef={windowRef}
      id={id}
      title={windowTitle}
      styleProps={{
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
      }}
      onClick={handleWindowClick}
    >
      {isDesktop && !isMaximized && (
        <FloatingWindowResizeHandles
          id={id}
          createCornerHandlers={createCornerHandlers}
        />
      )}
      <div className="relative z-20 flex min-h-0 flex-1 flex-col">
        <FloatingWindowBody
          titleBarProps={{
            id,
            title: windowTitle,
            isDesktop,
            isMaximized,
            width,
            height,
            x,
            y,
            onMinimize,
            onClose,
            onToggleMaximize: handleMaximize,
            dragHandlers,
            titleBarRef,
            preMaximizeDimensions: preMaximizeStateRef.current,
            onRenameTitle: handleRenameTitle
          }}
          contentRef={contentRef}
          contentClassName={contentClassName}
        >
          {children}
        </FloatingWindowBody>
      </div>
    </FloatingWindowSurface>
  );
}
