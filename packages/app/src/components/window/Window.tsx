import {
  type CSSProperties,
  type PropsWithChildren,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./Window.css";
import { WindowBody } from "./WindowBody";
import { WindowMenuBar } from "./WindowMenuBar";
import type { ResizeCorner } from "./WindowResizeHandle";
import { WindowResizeHandle } from "./WindowResizeHandle";
import {
  useWindowSidebar,
  WindowSidebarProvider,
} from "./WindowSidebarContext";
import {
  useWindowActions as useWindowStateActions,
  useWindowStateData,
  type WindowEntry,
} from "./WindowStateProvider";
import { WindowStatusBar } from "./WindowStatusBar";
import { WindowTitleBar } from "./WindowTitleBar";

const MIN_WIDTH = 200;
const MIN_HEIGHT = 100;

interface WindowProps {
  windowId: string;
}

interface WindowInnerProps {
  bringToFront: (id: string) => void;
  close: (id: string) => void;
  entry: WindowEntry;
  minimize: (id: string) => void;
  moveBackward: (id: string) => void;
  moveForward: (id: string) => void;
}

interface WindowPosition {
  x: number;
  y: number;
}

interface WindowSize {
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

export function Window({ windowId }: WindowProps) {
  const { close, minimize, moveForward, moveBackward, bringToFront } =
    useWindowStateActions();
  const { windowMap } = useWindowStateData();
  const entry = windowMap.get(windowId);

  if (!entry) return null;

  return (
    <WindowInner
      entry={entry}
      close={close}
      minimize={minimize}
      moveForward={moveForward}
      moveBackward={moveBackward}
      bringToFront={bringToFront}
    />
  );
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

function useWindowGeometry(
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

function useWindowActions(
  entry: WindowEntry,
  bringToFront: (id: string) => void,
  close: (id: string) => void,
  minimize: (id: string) => void,
  moveBackward: (id: string) => void,
  moveForward: (id: string) => void,
) {
  const [maximized, setMaximized] = useState(false);
  const [showStatusBar, setShowStatusBar] = useState(true);
  const [showSidebar, setShowSidebar] = useState(true);
  const handleClose = useCallback(() => close(entry.id), [close, entry.id]);
  const handleMinimize = useCallback(
    () => minimize(entry.id),
    [entry.id, minimize],
  );
  const handleMoveForward = useCallback(
    () => moveForward(entry.id),
    [entry.id, moveForward],
  );
  const handleMoveBackward = useCallback(
    () => moveBackward(entry.id),
    [entry.id, moveBackward],
  );
  const handleMaximize = useCallback(() => {
    if (!maximized) {
      bringToFront(entry.id);
    }
    setMaximized((previous) => !previous);
  }, [bringToFront, entry.id, maximized]);
  const toggleStatusBar = useCallback(
    () => setShowStatusBar((previous) => !previous),
    [],
  );
  const toggleSidebar = useCallback(
    () => setShowSidebar((previous) => !previous),
    [],
  );
  const menus = useMemo(
    () => [
      {
        label: "File",
        items: [{ label: "Close", onClick: handleClose }],
      },
      {
        label: "View",
        items: [
          {
            label: `${showStatusBar ? "Hide" : "Show"} Status Bar`,
            onClick: toggleStatusBar,
          },
          {
            label: `${showSidebar ? "Hide" : "Show"} Sidebar`,
            onClick: toggleSidebar,
          },
        ],
      },
    ],
    [handleClose, showSidebar, showStatusBar, toggleSidebar, toggleStatusBar],
  );

  return {
    handleClose,
    handleMaximize,
    handleMinimize,
    handleMoveBackward,
    handleMoveForward,
    maximized,
    menus,
    showSidebar,
    showStatusBar,
  };
}

function getWindowStyle(
  maximized: boolean,
  position: WindowPosition | null,
  size: WindowSize | null,
  zIndex: number,
): CSSProperties | undefined {
  if (maximized) {
    return { top: 0, left: 0, width: "100%", height: "100%", zIndex };
  }
  if (!position) {
    return { visibility: "hidden", zIndex };
  }

  return {
    left: position.x,
    top: position.y,
    zIndex,
    ...(size ? { width: size.width, height: size.height } : {}),
  };
}

function WindowResizeHandles({
  handleResizeMouseDown,
}: {
  handleResizeMouseDown: (event: ReactMouseEvent, corner: ResizeCorner) => void;
}) {
  return (
    <>
      <WindowResizeHandle corner="se" onMouseDown={handleResizeMouseDown} />
      <WindowResizeHandle corner="sw" onMouseDown={handleResizeMouseDown} />
      <WindowResizeHandle corner="ne" onMouseDown={handleResizeMouseDown} />
      <WindowResizeHandle corner="nw" onMouseDown={handleResizeMouseDown} />
    </>
  );
}

function WindowInner({
  entry,
  close,
  minimize,
  moveForward,
  moveBackward,
  bringToFront,
}: WindowInnerProps) {
  const { title, minimized, zIndex, component: Component } = entry;
  const windowRef = useRef<HTMLDivElement>(null);
  const {
    handleClose,
    handleMaximize,
    handleMinimize,
    handleMoveBackward,
    handleMoveForward,
    maximized,
    menus,
    showSidebar,
    showStatusBar,
  } = useWindowActions(
    entry,
    bringToFront,
    close,
    minimize,
    moveBackward,
    moveForward,
  );
  const { handleMouseDown, handleResizeMouseDown, position, size } =
    useWindowGeometry(entry, maximized, windowRef);
  const style = getWindowStyle(maximized, position, size, zIndex);

  if (minimized) {
    return null;
  }

  return (
    <div
      ref={windowRef}
      className={maximized ? "window window--maximized" : "window"}
      style={style}
    >
      <WindowTitleBar
        title={title}
        onMouseDown={handleMouseDown}
        onMinimize={handleMinimize}
        onMaximize={handleMaximize}
        onClose={handleClose}
        onMoveForward={handleMoveForward}
        onMoveBackward={handleMoveBackward}
      />
      <WindowMenuBar menus={menus} />
      <WindowSidebarProvider>
        <WindowBodyWithSidebar showSidebar={showSidebar}>
          {Component && <Component />}
        </WindowBodyWithSidebar>
      </WindowSidebarProvider>
      {showStatusBar && <WindowStatusBar />}
      {!maximized && (
        <WindowResizeHandles handleResizeMouseDown={handleResizeMouseDown} />
      )}
    </div>
  );
}

function WindowBodyWithSidebar({
  showSidebar,
  children,
}: PropsWithChildren<{ showSidebar: boolean }>) {
  const { sidebar } = useWindowSidebar();
  return (
    <WindowBody showSidebar={showSidebar} sidebar={sidebar}>
      {children}
    </WindowBody>
  );
}
