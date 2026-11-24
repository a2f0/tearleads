import type { HTMLAttributes } from "react";
import { classNames } from "../../shared/classNames";
import "./MiniAppItemView.css";

/**
 * The square that holds an item's leading visual — a thumbnail, a type glyph,
 * a document avatar. Its size comes from the list's view: inside a
 * `data-item-view="large-rows"` frame it takes the shared large-row square, and
 * whatever it holds fills it. Outside one, the caller sizes it.
 */
export function MiniAppItemThumb({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span {...props} className={classNames("mini-app-item-thumb", className)} />
  );
}
