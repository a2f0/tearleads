import type { HTMLAttributes } from "react";
import { classNames } from "../../shared/classNames";
import "./MiniAppRoot.css";

type MiniAppRootPadding = "normal" | "none";

export function MiniAppRoot({
  centered = false,
  className,
  padding = "normal",
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  centered?: boolean | undefined;
  padding?: MiniAppRootPadding | undefined;
}) {
  return (
    <div
      {...props}
      className={classNames(
        "mini-app-root",
        padding !== "normal" && `mini-app-root--padding-${padding}`,
        centered && "mini-app-root--centered",
        className,
      )}
    />
  );
}
