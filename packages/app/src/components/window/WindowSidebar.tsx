import { type PropsWithChildren, useCallback, useEffect, useRef, useState } from "react";
import "./WindowSidebar.css";

const DEFAULT_WIDTH = 160;
const MIN_WIDTH = 80;
const MAX_WIDTH = 400;

export function WindowSidebar({
  sidebar,
  defaultWidth = DEFAULT_WIDTH,
  children,
}: PropsWithChildren<{
  sidebar: React.ReactNode;
  defaultWidth?: number;
}>) {
  const [width, setWidth] = useState(defaultWidth);
  const dragging = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = { startX: e.clientX, startWidth: width };
    },
    [width],
  );

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!dragging.current) return;
      const dx = e.clientX - dragging.current.startX;
      setWidth(
        Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragging.current.startWidth + dx)),
      );
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
  }, []);

  return (
    <div className="window-sidebar-layout">
      <div className="window-sidebar" style={{ width }}>
        {sidebar}
      </div>
      <div
        role="separator"
        className="window-sidebar-handle"
        onMouseDown={handleMouseDown}
      />
      <div className="window-sidebar-content">{children}</div>
    </div>
  );
}
