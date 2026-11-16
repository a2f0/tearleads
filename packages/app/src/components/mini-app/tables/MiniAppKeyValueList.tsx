import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../shared/classNames";
import "./MiniAppKeyValueList.css";

/**
 * A read-only key/value detail list: label beside value on a wide pane, label
 * above value on a narrow one (see MiniAppKeyValueList.css). Use it for
 * {@link MiniAppKeyValueRow}s only; a multi-column list with a header row stays
 * a table.
 *
 * A `<dl>`, not a table: stacking table cells means setting them to
 * `display: block`, which drops their table semantics in Safari, while a
 * description list keeps its term/definition pairing in either layout.
 */
export function MiniAppKeyValueList({
  className,
  ...props
}: HTMLAttributes<HTMLDListElement>) {
  // A `<dl>` has no ARIA role of its own, so a name given to one is dropped
  // unless the list is exposed as a group (the root console's labelled fact
  // sheets).
  const labelled =
    props["aria-label"] !== undefined || props["aria-labelledby"] !== undefined;
  return (
    <dl
      role={labelled ? "group" : undefined}
      {...props}
      className={classNames("mini-app-key-value-list", className)}
    />
  );
}

export function MiniAppKeyValueRow({
  children,
  label,
  title,
}: {
  children: ReactNode;
  label: ReactNode;
  title?: string | null | undefined;
}) {
  return (
    <div className="mini-app-key-value-row">
      <dt>{label}</dt>
      <dd title={title ?? undefined}>{children}</dd>
    </div>
  );
}
