import type { HTMLAttributes } from "react";
import { classNames } from "../../shared/classNames";
import "./MiniAppStatus.css";

type MiniAppStatusTone = "muted" | "error";

export function MiniAppStatus({
  as = "div",
  busy = false,
  children,
  className,
  tone = "muted",
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: "div" | "span" | undefined;
  /** Leads the text with a small spinner and announces it as a status. */
  busy?: boolean | undefined;
  tone?: MiniAppStatusTone | undefined;
}) {
  const Component = as;

  return (
    <Component
      role={busy ? "status" : undefined}
      {...props}
      className={classNames(
        "mini-app-status",
        busy && "mini-app-status--busy",
        tone !== "muted" && `mini-app-status--${tone}`,
        className,
      )}
    >
      {busy && <span className="mini-app-status-spinner" aria-hidden="true" />}
      {children}
    </Component>
  );
}
