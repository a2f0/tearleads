import "./WindowTitleBar.css";
import { WindowCloseButton } from "./WindowCloseButton";
import { WindowMaximizeButton } from "./WindowMaximizeButton";
import { WindowMinimizeButton } from "./WindowMinimizeButton";

export function WindowTitleBar({
  title,
  onMouseDown,
  onMinimize,
  onMaximize,
  onClose,
}: {
  title: string;
  onMouseDown: (e: React.MouseEvent) => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
}) {
  return (
    <div role="toolbar" className="window-titlebar" onMouseDown={onMouseDown}>
      <span>{title}</span>
      <div className="window-titlebar-buttons">
        <WindowMinimizeButton onClick={onMinimize} />
        <WindowMaximizeButton onClick={onMaximize} />
        <WindowCloseButton onClick={onClose} />
      </div>
    </div>
  );
}
