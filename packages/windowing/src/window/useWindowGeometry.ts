import {
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ResizeCorner } from "./WindowResizeHandle";
import {
  useWindowActions,
  type WindowEntry,
  type WindowPosition,
  type WindowSize,
} from "./WindowStateProvider";

const MIN_WIDTH = 200;
const MIN_HEIGHT = 100;

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

interface LiveGeometry {
  position: WindowPosition | null;
  size: WindowSize | null;
}

function clampWindowPosition(
  element: HTMLDivElement | null,
  x: number,
  y: number,
): WindowPosition {
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

// Pointer events cover mouse, touch, and pen alike. The live geometry stays in
// component state while a gesture runs, so only this window re-renders per
// frame; the gesture's end commits it to the shared window state once.
function useWindowPointerTracking(
  windowRef: RefObject<HTMLDivElement | null>,
  dragging: MutableRefObject<WindowDragState | null>,
  resizing: MutableRefObject<WindowResizeState | null>,
  clamp: (x: number, y: number) => WindowPosition,
  setPosition: (value: WindowPosition) => void,
  setSize: (value: WindowSize) => void,
  commit: () => void,
) {
  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
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

    function handlePointerEnd() {
      if (!dragging.current && !resizing.current) {
        return;
      }
      dragging.current = null;
      resizing.current = null;
      commit();
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerEnd);
    document.addEventListener("pointercancel", handlePointerEnd);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerEnd);
      document.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [clamp, commit, dragging, resizing, setPosition, setSize, windowRef]);
}

function useLiveGeometry(entry: WindowEntry) {
  const { setGeometry } = useWindowActions();
  const [position, setPositionState] = useState<WindowPosition | null>(null);
  const [size, setSizeState] = useState<WindowSize | null>(entry.size ?? null);
  // Mirrors the live state so a gesture's end commits the latest frame.
  const live = useRef<LiveGeometry>({
    position: null,
    size: entry.size ?? null,
  });

  const setPosition = useCallback((value: WindowPosition) => {
    live.current.position = value;
    setPositionState(value);
  }, []);
  const setSize = useCallback((value: WindowSize) => {
    live.current.size = value;
    setSizeState(value);
  }, []);
  const commit = useCallback(() => {
    const committedPosition = live.current.position;
    if (committedPosition) {
      setGeometry(entry.id, {
        position: committedPosition,
        size: live.current.size ?? undefined,
      });
    }
  }, [entry.id, setGeometry]);

  // A size committed elsewhere (a restored layout, a host call) wins.
  useEffect(() => {
    if (entry.size) {
      setSize(entry.size);
    }
  }, [entry.size, setSize]);

  return { commit, position, setPosition, setSize, size };
}

export function useWindowGeometry(
  entry: WindowEntry,
  maximized: boolean,
  windowRef: RefObject<HTMLDivElement | null>,
) {
  const { commit, position, setPosition, setSize, size } =
    useLiveGeometry(entry);
  const dragging = useRef<WindowDragState | null>(null);
  const resizing = useRef<WindowResizeState | null>(null);
  const clamp = useCallback(
    (x: number, y: number) => clampWindowPosition(windowRef.current, x, y),
    [windowRef],
  );

  // Lay the window out from its committed position, or from its viewport
  // starting point the first time, and commit where it actually landed.
  useEffect(() => {
    const element = windowRef.current;
    const container = element?.parentElement;
    if (!element || !container) {
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const start = entry.position ?? {
      x: entry.initialX - containerRect.left,
      y: entry.initialY - containerRect.top,
    };
    setPosition(clamp(start.x, start.y));
    commit();
  }, [
    clamp,
    commit,
    entry.initialX,
    entry.initialY,
    entry.position,
    setPosition,
    windowRef,
  ]);

  useWindowPointerTracking(
    windowRef,
    dragging,
    resizing,
    clamp,
    setPosition,
    setSize,
    commit,
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent) => {
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

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent, corner: ResizeCorner) => {
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
    handlePointerDown,
    handleResizePointerDown,
    position,
    size,
  };
}
