import "./WindowStatusBar.css";

export function WindowStatusBar({ text }: { text?: string }) {
  /*
   * The live region stays mounted while the visible bar collapses. A `role="status"`
   * region only announces when text changes on an element already in the DOM, so
   * mounting the region together with its first message loses the announcement.
   * The visible bar is skipped when empty because an empty one would hold
   * `--window-bar-height` of `--color-muted` directly above the equally-muted
   * taskbar, reading as a dead grey band rather than window chrome.
   */
  return (
    <div className="window-statusbar-live" aria-live="polite" role="status">
      {text ? <div className="window-statusbar">{text}</div> : null}
    </div>
  );
}
