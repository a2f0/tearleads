import "./WindowResizeHandle.css";

export type ResizeCorner = "se" | "sw" | "ne" | "nw";

export function WindowResizeHandle({
  corner,
  onPointerDown,
}: {
  corner: ResizeCorner;
  onPointerDown: (e: React.PointerEvent, corner: ResizeCorner) => void;
}) {
  return (
    <div
      role="none"
      className={`window-resize window-resize--${corner}`}
      onPointerDown={(e) => onPointerDown(e, corner)}
    />
  );
}
