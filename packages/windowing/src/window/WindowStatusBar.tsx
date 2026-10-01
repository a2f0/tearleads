import "./WindowStatusBar.css";

export function WindowStatusBar({
  text,
  visible = true,
}: {
  text?: string;
  visible?: boolean;
}) {
  /*
   * The live region stays mounted while the visible bar collapses. A `role="status"`
   * region only announces when text changes on an element already in the DOM, so
   * mounting the region together with its first message loses the announcement.
   * The visible bar is skipped when empty because an empty one would hold
   * `--window-bar-height` of `--color-muted` directly above the equally-muted
   * taskbar, reading as a dead grey band rather than window chrome.
   *
   * Hiding the status bar hides only the visible band: the region stays mounted
   * and the message stays in it, visually hidden, so announcements such as the
   * keyboard move and resize instructions still reach assistive technology.
   */
  return (
    <div className="window-statusbar-live" aria-live="polite" role="status">
      {text ? (
        <div
          className={
            visible
              ? "window-statusbar"
              : "window-statusbar window-statusbar--hidden"
          }
        >
          {text}
        </div>
      ) : null}
    </div>
  );
}
