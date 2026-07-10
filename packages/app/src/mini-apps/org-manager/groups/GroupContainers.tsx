import type { OrganizationGroupContainer } from "@tearleads/client-sdk";
import { type ReactNode, useMemo } from "react";
import { MiniAppStatus } from "../../../components/shared/MiniAppLayout";
import {
  addMiniAppTableHeaderAction,
  getVisibleMiniAppTableColumnIds,
  MiniAppColumnMenuButton,
  type MiniAppColumnMenuOption,
  MiniAppTable,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
  useMiniAppColumnVisibility,
} from "../../../components/shared/MiniAppTable";
import {
  getMiniAppVirtualFrameStyle,
  MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
  MiniAppVirtualTableSpacerRow,
  useMiniAppVirtualRows,
} from "../../../components/shared/MiniAppVirtual";
import { useRoutedLayoutTier } from "../../../navigation/useRoutedLayoutTier";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import {
  getAccessLabel,
  getContainerDisplayLabel,
  getContainerDisplayTitle,
} from "../display";
import { ORG_MANAGER_LABELS } from "../labels";

type GroupContainerTableColumnId = "container" | "access" | "updated";

const GROUP_CONTAINER_TABLE_COLUMN_IDS: ReadonlyArray<GroupContainerTableColumnId> =
  ["container", "access", "updated"];
const GROUP_CONTAINER_TOGGLEABLE_COLUMN_IDS: ReadonlyArray<GroupContainerTableColumnId> =
  ["access", "updated"];
const EMPTY_GROUP_CONTAINER_HIDDEN_COLUMNS =
  new Set<GroupContainerTableColumnId>();
const GROUP_CONTAINER_COLUMN_MENU_OPTIONS: ReadonlyArray<
  MiniAppColumnMenuOption<GroupContainerTableColumnId>
> = [
  { id: "access", label: ORG_MANAGER_LABELS.access },
  { id: "updated", label: ORG_MANAGER_LABELS.updated },
];

const GROUP_CONTAINER_TABLE_COLUMNS = [
  {
    id: "container",
    header: ORG_MANAGER_LABELS.container,
    width: "42%",
  },
  {
    id: "access",
    header: ORG_MANAGER_LABELS.access,
    width: "7rem",
  },
  {
    className: "org-manager-container-updated-column",
    id: "updated",
    header: ORG_MANAGER_LABELS.updated,
    width: "8rem",
  },
] satisfies ReadonlyArray<
  MiniAppTableColumn & { id: GroupContainerTableColumnId }
>;

function renderGroupContainerCell(
  columnId: GroupContainerTableColumnId,
  container: OrganizationGroupContainer,
): ReactNode {
  switch (columnId) {
    case "container":
      return (
        <MiniAppTableCell key="container">
          <MiniAppTableText title={getContainerDisplayTitle(container)}>
            {getContainerDisplayLabel(container)}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
    case "access":
      return (
        <MiniAppTableCell key="access">
          <MiniAppTableText>
            {getAccessLabel(container.accessLevel)}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
    case "updated":
      return (
        <MiniAppTableCell
          className="org-manager-container-updated-column"
          key="updated"
        >
          <MiniAppTableText title={container.updatedAt}>
            {formatMiniAppDate(container.updatedAt)}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
  }
}

export function GroupContainers({
  containers,
}: {
  containers: ReadonlyArray<OrganizationGroupContainer>;
}) {
  const virtualContainers = useMiniAppVirtualRows({
    rowHeight: MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
    rows: containers,
  });
  const compact = useRoutedLayoutTier() === "mobile";
  const columnVisibility =
    useMiniAppColumnVisibility<GroupContainerTableColumnId>({
      storageKey: "tearleads.org-manager.group-containers:hidden-columns",
      toggleableColumnIds: GROUP_CONTAINER_TOGGLEABLE_COLUMN_IDS,
    });
  const appliedHiddenColumns = compact
    ? EMPTY_GROUP_CONTAINER_HIDDEN_COLUMNS
    : columnVisibility.hiddenColumns;
  const visibleColumnIds = useMemo(
    () =>
      getVisibleMiniAppTableColumnIds(
        GROUP_CONTAINER_TABLE_COLUMN_IDS,
        appliedHiddenColumns,
      ),
    [appliedHiddenColumns],
  );
  const columns = useMemo(
    () =>
      addMiniAppTableHeaderAction(
        GROUP_CONTAINER_TABLE_COLUMNS.filter(
          (column) => !appliedHiddenColumns.has(column.id),
        ),
        compact ? null : (
          <MiniAppColumnMenuButton
            ariaLabel={ORG_MANAGER_LABELS.columns}
            hiddenColumns={columnVisibility.hiddenColumns}
            options={GROUP_CONTAINER_COLUMN_MENU_OPTIONS}
            stateLabels={{
              off: ORG_MANAGER_LABELS.columnsMenuStateOff,
              on: ORG_MANAGER_LABELS.columnsMenuStateOn,
            }}
            toggleColumn={columnVisibility.toggleColumn}
          />
        ),
      ),
    [
      appliedHiddenColumns,
      columnVisibility.hiddenColumns,
      columnVisibility.toggleColumn,
      compact,
    ],
  );

  if (containers.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.noDirectContainerLinks}
      </MiniAppStatus>
    );
  }

  return (
    <MiniAppTableFrame
      className="mini-app-table-frame--virtual mini-app-table-frame--compact org-manager-virtual-table"
      ref={virtualContainers.frameRef}
      style={getMiniAppVirtualFrameStyle(
        MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
      )}
    >
      <MiniAppTable
        aria-label={ORG_MANAGER_LABELS.directContainerLinks}
        columns={columns}
      >
        <MiniAppVirtualTableSpacerRow
          colSpan={visibleColumnIds.length}
          height={virtualContainers.topPadding}
        />
        {virtualContainers.rows.map((container) => (
          <MiniAppTableRow key={container.containerId}>
            {visibleColumnIds.map((columnId) =>
              renderGroupContainerCell(columnId, container),
            )}
          </MiniAppTableRow>
        ))}
        <MiniAppVirtualTableSpacerRow
          colSpan={visibleColumnIds.length}
          height={virtualContainers.bottomPadding}
        />
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}
