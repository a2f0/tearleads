import type { HTMLAttributes } from "react";
import { classNames } from "../../shared/classNames";
import "./MiniAppHeader.css";

export function MiniAppHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={classNames("mini-app-header", className)} />
  );
}

export function MiniAppHeaderCopy({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={classNames("mini-app-header-copy", className)} />
  );
}
