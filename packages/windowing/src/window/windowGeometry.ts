import type { ResizeCorner } from "./WindowResizeHandle";
import type { WindowPosition, WindowSize } from "./WindowStateProvider";

// Window geometry math shared by the pointer, keyboard, and layout hooks. All
// positions and sizes are relative to the desktop surface.

export const MIN_WIDTH = 200;
export const MIN_HEIGHT = 100;

export interface WindowDragState {
  offsetX: number;
  offsetY: number;
  pointerId: number;
}

export interface WindowResizeState {
  corner: ResizeCorner;
  pointerId: number;
  startHeight: number;
  startLeft: number;
  startTop: number;
  startWidth: number;
  startX: number;
  startY: number;
  borderX: number;
  borderY: number;
}

export interface LiveGeometry {
  position: WindowPosition | null;
  size: WindowSize | null;
}

// Clamps against the size the window is about to render at when it is known,
// so a position committed with a new size is not measured at the old one.
export function clampWindowPosition(
  element: HTMLElement | null,
  x: number,
  y: number,
  size: WindowSize | null,
): WindowPosition {
  const container = element?.parentElement;
  if (!element || !container) {
    return { x, y };
  }
  // A requested size renders no smaller than the stylesheet's minimums.
  const width = size ? Math.max(MIN_WIDTH, size.width) : element.offsetWidth;
  const height = size
    ? Math.max(MIN_HEIGHT, size.height)
    : element.offsetHeight;

  return {
    x: Math.max(0, Math.min(x, container.clientWidth - width)),
    y: Math.max(0, Math.min(y, container.clientHeight - height)),
  };
}

export function resizeWindowWithinContainer(
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
