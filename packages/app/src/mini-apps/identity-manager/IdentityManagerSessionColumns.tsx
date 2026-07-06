import { useMemo } from "react";
import {
  addMiniAppTableHeaderAction,
  getVisibleMiniAppTableColumnIds,
  MiniAppColumnMenuButton,
  type MiniAppColumnMenuOption,
  type MiniAppTableColumn,
  useMiniAppColumnVisibility,
} from "../../components/shared/MiniAppTable";

export type SessionTableColumnId =
  | "status"
  | "last-active"
  | "last-ip"
  | "ip-addresses"
  | "created"
  | "signing-key"
  | "session-id"
  | "action";

const SESSION_TABLE_COLUMN_IDS: ReadonlyArray<SessionTableColumnId> = [
  "status",
  "last-active",
  "last-ip",
  "ip-addresses",
  "created",
  "signing-key",
  "session-id",
  "action",
];

const SESSION_TOGGLEABLE_COLUMN_IDS: ReadonlyArray<SessionTableColumnId> = [
  "last-ip",
  "ip-addresses",
  "created",
  "signing-key",
  "session-id",
];

const DEFAULT_HIDDEN_SESSION_COLUMNS: ReadonlyArray<SessionTableColumnId> = [
  "ip-addresses",
  "created",
  "signing-key",
  "session-id",
];

const SESSION_COLUMN_MENU_OPTIONS: ReadonlyArray<
  MiniAppColumnMenuOption<SessionTableColumnId>
> = [
  { id: "last-ip", label: "Last IP" },
  { id: "ip-addresses", label: "Full IP List" },
  { id: "created", label: "Created" },
  { id: "signing-key", label: "Signing Key" },
  { id: "session-id", label: "Session ID" },
];

const SESSION_TABLE_COLUMNS = [
  { header: "Status", id: "status", width: "6.5rem" },
  { header: "Last Active", id: "last-active", width: "10rem" },
  { header: "Last IP", id: "last-ip", width: "9rem" },
  { header: "IPs", id: "ip-addresses", width: "7rem" },
  { header: "Created", id: "created", width: "10rem" },
  { header: "Signing Key", id: "signing-key" },
  { header: "Session ID", id: "session-id" },
  {
    className: "mini-app-row-actions-column",
    header: <span className="mini-app-row-actions-heading">Actions</span>,
    id: "action",
    width: "2.25rem",
  },
] satisfies ReadonlyArray<MiniAppTableColumn & { id: SessionTableColumnId }>;

export function useSessionTableColumns(): {
  columns: ReadonlyArray<MiniAppTableColumn>;
  visibleColumnIds: ReadonlyArray<SessionTableColumnId>;
} {
  const columnVisibility = useMiniAppColumnVisibility<SessionTableColumnId>({
    defaultHiddenColumnIds: DEFAULT_HIDDEN_SESSION_COLUMNS,
    storageKey: "tearleads.identity-manager.sessions:hidden-columns",
    toggleableColumnIds: SESSION_TOGGLEABLE_COLUMN_IDS,
  });
  const visibleColumnIds = useMemo(
    () =>
      getVisibleMiniAppTableColumnIds(
        SESSION_TABLE_COLUMN_IDS,
        columnVisibility.hiddenColumns,
      ),
    [columnVisibility.hiddenColumns],
  );
  const columns = useMemo(
    () =>
      addMiniAppTableHeaderAction(
        SESSION_TABLE_COLUMNS.filter(
          (column) => !columnVisibility.hiddenColumns.has(column.id),
        ),
        <MiniAppColumnMenuButton
          ariaLabel="Columns"
          hiddenColumns={columnVisibility.hiddenColumns}
          options={SESSION_COLUMN_MENU_OPTIONS}
          stateLabels={{ off: "Off", on: "On" }}
          toggleColumn={columnVisibility.toggleColumn}
        />,
      ),
    [columnVisibility.hiddenColumns, columnVisibility.toggleColumn],
  );

  return { columns, visibleColumnIds };
}
