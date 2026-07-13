import type { OrganizationContainerGrant } from "@tearleads/client-sdk";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useMemo,
} from "react";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../../components/shared/MiniAppLayout";
import {
  addMiniAppTableHeaderAction,
  getVisibleMiniAppTableColumnIds,
  MiniAppColumnMenuButton,
  type MiniAppColumnMenuOption,
  MiniAppRowActionsCell,
  MiniAppTable,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
  miniAppRowActionsColumn,
  useMiniAppColumnVisibility,
} from "../../../components/shared/MiniAppTable";
import {
  getMiniAppVirtualFrameStyle,
  MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
  MiniAppVirtualTableSpacerRow,
  useMiniAppVirtualRows,
} from "../../../components/shared/MiniAppVirtual";
import { useRoutedLayoutActive } from "../../../navigation/useRoutedLayoutActive";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import {
  getAccessLabel,
  getContainerDisplayLabel,
  getContainerDisplayTitle,
  getGrantPrincipalLabel,
  isKeyboardActivationKey,
} from "../display";
import { ORG_MANAGER_LABELS } from "../labels";
import type { OrgManagerGrantRouteRef } from "../routes";

type GrantTableColumnId =
  | "principal"
  | "container"
  | "access"
  | "updated"
  | "action";
// On touch the inline "action" (Revoke) column is swapped for the kebab column.
type GrantVisibleColumnId = GrantTableColumnId | "actions";

const GRANT_TABLE_COLUMN_IDS: ReadonlyArray<GrantTableColumnId> = [
  "principal",
  "container",
  "access",
  "updated",
  "action",
];
// The data columns without the trailing inline "action" (Revoke) column, used
// when the touch kebab replaces it.
const GRANT_DATA_COLUMN_IDS: ReadonlyArray<GrantTableColumnId> = [
  "principal",
  "container",
  "access",
  "updated",
];
const GRANT_TOGGLEABLE_COLUMN_IDS: ReadonlyArray<GrantTableColumnId> = [
  "container",
  "access",
  "updated",
];
const GRANT_COLUMN_MENU_OPTIONS: ReadonlyArray<
  MiniAppColumnMenuOption<GrantTableColumnId>
> = [
  { id: "container", label: ORG_MANAGER_LABELS.container },
  { id: "access", label: ORG_MANAGER_LABELS.access },
  { id: "updated", label: ORG_MANAGER_LABELS.updated },
];

const GRANT_TABLE_COLUMNS = [
  {
    id: "principal",
    header: ORG_MANAGER_LABELS.principal,
    width: "34%",
  },
  {
    id: "container",
    header: ORG_MANAGER_LABELS.container,
    width: "34%",
  },
  {
    id: "access",
    header: ORG_MANAGER_LABELS.access,
    width: "7rem",
  },
  {
    id: "updated",
    header: ORG_MANAGER_LABELS.updated,
    width: "8rem",
  },
  {
    id: "action",
    header: ORG_MANAGER_LABELS.action,
    width: "6rem",
  },
] satisfies ReadonlyArray<MiniAppTableColumn & { id: GrantTableColumnId }>;

const GRANT_DATA_TABLE_COLUMNS = GRANT_TABLE_COLUMNS.filter(
  (column) => column.id !== "action",
);

function renderGrantCell(
  columnId: GrantTableColumnId,
  params: {
    canRevokeGrant: boolean;
    grant: OrganizationContainerGrant;
    mutating: boolean;
    revokeGrant: (grant: OrganizationContainerGrant) => void;
  },
): ReactNode {
  const { canRevokeGrant, grant, mutating, revokeGrant } = params;
  switch (columnId) {
    case "principal":
      return (
        <MiniAppTableCell key="principal">
          <MiniAppTableText title={grant.subjectId}>
            {getGrantPrincipalLabel(grant)}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
    case "container":
      return (
        <MiniAppTableCell key="container">
          <MiniAppTableText title={getContainerDisplayTitle(grant)}>
            {getContainerDisplayLabel(grant)}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
    case "access":
      return (
        <MiniAppTableCell key="access">
          <MiniAppTableText>
            {getAccessLabel(grant.accessLevel)}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
    case "updated":
      return (
        <MiniAppTableCell key="updated">
          <MiniAppTableText title={grant.updatedAt}>
            {formatMiniAppDate(grant.updatedAt)}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
    case "action":
      return (
        <MiniAppTableCell key="action">
          {grant.isBuiltin ? (
            <MiniAppTableText>{ORG_MANAGER_LABELS.builtIn}</MiniAppTableText>
          ) : (
            <MiniAppButton
              block
              disabled={!canRevokeGrant || mutating}
              onClick={(event) => {
                event.stopPropagation();
                revokeGrant(grant);
              }}
              type="button"
            >
              {ORG_MANAGER_LABELS.revoke}
            </MiniAppButton>
          )}
        </MiniAppTableCell>
      );
  }
}

function useGrantTableColumns(showActions: boolean): {
  columns: ReadonlyArray<MiniAppTableColumn>;
  visibleColumnIds: ReadonlyArray<GrantVisibleColumnId>;
} {
  const columnVisibility = useMiniAppColumnVisibility<GrantTableColumnId>({
    storageKey: "tearleads.org-manager.grants:hidden-columns",
    toggleableColumnIds: GRANT_TOGGLEABLE_COLUMN_IDS,
  });
  const visibleColumnIds = useMemo<ReadonlyArray<GrantVisibleColumnId>>(() => {
    if (showActions) {
      const dataColumnIds = getVisibleMiniAppTableColumnIds(
        GRANT_DATA_COLUMN_IDS,
        columnVisibility.hiddenColumns,
      );
      return [...dataColumnIds, "actions"];
    }
    return getVisibleMiniAppTableColumnIds(
      GRANT_TABLE_COLUMN_IDS,
      columnVisibility.hiddenColumns,
    );
  }, [columnVisibility.hiddenColumns, showActions]);
  const columns = useMemo(() => {
    const columnMenu = (
      <MiniAppColumnMenuButton
        ariaLabel={ORG_MANAGER_LABELS.columns}
        hiddenColumns={columnVisibility.hiddenColumns}
        options={GRANT_COLUMN_MENU_OPTIONS}
        stateLabels={{
          off: ORG_MANAGER_LABELS.columnsMenuStateOff,
          on: ORG_MANAGER_LABELS.columnsMenuStateOn,
        }}
        toggleColumn={columnVisibility.toggleColumn}
      />
    );
    if (showActions) {
      // Keep the column-menu trigger on the last data column and append the
      // kebab column, which stands in for the inline Revoke button on touch.
      const dataColumns = addMiniAppTableHeaderAction(
        GRANT_DATA_TABLE_COLUMNS.filter(
          (column) => !columnVisibility.hiddenColumns.has(column.id),
        ),
        columnMenu,
      );
      return [
        ...dataColumns,
        miniAppRowActionsColumn(ORG_MANAGER_LABELS.rowActionsColumn),
      ];
    }
    return addMiniAppTableHeaderAction(
      GRANT_TABLE_COLUMNS.filter(
        (column) => !columnVisibility.hiddenColumns.has(column.id),
      ),
      columnMenu,
    );
  }, [
    columnVisibility.hiddenColumns,
    columnVisibility.toggleColumn,
    showActions,
  ]);

  return { columns, visibleColumnIds };
}

export function GrantTable({
  canRevokeGrants,
  emptyLabel,
  grants,
  label,
  mutating,
  openGrantContextMenu,
  openGrantRoute,
  revokeGrant,
}: {
  canRevokeGrants: boolean;
  emptyLabel: string;
  grants: ReadonlyArray<OrganizationContainerGrant>;
  label: string;
  mutating: boolean;
  openGrantContextMenu?:
    | ((
        event: MouseEvent<HTMLElement>,
        grant: OrganizationContainerGrant,
      ) => void)
    | undefined;
  openGrantRoute: (grantRef: OrgManagerGrantRouteRef) => void;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
}) {
  const virtualGrants = useMiniAppVirtualRows({
    rowHeight: MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
    rows: grants,
  });
  // Touch layouts have no right-click; the kebab replaces the inline Revoke
  // button and opens the same Open / Revoke menu right-click / long-press does.
  const showActions = useRoutedLayoutActive() && Boolean(openGrantContextMenu);
  const { columns, visibleColumnIds } = useGrantTableColumns(showActions);

  if (grants.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">{emptyLabel}</MiniAppStatus>
    );
  }

  return (
    <MiniAppTableFrame
      className="mini-app-table-frame--virtual mini-app-table-frame--compact org-manager-virtual-table"
      ref={virtualGrants.frameRef}
      style={getMiniAppVirtualFrameStyle(
        MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
      )}
    >
      <MiniAppTable aria-label={label} columns={columns}>
        <MiniAppVirtualTableSpacerRow
          colSpan={visibleColumnIds.length}
          height={virtualGrants.topPadding}
        />
        {virtualGrants.rows.map((grant) => {
          const canRevokeGrant = canRevokeGrants && !grant.isBuiltin;
          const openGrantDetailRoute = () => {
            openGrantRoute({
              containerId: grant.containerId,
              subjectId: grant.subjectId,
              subjectType: grant.subjectType,
            });
          };
          const handleGrantRowKeyDown = (
            event: KeyboardEvent<HTMLTableRowElement>,
          ) => {
            if (isKeyboardActivationKey(event.key)) {
              event.preventDefault();
              openGrantDetailRoute();
            }
          };

          return (
            <MiniAppTableRow
              interactive
              key={`${grant.subjectType}:${grant.subjectId}:${grant.containerId}:${grant.accessLevel}`}
              onClick={openGrantDetailRoute}
              onContextMenu={
                openGrantContextMenu
                  ? (event) => openGrantContextMenu(event, grant)
                  : undefined
              }
              onKeyDown={handleGrantRowKeyDown}
              role="button"
              tabIndex={0}
            >
              {visibleColumnIds.map((columnId) =>
                columnId === "actions" ? (
                  <MiniAppRowActionsCell
                    key="actions"
                    label={`${ORG_MANAGER_LABELS.rowActionsButtonPrefix} ${getGrantPrincipalLabel(grant)}`}
                    onOpen={(event) => openGrantContextMenu?.(event, grant)}
                  />
                ) : (
                  renderGrantCell(columnId, {
                    canRevokeGrant,
                    grant,
                    mutating,
                    revokeGrant,
                  })
                ),
              )}
            </MiniAppTableRow>
          );
        })}
        <MiniAppVirtualTableSpacerRow
          colSpan={visibleColumnIds.length}
          height={virtualGrants.bottomPadding}
        />
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}
