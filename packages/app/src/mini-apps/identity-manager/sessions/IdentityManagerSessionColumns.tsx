import { useMemo } from "react";
import {
  addMiniAppTableHeaderAction,
  getVisibleMiniAppTableColumnIds,
  MiniAppColumnMenuButton,
  type MiniAppColumnMenuOption,
  MiniAppCompactTableHeader,
  type MiniAppTableColumn,
  useMiniAppColumnVisibility,
} from "../../../components/mini-app/MiniAppTable";

export type SessionTableColumnId =
  | "status"
  | "last-active"
  | "last-ip"
  | "ip-addresses"
  | "created"
  | "signing-key"
  | "session-id"
  | "action";
export type SessionDataColumnId = Exclude<SessionTableColumnId, "action">;

const SESSION_DATA_COLUMN_IDS: ReadonlyArray<SessionDataColumnId> = [
  "status",
  "last-active",
  "last-ip",
  "ip-addresses",
  "created",
  "signing-key",
  "session-id",
];
const SESSION_TABLE_COLUMN_IDS: ReadonlyArray<SessionTableColumnId> = [
  ...SESSION_DATA_COLUMN_IDS,
  "action",
];

export const SESSION_COMPACT_PRIMARY_COLUMN_IDS: ReadonlyArray<SessionDataColumnId> =
  ["status", "last-active"];
export const SESSION_COMPACT_SECONDARY_COLUMN_IDS: ReadonlyArray<SessionDataColumnId> =
  ["last-ip", "ip-addresses", "created", "signing-key", "session-id"];

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
    width: "var(--mini-app-row-actions-column-width, 2.25rem)",
  },
] satisfies ReadonlyArray<MiniAppTableColumn & { id: SessionTableColumnId }>;

export const SESSION_COLUMN_LABELS: Readonly<
  Record<SessionTableColumnId, string>
> = {
  action: "Actions",
  created: "Created",
  "ip-addresses": "IPs",
  "last-active": "Last Active",
  "last-ip": "Last IP",
  "session-id": "Session ID",
  "signing-key": "Signing Key",
  status: "Status",
};

export function useSessionTableColumns(compact: boolean): {
  columns: ReadonlyArray<MiniAppTableColumn>;
  visibleColumnIds: ReadonlyArray<SessionTableColumnId>;
} {
  const columnVisibility = useMiniAppColumnVisibility<SessionTableColumnId>({
    defaultHiddenColumnIds: DEFAULT_HIDDEN_SESSION_COLUMNS,
    storageKey: "symcrypt.identity-manager.sessions:hidden-columns",
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
  const columns = useMemo(() => {
    const columnMenu = (
      <MiniAppColumnMenuButton
        ariaLabel="Columns"
        hiddenColumns={columnVisibility.hiddenColumns}
        options={SESSION_COLUMN_MENU_OPTIONS}
        stateLabels={{ off: "Off", on: "On" }}
        toggleColumn={columnVisibility.toggleColumn}
      />
    );
    if (compact) {
      const compactColumn = {
        header: (
          <MiniAppCompactTableHeader
            primary={SESSION_COMPACT_PRIMARY_COLUMN_IDS.filter((id) =>
              visibleColumnIds.includes(id),
            ).map((id) => ({ id, text: SESSION_COLUMN_LABELS[id] }))}
            secondary={SESSION_COMPACT_SECONDARY_COLUMN_IDS.filter((id) =>
              visibleColumnIds.includes(id),
            ).map((id) => ({ id, text: SESSION_COLUMN_LABELS[id] }))}
          />
        ),
        id: "summary",
      } satisfies MiniAppTableColumn;
      const actionColumn = SESSION_TABLE_COLUMNS.find(
        (column) => column.id === "action",
      );
      return addMiniAppTableHeaderAction(
        actionColumn ? [compactColumn, actionColumn] : [compactColumn],
        columnMenu,
      );
    }

    return addMiniAppTableHeaderAction(
      SESSION_TABLE_COLUMNS.filter(
        (column) => !columnVisibility.hiddenColumns.has(column.id),
      ),
      columnMenu,
    );
  }, [
    columnVisibility.hiddenColumns,
    columnVisibility.toggleColumn,
    compact,
    visibleColumnIds,
  ]);

  return { columns, visibleColumnIds };
}
