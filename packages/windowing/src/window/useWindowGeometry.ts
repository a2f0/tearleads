import {
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useWindowLayout } from "./useWindowLayout";
import type { ResizeCorner } from "./WindowResizeHandle";
import {
  useWindowActions,
  type WindowEntry,
  type WindowPosition,
  type WindowSize,
} from "./WindowStateProvider";
import {
  clampWindowPosition,
  type LiveGeometry,
  MIN_HEIGHT,
  MIN_WIDTH,
  resizeWindowWithinContainer,
  type WindowDragState,
  type WindowResizeState,
} from "./windowGeometry";

// Pointer events cover mouse, touch, and pen alike. The live geometry stays in
// component state while a gesture runs, so only this window re-renders per
// frame; the gesture's end commits it to the shared window state once.
function useWindowPointerTracking(
  windowRef: RefObject<HTMLElement | null>,
  dragging: MutableRefObject<WindowDragState | null>,
  resizing: MutableRefObject<WindowResizeState | null>,
  clamp: (x: number, y: number) => WindowPosition,
  setPosition: (value: WindowPosition) => void,
  setSize: (value: WindowSize | null) => void,
  finish: () => void,
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
      finish();
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerEnd);
    document.addEventListener("pointercancel", handlePointerEnd);
    document.addEventListener("lostpointercapture", handlePointerEnd);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerEnd);
      document.removeEventListener("pointercancel", handlePointerEnd);
      document.removeEventListener("lostpointercapture", handlePointerEnd);
    };
  }, [clamp, dragging, finish, resizing, setPosition, setSize, windowRef]);
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
  windowRef: RefObject<HTMLElement | null>,
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
      // Step from the size on screen: a requested size below the stylesheet
      // minimums renders at the minimum, so growing from it would show nothing.
      const requested = live.current.size;
      const base = requested
        ? {
            height: Math.max(MIN_HEIGHT, requested.height),
            width: Math.max(MIN_WIDTH, requested.width),
          }
        : { height: element.offsetHeight, width: element.offsetWidth };
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

// Keeps a gesture's pointer events coming to the window even when the pointer
// passes over an iframe, whose document would otherwise swallow the release.
// Synthetic events carry no active pointer, so a failed capture is fine.
function capturePointer(event: ReactPointerEvent) {
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    // Not an active pointer; the document listeners still track the gesture.
  }
}

// Starts a drag from the title bar or a resize from a corner. The gesture
// itself is tracked on the document by useWindowPointerTracking.
function useGestureStarts(
  windowRef: RefObject<HTMLElement | null>,
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
      capturePointer(event);
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
      capturePointer(event);
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

export function useWindowGeometry(
  entry: WindowEntry,
  maximized: boolean,
  windowRef: RefObject<HTMLElement | null>,
) {
  const { commit, live, position, setPosition, setSize, size } =
    useLiveGeometry(entry);
  const dragging = useRef<WindowDragState | null>(null);
  const resizing = useRef<WindowResizeState | null>(null);
  // Maximizing or minimizing mid-gesture (a second touch on the title bar's
  // controls) abandons the gesture: its frames were measured at the normal
  // size, and the committed geometry stays as it was.
  useEffect(() => {
    if (maximized || entry.minimized) {
      dragging.current = null;
      resizing.current = null;
    }
  }, [entry.minimized, maximized]);
  const clamp = useCallback(
    (x: number, y: number) =>
      clampWindowPosition(windowRef.current, x, y, live.current.size),
    [live, windowRef],
  );

  const { hold } = useWindowLayout({
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

  // A finished gesture commits its geometry, then runs any layout it held
  // off (a surface resize mid-gesture), even when the geometry did not change.
  const finishGesture = useCallback(() => {
    commit();
    hold(false);
  }, [commit, hold]);

  useWindowPointerTracking(
    windowRef,
    dragging,
    resizing,
    clamp,
    setPosition,
    setSize,
    finishGesture,
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
    hold,
    handlePointerDown,
    handleResizePointerDown,
    position,
    size,
  };
}
