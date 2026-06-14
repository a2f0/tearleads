import type { HTMLAttributes } from "react";
import { classNames } from "../../shared/classNames";
import "./MiniAppToolbar.css";

export function MiniAppToolbar({
  className,
  wrap = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  wrap?: boolean | undefined;
}) {
  return (
    <div
      {...props}
      className={classNames(
        "mini-app-toolbar",
        wrap && "mini-app-toolbar--wrap",
        className,
      )}
    />
  );
}

export function MiniAppActions({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={classNames("mini-app-actions", className)} />
  );
}
