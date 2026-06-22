import type { HTMLAttributes } from "react";
import { classNames } from "../../shared/classNames";
import "./MiniAppSidebar.css";

export function MiniAppSidebar({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  // Touch context actions are wired on the interactive rows (MiniAppRowButton),
  // which are real <button>s. The container keeps any desktop `onContextMenu`
  // (passed through `props`) for right-click on empty area, but intentionally
  // does not synthesize a long-press: long-pressing empty space is an
  // undiscoverable affordance, and those area actions are reachable elsewhere.
  return (
    <div {...props} className={classNames("mini-app-sidebar", className)} />
  );
}
