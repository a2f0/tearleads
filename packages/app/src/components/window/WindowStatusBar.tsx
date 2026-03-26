import "./WindowStatusBar.css";

export function WindowStatusBar({ text }: { text?: string }) {
  return <div className="window-statusbar">{text}</div>;
}
