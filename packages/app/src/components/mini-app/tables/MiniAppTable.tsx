import {
  type ButtonHTMLAttributes,
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type TableHTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from "react";
import { classNames } from "../../shared/classNames";
import { useLongPress } from "../../shared/useLongPress";
import { MiniAppRowActionsButton } from "./MiniAppRowActionsButton";
import "./MiniAppTable.css";

export interface MiniAppTableColumn {
  ariaSort?: ThHTMLAttributes<HTMLTableCellElement>["aria-sort"] | undefined;
  className?: string | undefined;
  header: ReactNode;
  id: string;
  width?: string | undefined;
}

type MiniAppTableProps = TableHTMLAttributes<HTMLTableElement> & {
  columns: ReadonlyArray<MiniAppTableColumn>;
};

export type MiniAppTableEmptyRowProps = HTMLAttributes<HTMLTableRowElement> & {
  children: ReactNode;
  colSpan: number;
};

type MiniAppTableHeaderContentProps = HTMLAttributes<HTMLSpanElement> & {
  action: ReactNode;
  children: ReactNode;
};

type MiniAppTableTextProps = HTMLAttributes<HTMLSpanElement> & {
  muted?: boolean | undefined;
  truncate?: boolean | undefined;
};

type MiniAppTableRowProps = HTMLAttributes<HTMLTableRowElement> & {
  interactive?: boolean | undefined;
  onActivate?: ((event: MouseEvent<HTMLTableRowElement>) => void) | undefined;
  selected?: boolean | undefined;
};

/**
 * Descendants that own their activation: a click on one of these belongs to it,
 * not to the row.
 */
const MINI_APP_ROW_CONTROL_SELECTOR =
  "a, button, input, label, select, textarea";

function isMiniAppRowControlTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(MINI_APP_ROW_CONTROL_SELECTOR) !== null
  );
}

type MiniAppInfoTableRowProps = HTMLAttributes<HTMLTableRowElement> & {
  interactive?: boolean | undefined;
};

export const MiniAppTableFrame = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function MiniAppTableFrame({ className, ...props }, ref) {
  return (
    <div
      {...props}
      className={classNames("mini-app-table-frame", className)}
      ref={ref}
    />
  );
});

export const MiniAppTable = forwardRef<HTMLTableElement, MiniAppTableProps>(
  function MiniAppTable({ children, className, columns, ...props }, ref) {
    return (
      <table
        {...props}
        className={classNames("mini-app-table", className)}
        ref={ref}
      >
        <colgroup>
          {columns.map((column) => (
            <col
              className={column.className}
              key={column.id}
              style={column.width ? { width: column.width } : undefined}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                aria-sort={column.ariaSort}
                className={column.className}
                key={column.id}
                scope="col"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    );
  },
);

function MiniAppTableHeaderContent({
  action,
  children,
  className,
  ...props
}: MiniAppTableHeaderContentProps) {
  return (
    <span
      {...props}
      className={classNames("mini-app-table-header-content", className)}
    >
      <span className="mini-app-table-header-label">{children}</span>
      {action}
    </span>
  );
}

export function addMiniAppTableHeaderAction(
  columns: ReadonlyArray<MiniAppTableColumn>,
  action: ReactNode,
): ReadonlyArray<MiniAppTableColumn> {
  if (!action || columns.length === 0) {
    return columns;
  }

  const actionColumnIndex = columns.length - 1;
  return columns.map((column, index) =>
    index === actionColumnIndex
      ? {
          ...column,
          header: (
            <MiniAppTableHeaderContent action={action}>
              {column.header}
            </MiniAppTableHeaderContent>
          ),
        }
      : column,
  );
}

export const MiniAppInfoTable = forwardRef<
  HTMLTableElement,
  TableHTMLAttributes<HTMLTableElement>
>(function MiniAppInfoTable({ children, className, ...props }, ref) {
  return (
    <table
      {...props}
      className={classNames("mini-app-info-table", className)}
      ref={ref}
    >
      {children}
    </table>
  );
});

/**
 * A read-only key/value detail table: no cell grid, and a fixed key column so
 * that two of these stacked in one panel line their values up instead of each
 * indenting to its own longest key.
 *
 * Use it for a `<tbody>` of {@link MiniAppInfoRow}s and nothing else. The key
 * column is a fixed width (see `--aligned` in MiniAppTable.css), so a
 * multi-column info table — one with a `<thead>`, like the Authorizing
 * Containers or Attachments lists — must stay on plain {@link MiniAppInfoTable}
 * and keep the auto layout.
 */
export const MiniAppKeyValueTable = forwardRef<
  HTMLTableElement,
  TableHTMLAttributes<HTMLTableElement>
>(function MiniAppKeyValueTable({ className, ...props }, ref) {
  return (
    <MiniAppInfoTable
      {...props}
      className={classNames(
        "mini-app-info-table--borderless",
        "mini-app-info-table--aligned",
        className,
      )}
      ref={ref}
    />
  );
});

export const MiniAppInfoTableRow = forwardRef<
  HTMLTableRowElement,
  MiniAppInfoTableRowProps
>(function MiniAppInfoTableRow(
  { className, interactive = false, ...props },
  ref,
) {
  return (
    <tr
      {...props}
      className={classNames(
        "mini-app-info-table-row",
        interactive && "mini-app-info-table-row--interactive",
        className,
      )}
      ref={ref}
    />
  );
});

export function MiniAppInfoRow({
  children,
  label,
  title,
}: {
  children: ReactNode;
  label: ReactNode;
  title?: string | null | undefined;
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td title={title ?? undefined}>{children}</td>
    </tr>
  );
}

/**
 * `onActivate` makes the *whole* row a click target for its primary action —
 * the row's own controls (the name button, the kebab, links) keep their clicks,
 * and everything else in the row falls through to `onActivate`. Pair it with a
 * real cell button that carries the same action so keyboard and screen-reader
 * users still have a focusable, labelled control.
 *
 * This deliberately does the row-wide hit area in JS rather than with an
 * absolutely positioned overlay anchored to the `<tr>`: WebKit does not make a
 * relatively positioned table row a containing block, so such an overlay
 * resolves against the scroll frame instead of the row. Every row's overlay
 * then covers the entire list and the last one wins hit-testing, so on iOS
 * (including the Capacitor WKWebView) every tap activated the bottom row.
 */
export const MiniAppTableRow = forwardRef<
  HTMLTableRowElement,
  MiniAppTableRowProps
>(function MiniAppTableRow(
  {
    className,
    interactive = false,
    onActivate,
    onClick,
    onContextMenu,
    selected = false,
    ...props
  },
  ref,
) {
  // Touch devices have no right-click; long-press an interactive row to reach
  // the same `onContextMenu` actions a mouse user gets (the press dispatches a
  // native `contextmenu` event). Non-interactive rows keep their handler for
  // desktop right-click but skip the touch synthesis.
  const longPress = useLongPress(interactive && Boolean(onContextMenu));
  const handleClick = onActivate
    ? (event: MouseEvent<HTMLTableRowElement>) => {
        onClick?.(event);
        if (!isMiniAppRowControlTarget(event.target)) {
          onActivate(event);
        }
      }
    : onClick;

  return (
    <tr
      {...props}
      {...longPress}
      onClick={handleClick}
      onContextMenu={onContextMenu}
      className={classNames(
        "mini-app-table-row",
        interactive && "mini-app-table-row--interactive",
        selected && "mini-app-table-row--selected",
        className,
      )}
      ref={ref}
    />
  );
});

export const MiniAppTableCell = forwardRef<
  HTMLTableCellElement,
  TdHTMLAttributes<HTMLTableCellElement>
>(function MiniAppTableCell({ className, ...props }, ref) {
  return (
    <td
      {...props}
      className={classNames("mini-app-table-cell", className)}
      ref={ref}
    />
  );
});

export const MiniAppTableEmptyRow = forwardRef<
  HTMLTableRowElement,
  MiniAppTableEmptyRowProps
>(function MiniAppTableEmptyRow({ children, colSpan, ...props }, ref) {
  return (
    <MiniAppTableRow {...props} ref={ref}>
      <MiniAppTableCell className="mini-app-table-empty" colSpan={colSpan}>
        {children}
      </MiniAppTableCell>
    </MiniAppTableRow>
  );
});

export const MiniAppTableText = forwardRef<
  HTMLSpanElement,
  MiniAppTableTextProps
>(function MiniAppTableText(
  { className, muted = false, truncate = true, ...props },
  ref,
) {
  return (
    <span
      {...props}
      className={classNames(
        "mini-app-table-text",
        truncate && "mini-app-table-text--truncate",
        muted && "mini-app-table-text--muted",
        className,
      )}
      ref={ref}
    />
  );
});

export const MiniAppTableActionButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function MiniAppTableActionButton(
  { className, type = "button", ...props },
  ref,
) {
  return (
    <button
      {...props}
      className={classNames("mini-app-table-action", className)}
      ref={ref}
      type={type}
    />
  );
});

/**
 * The shared trailing "actions" (kebab) column definition — a narrow,
 * right-aligned column whose header carries a visually-hidden label. Pair with
 * {@link MiniAppRowActionsCell} in each body row. When this column is present
 * it is the table's trailing edge, so a column-menu trigger belongs in its
 * header (pass it as `action`) rather than via
 * {@link addMiniAppTableHeaderAction}, which would seat the trigger one column
 * in from the edge on the last data column.
 */
export function miniAppRowActionsColumn(
  headingLabel: string,
  action?: ReactNode,
): MiniAppTableColumn {
  return {
    className: "mini-app-row-actions-column",
    header: (
      <>
        <span className="mini-app-row-actions-heading">{headingLabel}</span>
        {action}
      </>
    ),
    id: "actions",
    width: "var(--mini-app-row-actions-column-width, 2.25rem)",
  };
}

/**
 * The body cell for the {@link miniAppRowActionsColumn} column: a kebab button
 * that opens the row's actions. `onOpen` receives the click/contextmenu event
 * (already `stopPropagation`-ed so it never triggers the row's own click) and
 * should open the same context menu a right-click / long-press would.
 */
export function MiniAppRowActionsCell({
  label,
  onOpen,
}: {
  label: string;
  onOpen: (event: MouseEvent<HTMLElement>) => void;
}) {
  const openFromEvent = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onOpen(event);
  };

  // Keyboard-activate the button without the Enter/Space keydown bubbling to the
  // row's own onKeyDown handler, which would `preventDefault()` the button's
  // native click and navigate the row instead of opening the menu.
  const stopRowActivationKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.stopPropagation();
    }
  };

  return (
    <MiniAppTableCell className="mini-app-row-actions-cell" key="actions">
      <MiniAppRowActionsButton
        aria-label={label}
        onClick={openFromEvent}
        onContextMenu={openFromEvent}
        onKeyDown={stopRowActivationKeys}
        title={label}
      />
    </MiniAppTableCell>
  );
}
