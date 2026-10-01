import {
  type MutableRefObject,
  type RefObject,
  useCallback,
  useEffect,
} from "react";
import type {
  WindowEntry,
  WindowPosition,
  WindowSize,
} from "./WindowStateProvider";
import {
  clampWindowPosition,
  type LiveGeometry,
  type WindowDragState,
  type WindowResizeState,
} from "./windowGeometry";

interface WindowLayoutInput {
  clamp: (x: number, y: number) => WindowPosition;
  commit: () => void;
  dragging: MutableRefObject<WindowDragState | null>;
  entry: WindowEntry;
  live: MutableRefObject<LiveGeometry>;
  resizing: MutableRefObject<WindowResizeState | null>;
  setPosition: (value: WindowPosition) => void;
  size: WindowSize | null;
  windowRef: RefObject<HTMLElement | null>;
}

// A surface with no size is hidden (display: none), so nothing measured
// against it is meaningful.
function isUnsized(container: HTMLElement) {
  return container.clientWidth === 0 && container.clientHeight === 0;
}

export function useWindowLayout({
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
  // minimized window has no element to measure and a maximized one measures at
  // full size, so this waits both out. A hidden surface (an inactive
  // workspace) measures at zero: the window takes its intended position
  // unclamped and nothing is committed until the surface has a size.
  const layout = useCallback(() => {
    const element = windowRef.current;
    const container = element?.parentElement;
    if (entry.minimized || entry.maximized || !element || !container) {
      return;
    }
    if (!live.current.size) {
      // A cleared size has not re-rendered yet; drop the old inline size so the
      // window measures at the stylesheet default it is about to take.
      element.style.removeProperty("width");
      element.style.removeProperty("height");
    }
    const containerRect = container.getBoundingClientRect();
    const start = entry.position ?? {
      x: entry.initialX - containerRect.left,
      y: entry.initialY - containerRect.top,
    };
    if (isUnsized(container)) {
      setPosition(start);
      return;
    }
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
    live,
    setPosition,
    windowRef,
  ]);

  useEffect(() => {
    layout();
  }, [layout]);

  // The surface changing size (a workspace shown after being hidden, a resized
  // viewport) lays the window out again.
  useEffect(() => {
    const container = windowRef.current?.parentElement;
    if (
      entry.minimized ||
      !container ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }
    const observer = new ResizeObserver(() => layout());
    observer.observe(container);
    return () => observer.disconnect();
  }, [entry.minimized, layout, windowRef]);

  // Once the window renders at a new size, including a cleared size falling
  // back to its stylesheet default, keep it inside the surface.
  useEffect(() => {
    const current = live.current.position;
    const container = windowRef.current?.parentElement;
    if (
      !current ||
      entry.maximized ||
      dragging.current ||
      resizing.current ||
      !container ||
      isUnsized(container)
    ) {
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
