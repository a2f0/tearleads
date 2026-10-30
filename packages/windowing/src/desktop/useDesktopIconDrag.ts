import { type PointerEvent, useRef, useState } from "react";
import type { DesktopIconPosition } from "./desktopState";

// A press becomes a drag once the pointer travels this far, so a slightly
// shaky click or double-click does not move the icon.
const DRAG_THRESHOLD_PX = 4;

interface DragStart {
  moved: boolean;
  origin: DesktopIconPosition;
  pointerId: number;
  startX: number;
  startY: number;
}

export interface DesktopIconSize {
  height: number;
  width: number;
}

/** Keeps a position on the surface, given the icon's rendered size. */
export type ClampDesktopIcon = (
  position: DesktopIconPosition,
  size: DesktopIconSize,
) => DesktopIconPosition;

function sizeOf(element: HTMLElement): DesktopIconSize {
  return { height: element.offsetHeight, width: element.offsetWidth };
}

/**
 * Moves an icon with any pointer: the primary press selects it and captures
 * the pointer, the icon follows once the pointer passes the drag threshold,
 * and the release commits where it landed. A cancelled gesture snaps back.
 */
export function useDesktopIconDrag({
  clamp,
  onMove,
  onSelect,
  position,
}: {
  clamp: ClampDesktopIcon;
  onMove: (position: DesktopIconPosition) => void;
  onSelect: () => void;
  position: DesktopIconPosition;
}) {
  const dragRef = useRef<DragStart | null>(null);
  const [dragPosition, setDragPosition] = useState<DesktopIconPosition | null>(
    null,
  );

  const dragTo = (event: PointerEvent<HTMLElement>, drag: DragStart) =>
    clamp(
      {
        x: Math.round(drag.origin.x + event.clientX - drag.startX),
        y: Math.round(drag.origin.y + event.clientY - drag.startY),
      },
      sizeOf(event.currentTarget),
    );

  const activeDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    return drag && drag.pointerId === event.pointerId ? drag : null;
  };

  const cancel = () => {
    dragRef.current = null;
    setDragPosition(null);
  };

  const handlers = {
    onLostPointerCapture: cancel,
    onPointerCancel: cancel,
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }
      onSelect();
      dragRef.current = {
        moved: false,
        origin: position,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const drag = activeDrag(event);
      if (!drag) {
        return;
      }
      const distance = Math.hypot(
        event.clientX - drag.startX,
        event.clientY - drag.startY,
      );
      if (!drag.moved && distance < DRAG_THRESHOLD_PX) {
        return;
      }
      drag.moved = true;
      setDragPosition(dragTo(event, drag));
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      const drag = activeDrag(event);
      if (!drag) {
        return;
      }
      cancel();
      if (drag.moved) {
        onMove(dragTo(event, drag));
      }
    },
  };

  return { dragPosition, handlers };
}
