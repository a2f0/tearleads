import type { OrganizationGroupContainer } from "@tearleads/client-sdk";
import { type ReactNode, useMemo } from "react";
import { MiniAppStatus } from "../../../components/mini-app/MiniAppLayout";
import {
  addMiniAppTableHeaderAction,
  getVisibleMiniAppTableColumnIds,
  MiniAppColumnMenuButton,
  type MiniAppColumnMenuOption,
  MiniAppCompactTableCell,
  type MiniAppCompactTableField,
  MiniAppCompactTableHeader,
  MiniAppTable,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
  useMiniAppColumnVisibility,
  useMiniAppCompactTableLayout,
} from "../../../components/mini-app/MiniAppTable";
import {
  getMiniAppVirtualFrameStyle,
  MiniAppVirtualTableSpacerRow,
  useMiniAppVirtualRows,
} from "../../../components/mini-app/virtual/MiniAppVirtual";
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
    id: "updated",
    header: ORG_MANAGER_LABELS.updated,
    width: "8rem",
  },
] satisfies ReadonlyArray<
  MiniAppTableColumn & { id: GroupContainerTableColumnId }
>;

const GROUP_CONTAINER_COLUMN_LABELS: Readonly<
  Record<GroupContainerTableColumnId, string>
> = {
  access: ORG_MANAGER_LABELS.access,
  container: ORG_MANAGER_LABELS.container,
  updated: ORG_MANAGER_LABELS.updated,
};

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
        <MiniAppTableCell key="updated">
          <MiniAppTableText title={container.updatedAt}>
            {formatMiniAppDate(container.updatedAt)}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
  }
}

function getGroupContainerCompactField(
  columnId: GroupContainerTableColumnId,
  container: OrganizationGroupContainer,
): MiniAppCompactTableField {
  switch (columnId) {
    case "container":
      return {
        id: columnId,
        label: GROUP_CONTAINER_COLUMN_LABELS[columnId],
        text: getContainerDisplayLabel(container),
        title: getContainerDisplayTitle(container),
      };
    case "access":
      return {
        id: columnId,
        label: GROUP_CONTAINER_COLUMN_LABELS[columnId],
        text: getAccessLabel(container.accessLevel),
      };
    case "updated":
      return {
        id: columnId,
        label: GROUP_CONTAINER_COLUMN_LABELS[columnId],
        text: formatMiniAppDate(container.updatedAt),
        title: container.updatedAt,
      };
  }
}

function useGroupContainerTableColumns(compact: boolean): {
  columns: ReadonlyArray<MiniAppTableColumn>;
  visibleColumnIds: ReadonlyArray<GroupContainerTableColumnId>;
} {
  const columnVisibility =
    useMiniAppColumnVisibility<GroupContainerTableColumnId>({
      storageKey: "tearleads.org-manager.group-containers:hidden-columns",
      toggleableColumnIds: GROUP_CONTAINER_TOGGLEABLE_COLUMN_IDS,
    });
  const visibleColumnIds = useMemo(
    () =>
      getVisibleMiniAppTableColumnIds(
        GROUP_CONTAINER_TABLE_COLUMN_IDS,
        columnVisibility.hiddenColumns,
      ),
    [columnVisibility.hiddenColumns],
  );
  const columns = useMemo(() => {
    const columnMenu = (
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
    );
    if (!compact) {
      return addMiniAppTableHeaderAction(
        GROUP_CONTAINER_TABLE_COLUMNS.filter(
          (column) => !columnVisibility.hiddenColumns.has(column.id),
        ),
        columnMenu,
      );
    }

    return addMiniAppTableHeaderAction(
      [
        {
          header: (
            <MiniAppCompactTableHeader
              primary={visibleColumnIds.slice(0, 1).map((id) => ({
                id,
                text: GROUP_CONTAINER_COLUMN_LABELS[id],
              }))}
              secondary={visibleColumnIds.slice(1).map((id) => ({
                id,
                text: GROUP_CONTAINER_COLUMN_LABELS[id],
              }))}
            />
          ),
          id: "summary",
        },
      ],
      columnMenu,
    );
  }, [
    compact,
    columnVisibility.hiddenColumns,
    columnVisibility.toggleColumn,
    visibleColumnIds,
  ]);

  return { columns, visibleColumnIds };
}

export function GroupContainers({
  containers,
}: {
  containers: ReadonlyArray<OrganizationGroupContainer>;
}) {
  const { compact, rowHeight } = useMiniAppCompactTableLayout();
  const virtualContainers = useMiniAppVirtualRows({
    rowHeight,
    rows: containers,
  });
  const { columns, visibleColumnIds } = useGroupContainerTableColumns(compact);

  if (containers.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.noDirectContainerLinks}
      </MiniAppStatus>
    );
  }

  return (
    <MiniAppTableFrame
      className={`mini-app-table-frame--virtual mini-app-table-frame--compact org-manager-virtual-table${
        compact ? " mini-app-table-frame--two-line" : ""
      }`}
      ref={virtualContainers.frameRef}
      style={getMiniAppVirtualFrameStyle(rowHeight)}
    >
      <MiniAppTable
        aria-label={ORG_MANAGER_LABELS.directContainerLinks}
        columns={columns}
      >
        <MiniAppVirtualTableSpacerRow
          colSpan={columns.length}
          height={virtualContainers.topPadding}
        />
        {virtualContainers.rows.map((container) => (
          <MiniAppTableRow key={container.containerId}>
            {compact ? (
              <MiniAppCompactTableCell
                primary={visibleColumnIds
                  .slice(0, 1)
                  .map((columnId) =>
                    getGroupContainerCompactField(columnId, container),
                  )}
                secondary={visibleColumnIds
                  .slice(1)
                  .map((columnId) =>
                    getGroupContainerCompactField(columnId, container),
                  )}
              />
            ) : (
              visibleColumnIds.map((columnId) =>
                renderGroupContainerCell(columnId, container),
              )
            )}
          </MiniAppTableRow>
        ))}
        <MiniAppVirtualTableSpacerRow
          colSpan={columns.length}
          height={virtualContainers.bottomPadding}
        />
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}
