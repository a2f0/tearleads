import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { classNames } from "./classNames";
import "./MiniAppRow.css";

type MiniAppRowDensity = "compact" | "normal" | "roomy";
type MiniAppRowVariant = "plain" | "framed";

interface MiniAppRowStyleProps {
  density?: MiniAppRowDensity | undefined;
  header?: boolean | undefined;
  selected?: boolean | undefined;
  variant?: MiniAppRowVariant | undefined;
}

function getMiniAppRowClassName({
  className,
  density = "normal",
  header = false,
  interactive = false,
  selected = false,
  variant = "plain",
}: MiniAppRowStyleProps & {
  className?: string | undefined;
  interactive?: boolean | undefined;
}): string | undefined {
  return classNames(
    "mini-app-row",
    density !== "normal" && `mini-app-row--${density}`,
    variant !== "plain" && `mini-app-row--${variant}`,
    header && "mini-app-row--header",
    interactive && "mini-app-row--button",
    selected && "mini-app-row--selected",
    className,
  );
}

export function MiniAppRow({
  as = "div",
  className,
  density,
  header,
  selected,
  variant,
  ...props
}: HTMLAttributes<HTMLDivElement> &
  MiniAppRowStyleProps & {
    as?: "div" | "li";
  }) {
  const rowClassName = getMiniAppRowClassName({
    className,
    density,
    header,
    selected,
    variant,
  });

  if (as === "li") {
    return (
      <li
        {...(props as HTMLAttributes<HTMLLIElement>)}
        className={rowClassName}
      />
    );
  }

  return <div {...props} className={rowClassName} />;
}

export function MiniAppRowButton({
  className,
  density,
  selected,
  type = "button",
  variant,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  Omit<MiniAppRowStyleProps, "header">) {
  return (
    <button
      {...props}
      type={type}
      className={getMiniAppRowClassName({
        className,
        density,
        interactive: true,
        selected,
        variant,
      })}
    />
  );
}

export function MiniAppRowStack({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span {...props} className={classNames("mini-app-row-stack", className)} />
  );
}

export function MiniAppRowText({
  className,
  muted = false,
  truncate = true,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  muted?: boolean;
  truncate?: boolean;
}) {
  return (
    <span
      {...props}
      className={classNames(
        "mini-app-row-text",
        truncate && "mini-app-row-text--truncate",
        muted && "mini-app-row-text--muted",
        className,
      )}
    />
  );
}
