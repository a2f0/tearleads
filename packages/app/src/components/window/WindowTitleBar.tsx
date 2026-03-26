import "./WindowTitleBar.css";
import { WindowCloseButton } from "./WindowCloseButton";
import { WindowMaximizeButton } from "./WindowMaximizeButton";

export function WindowTitleBar({
  title,
  onMouseDown,
  onMaximize,
  onClose,
}: {
  title: string;
  onMouseDown: (e: React.MouseEvent) => void;
  onMaximize: () => void;
  onClose: () => void;
}) {
  return (
    <div role="toolbar" className="window-titlebar" onMouseDown={onMouseDown}>
      <span>{title}</span>
      <div className="window-titlebar-buttons">
        <WindowMaximizeButton onClick={onMaximize} />
        <WindowCloseButton onClick={onClose} />
      </div>
    </div>
  );
}
