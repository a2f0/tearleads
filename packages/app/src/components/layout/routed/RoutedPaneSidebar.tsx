import {
  type Dispatch,
  type MutableRefObject,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { RoutedLayoutTier } from "../../../navigation/useRoutedLayoutTier";
import "./RoutedPaneSidebar.css";

const DEFAULT_WIDTH = 224;
const MIN_WIDTH = 80;
const MAX_WIDTH = 400;
const KEYBOARD_RESIZE_STEP = 10;

interface SidebarElementRef {
  readonly current: HTMLDivElement | null;
}

interface DragState {
  pointerId: number;
  startX: number;
  startWidth: number;
}

function clampSidebarWidth(width: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}

function readSidebarWidth(sidebarRef: SidebarElementRef) {
  const measuredWidth = sidebarRef.current?.getBoundingClientRect().width;
  return measuredWidth && measuredWidth > 0
    ? clampSidebarWidth(measuredWidth)
    : DEFAULT_WIDTH;
}

function useRoutedSidebarDragEffect({
  active,
  dragging,
  endDrag,
  setWidth,
}: {
  active: boolean;
  dragging: MutableRefObject<DragState | null>;
  endDrag: () => void;
  setWidth: Dispatch<SetStateAction<number | null>>;
}) {
  useEffect(() => {
    if (!active) {
      return;
    }

    function handlePointerMove(event: PointerEvent) {
      const dragState = dragging.current;
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      const dx = event.clientX - dragState.startX;
      setWidth(clampSidebarWidth(dragState.startWidth + dx));
    }

    function handlePointerEnd(event: PointerEvent) {
      const dragState = dragging.current;
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      endDrag();
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
  }, [active, dragging, endDrag, setWidth]);
}

function useRoutedSidebarKeyboardResize({
  sidebarRef,
  setWidth,
}: {
  sidebarRef: SidebarElementRef;
  setWidth: Dispatch<SetStateAction<number | null>>;
}) {
  return useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === "Home") {
        event.preventDefault();
        setWidth(MIN_WIDTH);
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        setWidth(MAX_WIDTH);
        return;
      }

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }

      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const multiplier = event.shiftKey ? 5 : 1;
      setWidth((currentWidth) =>
        clampSidebarWidth(
          (currentWidth ?? readSidebarWidth(sidebarRef)) +
            direction * KEYBOARD_RESIZE_STEP * multiplier,
        ),
      );
    },
    [sidebarRef, setWidth],
  );
}

function useRoutedSidebarResize() {
  const [width, setWidth] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<DragState | null>(null);

  const currentWidth = useCallback(() => {
    return width ?? readSidebarWidth(sidebarRef);
  }, [width, sidebarRef]);

  const endDrag = useCallback(() => {
    if (!dragging.current) {
      return;
    }

    dragging.current = null;
    setIsDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useRoutedSidebarDragEffect({
    active: isDragging,
    dragging,
    endDrag,
    setWidth,
  });

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      const startWidth = readSidebarWidth(sidebarRef);
      dragging.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth,
      };
      setWidth(startWidth);
      setIsDragging(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [sidebarRef],
  );

  const handleKeyDown = useRoutedSidebarKeyboardResize({
    sidebarRef,
    setWidth,
  });

  return {
    handleKeyDown,
    handlePointerDown,
    resolvedWidth: currentWidth(),
    sidebarRef,
    width,
  };
}

function RoutedPaneMobileSidebar({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <>
      <button
        aria-label="Close sidebar"
        className="routed-pane-scrim"
        type="button"
        onClick={onClose}
      />
      <div
        className="routed-pane-sidebar"
        id="routed-pane-sidebar"
        role="dialog"
      >
        {children}
      </div>
    </>
  );
}

function RoutedPaneTabletSidebar({ children }: { children: ReactNode }) {
  const { handleKeyDown, handlePointerDown, resolvedWidth, sidebarRef, width } =
    useRoutedSidebarResize();

  return (
    <div className="routed-pane-sidebar-frame">
      <div
        className="routed-pane-sidebar"
        id="routed-pane-sidebar"
        ref={sidebarRef}
        style={width === null ? undefined : { width }}
      >
        {children}
      </div>
      <hr
        aria-controls="routed-pane-sidebar"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-valuemax={MAX_WIDTH}
        aria-valuemin={MIN_WIDTH}
        aria-valuenow={resolvedWidth}
        className="routed-pane-sidebar-resize-handle"
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        tabIndex={0}
      />
    </div>
  );
}

export function RoutedPaneSidebar({
  children,
  onClose,
  tier,
}: {
  children: ReactNode;
  onClose: () => void;
  tier: RoutedLayoutTier;
}) {
  return tier === "mobile" ? (
    <RoutedPaneMobileSidebar onClose={onClose}>
      {children}
    </RoutedPaneMobileSidebar>
  ) : (
    <RoutedPaneTabletSidebar>{children}</RoutedPaneTabletSidebar>
  );
}
