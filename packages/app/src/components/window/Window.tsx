import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import "./Window.css";
import { WindowBody } from "./WindowBody";
import type { ResizeCorner } from "./WindowResizeHandle";
import { WindowResizeHandle } from "./WindowResizeHandle";
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

  const handleMaximize = useCallback(() => {
    setMaximized((prev) => !prev);
  }, []);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (resizing.current) {
        const r = resizing.current;
        const dx = e.clientX - r.startX;
        const dy = e.clientY - r.startY;

        let newX = r.startLeft;
        let newY = r.startTop;
        let newW = r.startWidth;
        let newH = r.startHeight;

        if (r.corner === "se") {
          newW = Math.max(MIN_WIDTH, r.startWidth + dx);
          newH = Math.max(MIN_HEIGHT, r.startHeight + dy);
        } else if (r.corner === "sw") {
          newW = Math.max(MIN_WIDTH, r.startWidth - dx);
          newH = Math.max(MIN_HEIGHT, r.startHeight + dy);
          newX = r.startLeft + r.startWidth - newW;
        } else if (r.corner === "ne") {
          newW = Math.max(MIN_WIDTH, r.startWidth + dx);
          newH = Math.max(MIN_HEIGHT, r.startHeight - dy);
          newY = r.startTop + r.startHeight - newH;
        } else if (r.corner === "nw") {
          newW = Math.max(MIN_WIDTH, r.startWidth - dx);
          newH = Math.max(MIN_HEIGHT, r.startHeight - dy);
          newX = r.startLeft + r.startWidth - newW;
          newY = r.startTop + r.startHeight - newH;
        }

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
        onMaximize={handleMaximize}
        onClose={onClose}
      />
      <WindowBody>{children}</WindowBody>
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
