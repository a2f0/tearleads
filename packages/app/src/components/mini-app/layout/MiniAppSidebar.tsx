import type { HTMLAttributes } from "react";
import { classNames } from "../../shared/classNames";
import "./MiniAppSidebar.css";

export function MiniAppSidebar({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={classNames("mini-app-sidebar", className)} />
  );
}
