import {
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import "./SidebarResize.css";
import {
  MIN_SIDEBAR_WIDTH as MIN_WIDTH,
  UNMEASURED_MAX_SIDEBAR_WIDTH,
  useSidebarWidthBounds,
} from "./useSidebarWidthBounds";

const KEYBOARD_RESIZE_STEP = 10;

interface DragState {
  pointerId: number;
  startWidth: number;
  startX: number;
}

function clampSidebarWidth(width: number, maxWidth: number) {
  return Math.min(maxWidth, Math.max(MIN_WIDTH, width));
}

function useSidebarDragEffect({
  active,
  draggingRef,
  endDrag,
  maxWidthRef,
  setWidth,
}: {
  active: boolean;
  draggingRef: RefObject<DragState | null>;
  endDrag: () => void;
  maxWidthRef: RefObject<number>;
  setWidth: Dispatch<SetStateAction<number | null>>;
}) {
  useEffect(() => {
    if (!active) {
      return;
    }

    function handlePointerMove(event: PointerEvent) {
      const dragState = draggingRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      const dx = event.clientX - dragState.startX;
      setWidth(
        clampSidebarWidth(dragState.startWidth + dx, maxWidthRef.current),
      );
    }

    function handlePointerEnd(event: PointerEvent) {
      if (event.pointerId === draggingRef.current?.pointerId) {
        endDrag();
      }
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerEnd);
    document.addEventListener("pointercancel", handlePointerEnd);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerEnd);
      document.removeEventListener("pointercancel", handlePointerEnd);
      endDrag();
    };
  }, [active, draggingRef, endDrag, maxWidthRef, setWidth]);
}

export function useSidebarResize({
  defaultWidth,
  initialWidth = defaultWidth,
  getResizeContainer,
}: {
  defaultWidth: number;
  initialWidth?: number | null;
  /** The element spanning the sidebar and content, excluding any launcher rail. */
  getResizeContainer?: (sidebar: HTMLElement) => HTMLElement | null;
}) {
  const [width, setWidth] = useState<number | null>(initialWidth);
  const [isDragging, setIsDragging] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<DragState | null>(null);
  const { maxWidth, maxWidthRef } = useSidebarWidthBounds(
    sidebarRef,
    getResizeContainer,
  );

  const readCurrentWidth = useCallback(() => {
    if (width !== null) {
      return clampSidebarWidth(width, maxWidth);
    }

    const measuredWidth = sidebarRef.current?.getBoundingClientRect().width;
    return measuredWidth && measuredWidth > 0
      ? clampSidebarWidth(measuredWidth, maxWidth)
      : clampSidebarWidth(defaultWidth, maxWidth);
  }, [defaultWidth, maxWidth, width]);

  const endDrag = useCallback(() => {
    if (!draggingRef.current) {
      return;
    }

    draggingRef.current = null;
    setIsDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useSidebarDragEffect({
    active: isDragging,
    draggingRef,
    endDrag,
    maxWidthRef,
    setWidth,
  });

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLHRElement>) => {
      if (event.button !== 0 || !event.isPrimary) {
        return;
      }

      event.preventDefault();
      const startWidth = readCurrentWidth();
      draggingRef.current = {
        pointerId: event.pointerId,
        startWidth,
        startX: event.clientX,
      };
      setWidth(startWidth);
      setIsDragging(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [readCurrentWidth],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLHRElement>) => {
      if (event.key === "Home") {
        event.preventDefault();
        setWidth(MIN_WIDTH);
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        setWidth(maxWidth);
        return;
      }

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }

      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const multiplier = event.shiftKey ? 5 : 1;
      setWidth(
        clampSidebarWidth(
          readCurrentWidth() + direction * KEYBOARD_RESIZE_STEP * multiplier,
          maxWidth,
        ),
      );
    },
    [maxWidth, readCurrentWidth],
  );

  return {
    handleKeyDown,
    handlePointerDown,
    maxWidth,
    resolvedWidth: readCurrentWidth(),
    sidebarRef,
    width: width === null ? null : clampSidebarWidth(width, maxWidth),
  };
}

export function SidebarResizeHandle({
  className,
  controls,
  currentWidth,
  maxWidth = UNMEASURED_MAX_SIDEBAR_WIDTH,
  onKeyDown,
  onPointerDown,
}: {
  className: string;
  controls?: string | undefined;
  currentWidth: number;
  maxWidth?: number;
  onKeyDown: (event: ReactKeyboardEvent<HTMLHRElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLHRElement>) => void;
}) {
  return (
    <hr
      aria-controls={controls}
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-valuemax={maxWidth}
      aria-valuemin={MIN_WIDTH}
      aria-valuenow={currentWidth}
      className={`sidebar-resize-handle ${className}`}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      tabIndex={0}
    />
  );
}
