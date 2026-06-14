import type { FormHTMLAttributes, HTMLAttributes } from "react";
import { classNames } from "../../shared/classNames";
import "./MiniAppPanel.css";

type MiniAppPanelVariant = "plain" | "framed";

export function MiniAppPanel({
  className,
  scroll = false,
  variant = "plain",
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  scroll?: boolean | undefined;
  variant?: MiniAppPanelVariant | undefined;
}) {
  return (
    <div
      {...props}
      className={classNames(
        "mini-app-panel",
        scroll && "mini-app-panel--scroll",
        variant !== "plain" && `mini-app-panel--${variant}`,
        className,
      )}
    />
  );
}

export function MiniAppFormPanel({
  className,
  scroll = false,
  variant = "plain",
  ...props
}: FormHTMLAttributes<HTMLFormElement> & {
  scroll?: boolean | undefined;
  variant?: MiniAppPanelVariant | undefined;
}) {
  return (
    <form
      {...props}
      className={classNames(
        "mini-app-panel",
        scroll && "mini-app-panel--scroll",
        variant !== "plain" && `mini-app-panel--${variant}`,
        className,
      )}
    />
  );
}
