import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
} from "react";
import "./MiniAppTable.css";

export interface MiniAppTableColumn {
  className?: string | undefined;
  header: ReactNode;
  id: string;
  width?: string | undefined;
}

function classNames(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter((value) => Boolean(value)).join(" ");
}

export function MiniAppTableFrame({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={classNames("mini-app-table-frame", className)} />
  );
}

export function MiniAppTable({
  children,
  className,
  columns,
  ...props
}: TableHTMLAttributes<HTMLTableElement> & {
  columns: ReadonlyArray<MiniAppTableColumn>;
}) {
  return (
    <table {...props} className={classNames("mini-app-table", className)}>
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
            <th className={column.className} key={column.id} scope="col">
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

export function MiniAppTableRow({
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr {...props} className={classNames("mini-app-table-row", className)} />
  );
}

export function MiniAppTableCell({
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td {...props} className={classNames("mini-app-table-cell", className)} />
  );
}

export function MiniAppTableEmptyRow({
  children,
  className,
  colSpan,
}: {
  children: ReactNode;
  className?: string | undefined;
  colSpan: number;
}) {
  return (
    <MiniAppTableRow>
      <MiniAppTableCell
        className={classNames("mini-app-table-empty", className)}
        colSpan={colSpan}
      >
        {children}
      </MiniAppTableCell>
    </MiniAppTableRow>
  );
}

export function MiniAppTableText({
  className,
  muted = false,
  truncate = true,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  muted?: boolean | undefined;
  truncate?: boolean | undefined;
}) {
  return (
    <span
      {...props}
      className={classNames(
        "mini-app-table-text",
        truncate && "mini-app-table-text--truncate",
        muted && "mini-app-table-text--muted",
        className,
      )}
    />
  );
}

export function MiniAppTableActionButton({
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={classNames("mini-app-table-action", className)}
      type={type}
    />
  );
}
