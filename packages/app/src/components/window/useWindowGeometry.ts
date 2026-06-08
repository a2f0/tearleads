import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ResizeCorner } from "./WindowResizeHandle";
import type { WindowEntry } from "./WindowStateProvider";

const MIN_WIDTH = 200;
const MIN_HEIGHT = 100;

export interface WindowPosition {
  x: number;
  y: number;
}

export interface WindowSize {
  width: number;
  height: number;
}

interface WindowDragState {
  offsetX: number;
  offsetY: number;
}

interface WindowResizeState {
  corner: ResizeCorner;
  startHeight: number;
  startLeft: number;
  startTop: number;
  startWidth: number;
  startX: number;
  startY: number;
  borderX: number;
  borderY: number;
}

function clampWindowPosition(
  windowRef: { current: HTMLDivElement | null },
  x: number,
  y: number,
): WindowPosition {
  const element = windowRef.current;
  const container = element?.parentElement;
  if (!element || !container) {
    return { x, y };
  }

  return {
    x: Math.max(0, Math.min(x, container.clientWidth - element.offsetWidth)),
    y: Math.max(0, Math.min(y, container.clientHeight - element.offsetHeight)),
  };
}

function resizeWindowWithinContainer(
  resizeState: WindowResizeState,
  clientX: number,
  clientY: number,
  container: HTMLElement | null,
) {
  const deltaX = clientX - resizeState.startX;
  const deltaY = clientY - resizeState.startY;
  const movesLeft = resizeState.corner.includes("w");
  const movesUp = resizeState.corner.includes("n");
  let width = Math.max(
    MIN_WIDTH,
    resizeState.startWidth + deltaX * (movesLeft ? -1 : 1),
  );
  let height = Math.max(
    MIN_HEIGHT,
    resizeState.startHeight + deltaY * (movesUp ? -1 : 1),
  );
  let x = movesLeft
    ? resizeState.startLeft + resizeState.startWidth - width
    : resizeState.startLeft;
  let y = movesUp
    ? resizeState.startTop + resizeState.startHeight - height
    : resizeState.startTop;

  if (container) {
    if (x < 0) {
      width += x;
      x = 0;
    }
    if (y < 0) {
      height += y;
      y = 0;
    }
    width = Math.min(width, container.clientWidth - x - resizeState.borderX);
    height = Math.min(height, container.clientHeight - y - resizeState.borderY);
    width = Math.max(MIN_WIDTH, width);
    height = Math.max(MIN_HEIGHT, height);
  }

  return {
    position: { x, y },
    size: { width, height },
  };
}

function useWindowPointerTracking(
  windowRef: { current: HTMLDivElement | null },
  dragging: { current: WindowDragState | null },
  resizing: { current: WindowResizeState | null },
  clamp: (x: number, y: number) => WindowPosition,
  setPosition: (value: WindowPosition) => void,
  setSize: (value: WindowSize) => void,
) {
  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      if (resizing.current) {
        const nextFrame = resizeWindowWithinContainer(
          resizing.current,
          event.clientX,
          event.clientY,
          windowRef.current?.parentElement ?? null,
        );
        setPosition(nextFrame.position);
        setSize(nextFrame.size);
        return;
      }

      if (dragging.current) {
        setPosition(
          clamp(
            event.clientX - dragging.current.offsetX,
            event.clientY - dragging.current.offsetY,
          ),
        );
      }
    }

    function handleMouseUp() {
      dragging.current = null;
      resizing.current = null;
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [clamp, dragging, resizing, setPosition, setSize, windowRef]);
}

export function useWindowGeometry(
  entry: WindowEntry,
  maximized: boolean,
  windowRef: { current: HTMLDivElement | null },
) {
  const [position, setPosition] = useState<WindowPosition | null>(null);
  const [size, setSize] = useState<WindowSize | null>(null);
  const dragging = useRef<WindowDragState | null>(null);
  const resizing = useRef<WindowResizeState | null>(null);
  const clamp = useCallback(
    (x: number, y: number) => clampWindowPosition(windowRef, x, y),
    [windowRef],
  );

  useEffect(() => {
    const element = windowRef.current;
    const container = element?.parentElement;
    if (!element || !container) {
      return;
    }
    const containerRect = container.getBoundingClientRect();
    setPosition(
      clamp(
        entry.initialX - containerRect.left,
        entry.initialY - containerRect.top,
      ),
    );
  }, [clamp, entry.initialX, entry.initialY, windowRef]);

  useWindowPointerTracking(
    windowRef,
    dragging,
    resizing,
    clamp,
    setPosition,
    setSize,
  );

  const handleMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      if (!position || maximized) {
        return;
      }
      dragging.current = {
        offsetX: event.clientX - position.x,
        offsetY: event.clientY - position.y,
      };
    },
    [dragging, maximized, position],
  );

  const handleResizeMouseDown = useCallback(
    (event: ReactMouseEvent, corner: ResizeCorner) => {
      if (maximized || !position || !windowRef.current) {
        return;
      }
      event.stopPropagation();
      const el = windowRef.current;
      const computed = getComputedStyle(el);
      const borderBox = computed.boxSizing === "border-box";
      resizing.current = {
        corner,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: position.x,
        startTop: position.y,
        startWidth: parseFloat(computed.width),
        startHeight: parseFloat(computed.height),
        borderX: borderBox ? 0 : el.offsetWidth - el.clientWidth,
        borderY: borderBox ? 0 : el.offsetHeight - el.clientHeight,
      };
    },
    [maximized, position, resizing, windowRef],
  );

  return {
    handleMouseDown,
    handleResizeMouseDown,
    position,
    size,
  };
}
