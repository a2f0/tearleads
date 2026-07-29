import {
  type PropsWithChildren,
  type Ref,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import "./WindowSidebar.css";

const DEFAULT_WIDTH = 160;
const MIN_WIDTH = 80;
const MAX_WIDTH = 400;
const KEYBOARD_RESIZE_STEP = 10;

function clampSidebarWidth(width: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}

export function WindowSidebar({
  contentRef,
  defaultWidth = DEFAULT_WIDTH,
  sidebar,
  children,
}: PropsWithChildren<{
  contentRef?: Ref<HTMLDivElement> | undefined;
  defaultWidth?: number;
  sidebar?: React.ReactNode;
}>) {
  const [width, setWidth] = useState(defaultWidth);
  const dragging = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = { startX: e.clientX, startWidth: width };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width],
  );

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!dragging.current) return;
      const dx = e.clientX - dragging.current.startX;
      setWidth(clampSidebarWidth(dragging.current.startWidth + dx));
    }

    function handleMouseUp() {
      if (!dragging.current) return;
      dragging.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      handleMouseUp();
    };
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Home") {
      e.preventDefault();
      setWidth(MIN_WIDTH);
      return;
    }

    if (e.key === "End") {
      e.preventDefault();
      setWidth(MAX_WIDTH);
      return;
    }

    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;

    e.preventDefault();
    const direction = e.key === "ArrowLeft" ? -1 : 1;
    const multiplier = e.shiftKey ? 5 : 1;
    setWidth((currentWidth) =>
      clampSidebarWidth(
        currentWidth + direction * KEYBOARD_RESIZE_STEP * multiplier,
      ),
    );
  }, []);

  return (
    <div className="window-sidebar-layout">
      <div className="window-sidebar" style={{ width }}>
        {sidebar}
      </div>
      <hr
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-valuemax={MAX_WIDTH}
        aria-valuemin={MIN_WIDTH}
        aria-valuenow={width}
        className="window-sidebar-handle"
        onKeyDown={handleKeyDown}
        onMouseDown={handleMouseDown}
        tabIndex={0}
      />
      {/* Focusable only to script, like `.window-body-content`: the overlay host
          is where focus lands when an overlay outlives the control that opened it. */}
      <div className="window-sidebar-content" ref={contentRef} tabIndex={-1}>
        <div className="window-sidebar-content-scroll">{children}</div>
      </div>
    </div>
  );
}
