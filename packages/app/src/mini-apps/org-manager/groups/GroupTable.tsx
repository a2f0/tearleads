import type { OrganizationGroupSummary } from "@tearleads/client-sdk";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { MiniAppStatus } from "../../../components/mini-app/MiniAppLayout";
import {
  type MiniAppColumnMenuOption,
  MiniAppCompactTableCell,
  type MiniAppCompactTableField,
  MiniAppRowActionsCell,
  MiniAppTable,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
  useMiniAppCompactTableRows,
} from "../../../components/mini-app/MiniAppTable";
import {
  getMiniAppVirtualFrameStyle,
  MiniAppVirtualTableSpacerRow,
} from "../../../components/mini-app/virtual/MiniAppVirtual";
import { useRoutedLayoutActive } from "../../../navigation/useRoutedLayoutActive";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import { isKeyboardActivationKey } from "../../../utils/keyboardActivation";
import { getOrgManagerMemberCountLabel, ORG_MANAGER_LABELS } from "../labels";
import { useOrgManagerTableColumns } from "../orgManagerTableColumns";

type GroupTableColumnId = "group" | "members" | "status" | "created";

const GROUP_TABLE_COLUMN_IDS: ReadonlyArray<GroupTableColumnId> = [
  "group",
  "members",
  "status",
  "created",
];
const GROUP_TOGGLEABLE_COLUMN_IDS: ReadonlyArray<GroupTableColumnId> = [
  "members",
  "status",
  "created",
];
const GROUP_COLUMN_MENU_OPTIONS: ReadonlyArray<
  MiniAppColumnMenuOption<GroupTableColumnId>
> = [
  { id: "members", label: ORG_MANAGER_LABELS.members },
  { id: "status", label: ORG_MANAGER_LABELS.status },
  { id: "created", label: ORG_MANAGER_LABELS.created },
];

const GROUP_TABLE_COLUMNS = [
  {
    id: "group",
    header: ORG_MANAGER_LABELS.group,
    width: "48%",
  },
  {
    id: "members",
    header: ORG_MANAGER_LABELS.members,
    width: "8rem",
  },
  {
    id: "status",
    header: ORG_MANAGER_LABELS.status,
    width: "7rem",
  },
  {
    id: "created",
    header: ORG_MANAGER_LABELS.created,
    width: "8rem",
  },
] satisfies ReadonlyArray<MiniAppTableColumn & { id: GroupTableColumnId }>;

const GROUP_COLUMN_LABELS: Readonly<Record<GroupTableColumnId, string>> = {
  created: ORG_MANAGER_LABELS.created,
  group: ORG_MANAGER_LABELS.group,
  members: ORG_MANAGER_LABELS.members,
  status: ORG_MANAGER_LABELS.status,
};

function renderGroupCell(
  columnId: GroupTableColumnId,
  group: OrganizationGroupSummary,
): ReactNode {
  switch (columnId) {
    case "group":
      return (
        <MiniAppTableCell key="group">
          <MiniAppTableText title={group.groupId}>
            {group.name}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
    case "members":
      return (
        <MiniAppTableCell key="members">
          <MiniAppTableText>
            {group.currentState
              ? getOrgManagerMemberCountLabel(group.currentState.memberCount)
              : ORG_MANAGER_LABELS.uninitialized}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
    case "status":
      return (
        <MiniAppTableCell key="status">
          {group.isBuiltin ? (
            <MiniAppTableText>{ORG_MANAGER_LABELS.builtIn}</MiniAppTableText>
          ) : null}
        </MiniAppTableCell>
      );
    case "created":
      return (
        <MiniAppTableCell key="created">
          <MiniAppTableText title={group.createdAt}>
            {formatMiniAppDate(group.createdAt)}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
  }
}

function getGroupCompactField(
  columnId: GroupTableColumnId,
  group: OrganizationGroupSummary,
): MiniAppCompactTableField {
  switch (columnId) {
    case "group":
      return {
        id: columnId,
        label: GROUP_COLUMN_LABELS[columnId],
        text: group.name,
        title: group.groupId,
      };
    case "members":
      return {
        id: columnId,
        label: GROUP_COLUMN_LABELS[columnId],
        text: group.currentState
          ? getOrgManagerMemberCountLabel(group.currentState.memberCount)
          : ORG_MANAGER_LABELS.uninitialized,
      };
    case "status":
      return {
        id: columnId,
        label: GROUP_COLUMN_LABELS[columnId],
        text: group.isBuiltin ? ORG_MANAGER_LABELS.builtIn : "",
      };
    case "created":
      return {
        id: columnId,
        label: GROUP_COLUMN_LABELS[columnId],
        text: formatMiniAppDate(group.createdAt),
        title: group.createdAt,
      };
  }
}

const GROUP_TABLE_COLUMNS_CONFIG = {
  allColumnIds: GROUP_TABLE_COLUMN_IDS,
  columnLabels: GROUP_COLUMN_LABELS,
  dataColumns: GROUP_TABLE_COLUMNS,
  menuOptions: GROUP_COLUMN_MENU_OPTIONS,
  storageKey: "tearleads.org-manager.groups:hidden-columns",
  toggleableColumnIds: GROUP_TOGGLEABLE_COLUMN_IDS,
};

function GroupTable({
  groups,
  openGroupContextMenu,
  selectedGroupId,
  setSelectedGroupId,
}: {
  groups: ReadonlyArray<OrganizationGroupSummary>;
  openGroupContextMenu: (
    event: MouseEvent<HTMLElement>,
    groupId: string | null,
  ) => void;
  selectedGroupId: string | null;
  setSelectedGroupId: (groupId: string) => void;
}) {
  const virtualGroups = useMiniAppCompactTableRows({ rows: groups });
  const { compact, rowHeight } = virtualGroups;
  // Touch layouts have no right-click; add the kebab as the touch stand-in.
  const showActions = useRoutedLayoutActive();
  const { columns, visibleColumnIds } = useOrgManagerTableColumns(
    GROUP_TABLE_COLUMNS_CONFIG,
    showActions,
    compact,
  );

  if (groups.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.noGroups}
      </MiniAppStatus>
    );
  }

  return (
    <MiniAppTableFrame
      className={`mini-app-table-frame--virtual mini-app-table-frame--compact org-manager-virtual-table${
        compact ? " mini-app-table-frame--two-line" : ""
      }`}
      onContextMenu={(event) => {
        if (event.defaultPrevented) {
          return;
        }

        openGroupContextMenu(event, null);
      }}
      ref={virtualGroups.frameRef}
      style={getMiniAppVirtualFrameStyle(rowHeight)}
    >
      <MiniAppTable aria-label={ORG_MANAGER_LABELS.groups} columns={columns}>
        <MiniAppVirtualTableSpacerRow
          colSpan={columns.length}
          height={virtualGroups.topPadding}
        />
        {virtualGroups.rows.map((group) => {
          const isSelected = selectedGroupId === group.groupId;
          const openGroupDetail = () => setSelectedGroupId(group.groupId);
          const compactFields = visibleColumnIds.map((columnId) =>
            getGroupCompactField(columnId, group),
          );
          const handleGroupRowKeyDown = (
            event: KeyboardEvent<HTMLTableRowElement>,
          ) => {
            if (isKeyboardActivationKey(event.key)) {
              event.preventDefault();
              openGroupDetail();
            }
          };

          return (
            <MiniAppTableRow
              aria-selected={isSelected}
              interactive
              key={group.groupId}
              onClick={openGroupDetail}
              onContextMenu={(event) =>
                openGroupContextMenu(event, group.groupId)
              }
              onKeyDown={handleGroupRowKeyDown}
              selected={isSelected}
              tabIndex={0}
            >
              {compact ? (
                <MiniAppCompactTableCell
                  primary={compactFields.slice(0, 1)}
                  secondary={compactFields.slice(1)}
                />
              ) : (
                visibleColumnIds.map((columnId) =>
                  renderGroupCell(columnId, group),
                )
              )}
              {showActions ? (
                <MiniAppRowActionsCell
                  key="actions"
                  label={`${ORG_MANAGER_LABELS.rowActionsButtonPrefix} ${group.name}`}
                  onOpen={(event) => openGroupContextMenu(event, group.groupId)}
                />
              ) : null}
            </MiniAppTableRow>
          );
        })}
        <MiniAppVirtualTableSpacerRow
          colSpan={columns.length}
          height={virtualGroups.bottomPadding}
        />
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}

export function GroupListSection({
  groups,
  openGroupContextMenu,
  selectedGroupId,
  selectGroup,
}: {
  groups: ReadonlyArray<OrganizationGroupSummary>;
  openGroupContextMenu: (
    event: MouseEvent<HTMLElement>,
    groupId: string | null,
  ) => void;
  selectedGroupId: string | null;
  selectGroup: (groupId: string | null) => void;
}) {
  return (
    <section
      aria-label={ORG_MANAGER_LABELS.groups}
      className="org-manager-panel org-manager-panel--context-target"
      onContextMenu={(event) => {
        if (event.defaultPrevented) {
          return;
        }

        openGroupContextMenu(event, null);
      }}
    >
      <GroupTable
        groups={groups}
        openGroupContextMenu={openGroupContextMenu}
        selectedGroupId={selectedGroupId}
        setSelectedGroupId={selectGroup}
      />
    </section>
  );
}
