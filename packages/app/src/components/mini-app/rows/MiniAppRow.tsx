import {
  type ButtonHTMLAttributes,
  createElement,
  forwardRef,
  type HTMLAttributes,
} from "react";
import { classNames } from "../../shared/classNames";
import { useLongPress } from "../../shared/useLongPress";
import "./MiniAppRow.css";

type MiniAppRowDensity = "compact" | "normal" | "roomy";
type MiniAppRowVariant = "plain" | "framed";

interface MiniAppRowStyleProps {
  density?: MiniAppRowDensity | undefined;
  header?: boolean | undefined;
  selected?: boolean | undefined;
  variant?: MiniAppRowVariant | undefined;
}

type MiniAppRowProps =
  | (HTMLAttributes<HTMLDivElement> &
      MiniAppRowStyleProps & {
        as?: "div";
      })
  | (HTMLAttributes<HTMLLIElement> &
      MiniAppRowStyleProps & {
        as: "li";
      });

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

export const MiniAppRow = forwardRef<HTMLElement, MiniAppRowProps>(
  function MiniAppRow(
    { as = "div", className, density, header, selected, variant, ...props },
    ref,
  ) {
    const rowClassName = getMiniAppRowClassName({
      className,
      density,
      header,
      selected,
      variant,
    });

    return createElement(as, {
      ...props,
      className: rowClassName,
      ref,
    });
  },
);

export function MiniAppRowButton({
  className,
  density,
  onContextMenu,
  selected,
  type = "button",
  variant,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  Omit<MiniAppRowStyleProps, "header">) {
  // Touch devices have no right-click; a long-press on the row dispatches a
  // native `contextmenu` event so this same `onContextMenu` handler fires.
  const longPress = useLongPress(Boolean(onContextMenu));

  return (
    <button
      {...props}
      {...longPress}
      type={type}
      onContextMenu={onContextMenu}
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
