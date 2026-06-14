import type { HTMLAttributes } from "react";
import { classNames } from "../../shared/classNames";
import "./MiniAppStatus.css";

type MiniAppStatusTone = "muted" | "error";

export function MiniAppStatus({
  as = "div",
  className,
  tone = "muted",
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: "div" | "span" | undefined;
  tone?: MiniAppStatusTone | undefined;
}) {
  const Component = as;

  return (
    <Component
      {...props}
      className={classNames(
        "mini-app-status",
        tone !== "muted" && `mini-app-status--${tone}`,
        className,
      )}
    />
  );
}
