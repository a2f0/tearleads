import "./WindowResizeHandle.css";

export type ResizeCorner = "se" | "sw" | "ne" | "nw";

export function WindowResizeHandle({
  corner,
  onMouseDown,
}: {
  corner: ResizeCorner;
  onMouseDown: (e: React.MouseEvent, corner: ResizeCorner) => void;
}) {
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-valuenow={0}
      className={`window-resize window-resize--${corner}`}
      onMouseDown={(e) => onMouseDown(e, corner)}
    />
  );
}
