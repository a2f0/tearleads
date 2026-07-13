import {
  type ButtonHTMLAttributes,
  forwardRef,
  type HTMLAttributes,
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
  selected?: boolean | undefined;
};

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

export const MiniAppTableRow = forwardRef<
  HTMLTableRowElement,
  MiniAppTableRowProps
>(function MiniAppTableRow(
  { className, interactive = false, onContextMenu, selected = false, ...props },
  ref,
) {
  // Touch devices have no right-click; long-press an interactive row to reach
  // the same `onContextMenu` actions a mouse user gets (the press dispatches a
  // native `contextmenu` event). Non-interactive rows keep their handler for
  // desktop right-click but skip the touch synthesis.
  const longPress = useLongPress(interactive && Boolean(onContextMenu));

  return (
    <tr
      {...props}
      {...longPress}
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
 * right-aligned column whose header carries only a visually-hidden label. Pair
 * with {@link MiniAppRowActionsCell} in each body row. Append it *after*
 * {@link addMiniAppTableHeaderAction} so a column-menu trigger stays on the last
 * data column instead of this narrow one.
 */
export function miniAppRowActionsColumn(
  headingLabel: string,
): MiniAppTableColumn {
  return {
    className: "mini-app-row-actions-column",
    header: (
      <span className="mini-app-row-actions-heading">{headingLabel}</span>
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

  return (
    <MiniAppTableCell className="mini-app-row-actions-cell" key="actions">
      <MiniAppRowActionsButton
        aria-label={label}
        onClick={openFromEvent}
        onContextMenu={openFromEvent}
        title={label}
      />
    </MiniAppTableCell>
  );
}
