import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import "./Window.css";
import { WindowBody } from "./WindowBody";
import { WindowMenuBar } from "./WindowMenuBar";
import type { ResizeCorner } from "./WindowResizeHandle";
import { WindowResizeHandle } from "./WindowResizeHandle";
import { useWindowState } from "./WindowStateProvider";
import { WindowStatusBar } from "./WindowStatusBar";
import { WindowTitleBar } from "./WindowTitleBar";

const MIN_WIDTH = 200;
const MIN_HEIGHT = 100;

interface WindowProps {
  title: string;
  initialX: number;
  initialY: number;
  onClose: () => void;
}

export function Window({
  title,
  initialX,
  initialY,
  onClose,
  children,
}: PropsWithChildren<WindowProps>) {
  const windowId = useId();
  const { windows, register, unregister, minimize } = useWindowState();
  const windowRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [size, setSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [maximized, setMaximized] = useState(false);
  const dragging = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const resizing = useRef<{
    corner: ResizeCorner;
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  const entry = windows.find((w) => w.id === windowId);
  const minimized = entry?.minimized ?? false;

  useEffect(() => {
    register(windowId, title);
    return () => unregister(windowId);
  }, [windowId, title, register, unregister]);

  // Constrain window position so it stays fully within its parent container.
  const clamp = useCallback((x: number, y: number) => {
    const el = windowRef.current;
    const container = el?.parentElement;
    if (!el || !container) return { x, y };
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const ew = el.offsetWidth;
    const eh = el.offsetHeight;
    return {
      x: Math.max(0, Math.min(x, cw - ew)),
      y: Math.max(0, Math.min(y, ch - eh)),
    };
  }, []);

  useEffect(() => {
    const el = windowRef.current;
    const container = el?.parentElement;
    if (!el || !container) return;
    const containerRect = container.getBoundingClientRect();
    const x = initialX - containerRect.left;
    const y = initialY - containerRect.top;
    setPosition(clamp(x, y));
  }, [initialX, initialY, clamp]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!position || maximized) return;
      dragging.current = {
        offsetX: e.clientX - position.x,
        offsetY: e.clientY - position.y,
      };
    },
    [position, maximized],
  );

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, corner: ResizeCorner) => {
      if (maximized) return;
      const el = windowRef.current;
      if (!el || !position) return;
      e.stopPropagation();
      resizing.current = {
        corner,
        startX: e.clientX,
        startY: e.clientY,
        startLeft: position.x,
        startTop: position.y,
        startWidth: el.offsetWidth,
        startHeight: el.offsetHeight,
      };
    },
    [position, maximized],
  );

  const handleMinimize = useCallback(() => {
    minimize(windowId);
  }, [minimize, windowId]);

  const handleMaximize = useCallback(() => {
    setMaximized((prev) => !prev);
  }, []);

  const [showStatusBar, setShowStatusBar] = useState(true);
  const toggleStatusBar = useCallback(() => {
    setShowStatusBar((prev) => !prev);
  }, []);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (resizing.current) {
        const r = resizing.current;
        const dx = e.clientX - r.startX;
        const dy = e.clientY - r.startY;

        const movesLeft = r.corner.includes("w");
        const movesUp = r.corner.includes("n");

        let newW = Math.max(
          MIN_WIDTH,
          r.startWidth + dx * (movesLeft ? -1 : 1),
        );
        let newH = Math.max(
          MIN_HEIGHT,
          r.startHeight + dy * (movesUp ? -1 : 1),
        );
        let newX = movesLeft ? r.startLeft + r.startWidth - newW : r.startLeft;
        let newY = movesUp ? r.startTop + r.startHeight - newH : r.startTop;

        const container = windowRef.current?.parentElement;
        if (container) {
          const cw = container.clientWidth;
          const ch = container.clientHeight;
          // Clamp position first, then recalculate size to keep
          // the opposite edge fixed when hitting container bounds.
          if (newX < 0) {
            newW += newX;
            newX = 0;
          }
          if (newY < 0) {
            newH += newY;
            newY = 0;
          }
          newW = Math.min(newW, cw - newX);
          newH = Math.min(newH, ch - newY);
          newW = Math.max(MIN_WIDTH, newW);
          newH = Math.max(MIN_HEIGHT, newH);
        }

        setPosition({ x: newX, y: newY });
        setSize({ width: newW, height: newH });
        return;
      }

      if (dragging.current) {
        const rawX = e.clientX - dragging.current.offsetX;
        const rawY = e.clientY - dragging.current.offsetY;
        setPosition(clamp(rawX, rawY));
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
  }, [clamp]);

  if (minimized) return null;

  const style: React.CSSProperties | undefined = maximized
    ? undefined
    : position
      ? {
          left: position.x,
          top: position.y,
          ...(size ? { width: size.width, height: size.height } : {}),
        }
      : { visibility: "hidden" };

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
        onClose={onClose}
      />
      <WindowMenuBar
        menus={[
          {
            label: "File",
            items: [{ label: "Close", onClick: onClose }],
          },
          {
            label: "View",
            items: [
              {
                label: `${showStatusBar ? "Hide" : "Show"} Status Bar`,
                onClick: toggleStatusBar,
              },
            ],
          },
        ]}
      />
      <WindowBody>{children}</WindowBody>
      {showStatusBar && <WindowStatusBar />}
      {!maximized && (
        <>
          <WindowResizeHandle corner="se" onMouseDown={handleResizeMouseDown} />
          <WindowResizeHandle corner="sw" onMouseDown={handleResizeMouseDown} />
          <WindowResizeHandle corner="ne" onMouseDown={handleResizeMouseDown} />
          <WindowResizeHandle corner="nw" onMouseDown={handleResizeMouseDown} />
        </>
      )}
    </div>
  );
}
