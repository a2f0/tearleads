import type { OrganizationGroupSummary } from "@tearleads/client-sdk";
import type { KeyboardEvent, MouseEvent } from "react";
import { MiniAppStatus } from "../../components/shared/MiniAppLayout";
import {
  MiniAppTable,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
} from "../../components/shared/MiniAppTable";
import {
  getMiniAppVirtualFrameStyle,
  MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
  MiniAppVirtualTableSpacerRow,
  useMiniAppVirtualRows,
} from "../../components/shared/MiniAppVirtual";
import { formatMiniAppDate } from "../../utils/formatMiniAppDate";
import { isKeyboardActivationKey } from "./display";
import { getOrgManagerMemberCountLabel, ORG_MANAGER_LABELS } from "./labels";

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
    className: "org-manager-group-created-column",
    id: "created",
    header: ORG_MANAGER_LABELS.created,
    width: "8rem",
  },
] satisfies ReadonlyArray<MiniAppTableColumn>;

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
  const virtualGroups = useMiniAppVirtualRows({
    rowHeight: MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
    rows: groups,
  });

  if (groups.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.noGroups}
      </MiniAppStatus>
    );
  }

  return (
    <MiniAppTableFrame
      className="mini-app-table-frame--virtual mini-app-table-frame--compact org-manager-virtual-table"
      onContextMenu={(event) => {
        if (event.defaultPrevented) {
          return;
        }

        openGroupContextMenu(event, null);
      }}
      ref={virtualGroups.frameRef}
      style={getMiniAppVirtualFrameStyle(
        MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
      )}
    >
      <MiniAppTable
        aria-label={ORG_MANAGER_LABELS.groups}
        columns={GROUP_TABLE_COLUMNS}
      >
        <MiniAppVirtualTableSpacerRow
          colSpan={GROUP_TABLE_COLUMNS.length}
          height={virtualGroups.topPadding}
        />
        {virtualGroups.rows.map((group) => {
          const isSelected = selectedGroupId === group.groupId;
          const openGroupDetail = () => setSelectedGroupId(group.groupId);
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
              <MiniAppTableCell>
                <MiniAppTableText title={group.groupId}>
                  {group.name}
                </MiniAppTableText>
              </MiniAppTableCell>
              <MiniAppTableCell>
                <MiniAppTableText>
                  {group.currentState
                    ? getOrgManagerMemberCountLabel(
                        group.currentState.memberCount,
                      )
                    : ORG_MANAGER_LABELS.uninitialized}
                </MiniAppTableText>
              </MiniAppTableCell>
              <MiniAppTableCell>
                {group.isBuiltin ? (
                  <MiniAppTableText>
                    {ORG_MANAGER_LABELS.builtIn}
                  </MiniAppTableText>
                ) : null}
              </MiniAppTableCell>
              <MiniAppTableCell className="org-manager-group-created-column">
                <MiniAppTableText title={group.createdAt}>
                  {formatMiniAppDate(group.createdAt)}
                </MiniAppTableText>
              </MiniAppTableCell>
            </MiniAppTableRow>
          );
        })}
        <MiniAppVirtualTableSpacerRow
          colSpan={GROUP_TABLE_COLUMNS.length}
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
