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
  pointerId: number;
}

interface WindowResizeState {
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
function clampWindowPosition(
  element: HTMLDivElement | null,
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
  setSize: (value: WindowSize | null) => void,
  commit: () => void,
) {
  useEffect(() => {
    // Only the pointer that started a gesture drives it, so a second finger
    // cannot move the window or end the drag.
    function isGesturePointer(event: PointerEvent) {
      const gesture = resizing.current ?? dragging.current;
      return gesture !== null && gesture.pointerId === event.pointerId;
    }

    function handlePointerMove(event: PointerEvent) {
      if (!isGesturePointer(event)) {
        return;
      }
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

    function handlePointerEnd(event: PointerEvent) {
      if (!isGesturePointer(event)) {
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
  const setSize = useCallback((value: WindowSize | null) => {
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

  // The committed size is the source of truth between gestures: a restored
  // layout or host call applies it, and clearing it restores the default size.
  useEffect(() => {
    setSize(entry.size ?? null);
  }, [entry.size, setSize]);

  return { commit, live, position, setPosition, setSize, size };
}

// Stepwise geometry for keyboard move and resize. Steps stay local until the
// caller commits, like a pointer gesture; restore puts a snapshot back.
function useSteppedGeometry(
  windowRef: RefObject<HTMLDivElement | null>,
  maximized: boolean,
  live: MutableRefObject<LiveGeometry>,
  clamp: (x: number, y: number) => WindowPosition,
  setPosition: (value: WindowPosition) => void,
  setSize: (value: WindowSize | null) => void,
) {
  const nudge = useCallback(
    (deltaX: number, deltaY: number) => {
      const current = live.current.position;
      if (!current || maximized) {
        return;
      }
      setPosition(clamp(current.x + deltaX, current.y + deltaY));
    },
    [clamp, live, maximized, setPosition],
  );

  const grow = useCallback(
    (deltaWidth: number, deltaHeight: number) => {
      const element = windowRef.current;
      const current = live.current.position;
      if (!element || !current || maximized) {
        return;
      }
      const base = live.current.size ?? {
        height: element.offsetHeight,
        width: element.offsetWidth,
      };
      const container = element.parentElement;
      const maxWidth = container
        ? container.clientWidth - current.x
        : Number.POSITIVE_INFINITY;
      const maxHeight = container
        ? container.clientHeight - current.y
        : Number.POSITIVE_INFINITY;
      setSize({
        height: Math.max(
          MIN_HEIGHT,
          Math.min(base.height + deltaHeight, maxHeight),
        ),
        width: Math.max(MIN_WIDTH, Math.min(base.width + deltaWidth, maxWidth)),
      });
    },
    [live, maximized, setSize, windowRef],
  );

  const snapshot = useCallback(
    (): LiveGeometry => ({ ...live.current }),
    [live],
  );
  const restore = useCallback(
    (saved: LiveGeometry) => {
      if (saved.position) {
        setPosition(saved.position);
      }
      setSize(saved.size);
    },
    [setPosition, setSize],
  );

  return { grow, nudge, restore, snapshot };
}

// Starts a drag from the title bar or a resize from a corner. The gesture
// itself is tracked on the document by useWindowPointerTracking.
function useGestureStarts(
  windowRef: RefObject<HTMLDivElement | null>,
  maximized: boolean,
  position: WindowPosition | null,
  dragging: MutableRefObject<WindowDragState | null>,
  resizing: MutableRefObject<WindowResizeState | null>,
) {
  const handlePointerDown = useCallback(
    (event: ReactPointerEvent) => {
      // One gesture at a time: a second pointer pressing the title bar or a
      // corner mid-gesture must not take it over.
      if (!position || maximized || dragging.current || resizing.current) {
        return;
      }
      dragging.current = {
        offsetX: event.clientX - position.x,
        offsetY: event.clientY - position.y,
        pointerId: event.pointerId,
      };
    },
    [dragging, maximized, position, resizing],
  );

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent, corner: ResizeCorner) => {
      if (
        maximized ||
        !position ||
        !windowRef.current ||
        dragging.current ||
        resizing.current
      ) {
        return;
      }
      event.stopPropagation();
      const el = windowRef.current;
      const computed = getComputedStyle(el);
      const borderBox = computed.boxSizing === "border-box";
      resizing.current = {
        corner,
        pointerId: event.pointerId,
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

  return { handlePointerDown, handleResizePointerDown };
}

interface WindowLayoutInput {
  clamp: (x: number, y: number) => WindowPosition;
  commit: () => void;
  dragging: MutableRefObject<WindowDragState | null>;
  entry: WindowEntry;
  live: MutableRefObject<LiveGeometry>;
  resizing: MutableRefObject<WindowResizeState | null>;
  setPosition: (value: WindowPosition) => void;
  size: WindowSize | null;
  windowRef: RefObject<HTMLDivElement | null>;
}

function useWindowLayout({
  clamp,
  commit,
  dragging,
  entry,
  live,
  resizing,
  setPosition,
  size,
  windowRef,
}: WindowLayoutInput) {
  // Lay the window out from its committed position, or from its viewport
  // starting point the first time, and commit where it actually landed. A
  // minimized window has no element to measure, and a maximized one measures
  // at full size, so this waits out both and runs again once the window shows
  // at its normal geometry, picking up anything committed in the meantime.
  useEffect(() => {
    const element = windowRef.current;
    const container = element?.parentElement;
    if (entry.minimized || entry.maximized || !element || !container) {
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
    entry.maximized,
    entry.minimized,
    entry.position,
    setPosition,
    windowRef,
  ]);

  // Once the window renders at a new size, including a cleared size falling
  // back to its stylesheet default, keep it inside the surface.
  useEffect(() => {
    const current = live.current.position;
    if (!current || entry.maximized || dragging.current || resizing.current) {
      return;
    }
    const clamped = clampWindowPosition(
      windowRef.current,
      current.x,
      current.y,
      size,
    );
    if (clamped.x !== current.x || clamped.y !== current.y) {
      setPosition(clamped);
      commit();
    }
  }, [
    commit,
    dragging,
    entry.maximized,
    live,
    resizing,
    setPosition,
    size,
    windowRef,
  ]);
}

export function useWindowGeometry(
  entry: WindowEntry,
  maximized: boolean,
  windowRef: RefObject<HTMLDivElement | null>,
) {
  const { commit, live, position, setPosition, setSize, size } =
    useLiveGeometry(entry);
  const dragging = useRef<WindowDragState | null>(null);
  const resizing = useRef<WindowResizeState | null>(null);
  const clamp = useCallback(
    (x: number, y: number) =>
      clampWindowPosition(windowRef.current, x, y, live.current.size),
    [live, windowRef],
  );

  useWindowLayout({
    clamp,
    commit,
    dragging,
    entry,
    live,
    resizing,
    setPosition,
    size,
    windowRef,
  });

  useWindowPointerTracking(
    windowRef,
    dragging,
    resizing,
    clamp,
    setPosition,
    setSize,
    commit,
  );

  const { handlePointerDown, handleResizePointerDown } = useGestureStarts(
    windowRef,
    maximized,
    position,
    dragging,
    resizing,
  );

  const stepped = useSteppedGeometry(
    windowRef,
    maximized,
    live,
    clamp,
    setPosition,
    setSize,
  );

  return {
    ...stepped,
    commit,
    handlePointerDown,
    handleResizePointerDown,
    position,
    size,
  };
}
