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
      role="none"
      className={`window-resize window-resize--${corner}`}
      onMouseDown={(e) => onMouseDown(e, corner)}
    />
  );
}
