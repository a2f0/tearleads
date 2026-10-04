import type { PointerEvent as ReactPointerEvent } from "react";
import "./WindowResizeHandle.css";

type ResizeCorner = "se" | "sw" | "ne" | "nw";
type ResizeSide = "n" | "e" | "s" | "w";

// The compass point a handle drags: a corner moves two edges, a side one.
export type ResizeEdge = ResizeCorner | ResizeSide;

type ResizePointerDown = (event: ReactPointerEvent, edge: ResizeEdge) => void;

// Sides first, so the corners paint over the ends of the sides and win where
// the two meet.
const RESIZE_EDGES: ReadonlyArray<ResizeEdge> = [
  "n",
  "e",
  "s",
  "w",
  "se",
  "sw",
  "ne",
  "nw",
];

function WindowResizeHandle({
  edge,
  onPointerDown,
}: {
  edge: ResizeEdge;
  onPointerDown: ResizePointerDown;
}) {
  return (
    <div
      role="none"
      className={`window-resize window-resize--${edge}`}
      onPointerDown={(event) => onPointerDown(event, edge)}
    />
  );
}

export function WindowResizeHandles({
  handleResizePointerDown,
}: {
  handleResizePointerDown: ResizePointerDown;
}) {
  return (
    <>
      {RESIZE_EDGES.map((edge) => (
        <WindowResizeHandle
          edge={edge}
          key={edge}
          onPointerDown={handleResizePointerDown}
        />
      ))}
    </>
  );
}
