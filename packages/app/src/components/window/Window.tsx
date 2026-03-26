import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import "./Window.css";
import { WindowBody } from "./WindowBody";
import { WindowTitleBar } from "./WindowTitleBar";

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
  const [maximized, setMaximized] = useState(false);
  const dragging = useRef<{ offsetX: number; offsetY: number } | null>(null);

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

  const handleMaximize = useCallback(() => {
    setMaximized((prev) => !prev);
  }, []);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!dragging.current) return;
      const rawX = e.clientX - dragging.current.offsetX;
      const rawY = e.clientY - dragging.current.offsetY;
      setPosition(clamp(rawX, rawY));
    }
    function handleMouseUp() {
      dragging.current = null;
    }
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [clamp]);

  return (
    <div
      ref={windowRef}
      className={maximized ? "window window--maximized" : "window"}
      style={
        maximized
          ? undefined
          : position
            ? { left: position.x, top: position.y }
            : { visibility: "hidden" }
      }
    >
      <WindowTitleBar
        title={title}
        onMouseDown={handleMouseDown}
        onMaximize={handleMaximize}
        onClose={onClose}
      />
      <WindowBody>{children}</WindowBody>
    </div>
  );
}
