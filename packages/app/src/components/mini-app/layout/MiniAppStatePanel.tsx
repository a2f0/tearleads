import type { ReactNode } from "react";
import { classNames } from "../../shared/classNames";
import "./MiniAppStatePanel.css";

/**
 * A whole-surface state (loading, signed out, empty) centered in the space
 * the content would fill, rather than one line pinned to the top. `busy`
 * swaps the icon for a spinner and announces the title as a polite status.
 * It deliberately omits aria-busy: a busy live region defers its own
 * announcements until it stops being busy.
 */
export function MiniAppStatePanel({
  busy = false,
  children,
  className,
  description,
  icon,
  title,
}: {
  busy?: boolean | undefined;
  /** Actions and follow-up messages, rendered under the copy. */
  children?: ReactNode;
  className?: string | undefined;
  description?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div
      aria-live={busy ? "polite" : undefined}
      className={classNames(
        "mini-app-state-panel",
        busy && "mini-app-state-panel--busy",
        className,
      )}
      role={busy ? "status" : undefined}
    >
      {busy ? (
        <span className="mini-app-state-panel-spinner" aria-hidden="true" />
      ) : icon ? (
        <span className="mini-app-state-panel-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className="mini-app-state-panel-copy">
        <h2 className="mini-app-state-panel-title">{title}</h2>
        {description ? (
          <p className="mini-app-state-panel-description">{description}</p>
        ) : null}
      </div>
      {children ? (
        <div className="mini-app-state-panel-actions">{children}</div>
      ) : null}
    </div>
  );
}
