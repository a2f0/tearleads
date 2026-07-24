import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const MOBILE_SHEET_DISMISS_THRESHOLD_PX = 80;
const MOBILE_SHEET_CLICK_SLOP_PX = 4;

interface MobileSheetDragState {
  pointerId: number;
  startY: number;
  travel: number;
  offsetY: number;
}

export function useMobileSheetDrag({
  drawerOpen,
  onClose,
}: {
  drawerOpen: boolean;
  onClose: () => void;
}) {
  const dragState = useRef<MobileSheetDragState | null>(null);
  const suppressNextClick = useRef(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!drawerOpen) {
      dragState.current = null;
      setDragOffset(0);
      setDragging(false);
      return;
    }

    function handlePointerMove(event: PointerEvent) {
      const state = dragState.current;
      if (!state || event.pointerId !== state.pointerId) {
        return;
      }

      const travel = Math.abs(event.clientY - state.startY);
      state.travel = Math.max(state.travel, travel);
      state.offsetY = Math.max(0, event.clientY - state.startY);
      setDragOffset(state.offsetY);
    }

    function handlePointerEnd(event: PointerEvent, suppressClick: boolean) {
      const state = dragState.current;
      if (!state || event.pointerId !== state.pointerId) {
        return;
      }

      dragState.current = null;
      setDragging(false);
      suppressNextClick.current =
        suppressClick && state.travel >= MOBILE_SHEET_CLICK_SLOP_PX;
      if (state.offsetY >= MOBILE_SHEET_DISMISS_THRESHOLD_PX) {
        onClose();
      }
      setDragOffset(0);
    }

    document.addEventListener("pointermove", handlePointerMove);
    const handlePointerUp = (event: PointerEvent) =>
      handlePointerEnd(event, true);
    const handlePointerCancel = (event: PointerEvent) =>
      handlePointerEnd(event, false);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [drawerOpen, onClose]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }
      if (dragState.current) {
        return;
      }

      event.preventDefault();
      suppressNextClick.current = false;
      dragState.current = {
        offsetY: 0,
        pointerId: event.pointerId,
        startY: event.clientY,
        travel: 0,
      };
      setDragging(true);
    },
    [],
  );

  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (suppressNextClick.current) {
        suppressNextClick.current = false;
        event.preventDefault();
        return;
      }

      onClose();
    },
    [onClose],
  );

  return {
    dragOffset,
    dragging,
    handleClick,
    handlePointerDown,
  };
}
