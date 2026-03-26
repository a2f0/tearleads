export function WindowTitleBar({
  title,
  onMouseDown,
  onClose,
}: {
  title: string;
  onMouseDown: (e: React.MouseEvent) => void;
  onClose: () => void;
}) {
  return (
    <div role="toolbar" className="window-titlebar" onMouseDown={onMouseDown}>
      <span>{title}</span>
      <button type="button" className="window-close" onClick={onClose}>
        &times;
      </button>
    </div>
  );
}
