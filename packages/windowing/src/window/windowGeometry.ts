import type { ResizeEdge } from "./WindowResizeHandle";
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
  edge: ResizeEdge;
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
  const { edge } = resizeState;
  const movesLeft = edge.includes("w");
  const movesUp = edge.includes("n");
  // A side handle drags one edge, so the other axis keeps its start size.
  const resizesX = movesLeft || edge.includes("e");
  const resizesY = movesUp || edge.includes("s");
  let width = Math.max(
    MIN_WIDTH,
    resizeState.startWidth + (resizesX ? deltaX * (movesLeft ? -1 : 1) : 0),
  );
  let height = Math.max(
    MIN_HEIGHT,
    resizeState.startHeight + (resizesY ? deltaY * (movesUp ? -1 : 1) : 0),
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

// What a window adds around its content's natural size, measured from the
// rendered window (see `useWindowFit`): `scrollbar` is what the scroll pane's
// scrollbars take on each axis, the vertical one's width and the horizontal
// one's height.
export interface WindowFitMetrics {
  // The window's size less its scroll pane's, so borders, bars, and a sidebar.
  chrome: WindowSize;
  padding: WindowSize;
  scrollbar: WindowSize;
}

// The geometry that shows `content` whole where the surface has room, then
// moves the window as far as it must to stay on the surface. The width always
// allows for a vertical scrollbar, even for content that fits: a status message
// takes height from the body while it shows, and content that then scrolled
// would lose width to the scrollbar, reflowing a layout that depends on it.
// Content wider than the surface also scrolls sideways, so that scrollbar takes
// height.
export function fitWindowGeometry(
  content: WindowSize,
  { chrome, padding, scrollbar }: WindowFitMetrics,
  surface: WindowSize,
  position: WindowPosition,
): { position: WindowPosition; size: WindowSize } {
  const width = chrome.width + padding.width + content.width + scrollbar.width;
  const scrollsAcross = width > surface.width;
  const height =
    chrome.height +
    padding.height +
    content.height +
    (scrollsAcross ? scrollbar.height : 0);
  const fit = (natural: number, available: number, minimum: number) =>
    Math.max(minimum, Math.min(available, Math.ceil(natural)));
  const size = {
    width: fit(width, surface.width, MIN_WIDTH),
    height: fit(height, surface.height, MIN_HEIGHT),
  };

  return {
    position: {
      x: Math.max(0, Math.min(position.x, surface.width - size.width)),
      y: Math.max(0, Math.min(position.y, surface.height - size.height)),
    },
    size,
  };
}
