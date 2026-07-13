import type {
  OrganizationDirectory,
  OrganizationDirectoryUser,
} from "@tearleads/client-sdk";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useMemo,
} from "react";
import { MiniAppStatus } from "../../../components/shared/MiniAppLayout";
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
import { compactFingerprint, isKeyboardActivationKey } from "../display";
import { ORG_MANAGER_LABELS } from "../labels";

export type DirectoryContextMenuHandler = (
  event: MouseEvent<HTMLElement>,
) => void;
export type RosterUserContextMenuHandler = (
  event: MouseEvent<HTMLElement>,
  userId: string,
) => void;

type DirectoryTableColumnId = "user" | "status" | "joined";
// Adds the trailing touch-only kebab column to the toggleable data columns.
type DirectoryVisibleColumnId = DirectoryTableColumnId | "actions";

const DIRECTORY_TABLE_COLUMN_IDS: ReadonlyArray<DirectoryTableColumnId> = [
  "user",
  "status",
  "joined",
];
const DIRECTORY_TOGGLEABLE_COLUMN_IDS: ReadonlyArray<DirectoryTableColumnId> = [
  "status",
  "joined",
];
const DIRECTORY_COLUMN_MENU_OPTIONS: ReadonlyArray<
  MiniAppColumnMenuOption<DirectoryTableColumnId>
> = [
  { id: "status", label: ORG_MANAGER_LABELS.status },
  { id: "joined", label: ORG_MANAGER_LABELS.joined },
];

const DIRECTORY_TABLE_COLUMNS = [
  {
    id: "user",
    header: ORG_MANAGER_LABELS.user,
    width: "42%",
  },
  {
    id: "status",
    header: ORG_MANAGER_LABELS.status,
    width: "7rem",
  },
  {
    id: "joined",
    header: ORG_MANAGER_LABELS.joined,
    width: "8rem",
  },
] satisfies ReadonlyArray<MiniAppTableColumn & { id: DirectoryTableColumnId }>;

function getDirectoryUserDisplayName(
  user: Pick<OrganizationDirectoryUser, "isSelf" | "userId">,
  profileDisplayNamesByUserId?: ReadonlyMap<string, string> | undefined,
): string {
  return (
    profileDisplayNamesByUserId?.get(user.userId) ??
    (user.isSelf ? ORG_MANAGER_LABELS.self : compactFingerprint(user.userId))
  );
}

function isDirectoryAreaContextMenuTarget(
  event: MouseEvent<HTMLElement>,
): boolean {
  if (!(event.target instanceof Element)) {
    return true;
  }

  const tableRow = event.target.closest(".mini-app-table-row");
  return (
    !tableRow ||
    tableRow.classList.contains("mini-app-virtual-table-spacer-row")
  );
}

function renderDirectoryUserCell(
  columnId: DirectoryTableColumnId,
  params: {
    profileDisplayNamesByUserId?: ReadonlyMap<string, string> | undefined;
    user: OrganizationDirectoryUser;
  },
): ReactNode {
  const { profileDisplayNamesByUserId, user } = params;
  switch (columnId) {
    case "user":
      return (
        <MiniAppTableCell key="user">
          <MiniAppTableText title={user.userId}>
            {getDirectoryUserDisplayName(user, profileDisplayNamesByUserId)}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
    case "status":
      return (
        <MiniAppTableCell key="status">
          <MiniAppTableText>
            {user.status === "disabled"
              ? ORG_MANAGER_LABELS.disabled
              : ORG_MANAGER_LABELS.active}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
    case "joined":
      return (
        <MiniAppTableCell key="joined">
          <MiniAppTableText title={user.joinedAt}>
            {formatMiniAppDate(user.joinedAt)}
          </MiniAppTableText>
        </MiniAppTableCell>
      );
  }
}

function useDirectoryTableColumns(showActions: boolean): {
  columns: ReadonlyArray<MiniAppTableColumn>;
  visibleColumnIds: ReadonlyArray<DirectoryVisibleColumnId>;
} {
  const columnVisibility = useMiniAppColumnVisibility<DirectoryTableColumnId>({
    storageKey: "tearleads.org-manager.directory:hidden-columns",
    toggleableColumnIds: DIRECTORY_TOGGLEABLE_COLUMN_IDS,
  });
  const visibleColumnIds = useMemo<
    ReadonlyArray<DirectoryVisibleColumnId>
  >(() => {
    const dataColumnIds = getVisibleMiniAppTableColumnIds(
      DIRECTORY_TABLE_COLUMN_IDS,
      columnVisibility.hiddenColumns,
    );
    return showActions ? [...dataColumnIds, "actions"] : dataColumnIds;
  }, [columnVisibility.hiddenColumns, showActions]);
  const columns = useMemo(() => {
    // Keep the column-menu trigger on the last data column; the kebab column is
    // appended after so the menu never lands in the narrow actions header.
    const dataColumns = addMiniAppTableHeaderAction(
      DIRECTORY_TABLE_COLUMNS.filter(
        (column) => !columnVisibility.hiddenColumns.has(column.id),
      ),
      <MiniAppColumnMenuButton
        ariaLabel={ORG_MANAGER_LABELS.columns}
        hiddenColumns={columnVisibility.hiddenColumns}
        options={DIRECTORY_COLUMN_MENU_OPTIONS}
        stateLabels={{
          off: ORG_MANAGER_LABELS.columnsMenuStateOff,
          on: ORG_MANAGER_LABELS.columnsMenuStateOn,
        }}
        toggleColumn={columnVisibility.toggleColumn}
      />,
    );
    return showActions
      ? [
          ...dataColumns,
          miniAppRowActionsColumn(ORG_MANAGER_LABELS.rowActionsColumn),
        ]
      : dataColumns;
  }, [
    columnVisibility.hiddenColumns,
    columnVisibility.toggleColumn,
    showActions,
  ]);

  return { columns, visibleColumnIds };
}

export function DirectoryTable({
  directory,
  loading,
  profileDisplayNamesByUserId,
  selectedUserId,
  openRosterUserContextMenu,
  selectUser,
}: {
  directory: OrganizationDirectory | null;
  loading: boolean;
  openRosterUserContextMenu?: RosterUserContextMenuHandler | undefined;
  profileDisplayNamesByUserId?: ReadonlyMap<string, string> | undefined;
  selectedUserId?: string | null;
  selectUser?: ((userId: string) => void) | undefined;
}) {
  const users = directory?.users ?? [];
  const virtualUsers = useMiniAppVirtualRows({
    rowHeight: MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
    rows: users,
  });
  // Touch layouts have no right-click; add the kebab wherever the row context
  // menu is wired.
  const showActions =
    useRoutedLayoutActive() && Boolean(openRosterUserContextMenu);
  const { columns, visibleColumnIds } = useDirectoryTableColumns(showActions);

  if (!directory) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {loading
          ? ORG_MANAGER_LABELS.loadingDirectory
          : ORG_MANAGER_LABELS.directoryUnavailable}
      </MiniAppStatus>
    );
  }

  if (users.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.noDirectUsers}
      </MiniAppStatus>
    );
  }

  return (
    <MiniAppTableFrame
      className="mini-app-table-frame--virtual mini-app-table-frame--compact org-manager-virtual-table"
      ref={virtualUsers.frameRef}
      style={getMiniAppVirtualFrameStyle(
        MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
      )}
    >
      <MiniAppTable aria-label={ORG_MANAGER_LABELS.directory} columns={columns}>
        <MiniAppVirtualTableSpacerRow
          colSpan={visibleColumnIds.length}
          height={virtualUsers.topPadding}
        />
        {virtualUsers.rows.map((user) => {
          const isSelected = selectedUserId === user.userId;
          const openUserDetail = () => {
            selectUser?.(user.userId);
          };
          const handleUserRowKeyDown = (
            event: KeyboardEvent<HTMLTableRowElement>,
          ) => {
            if (selectUser && isKeyboardActivationKey(event.key)) {
              event.preventDefault();
              openUserDetail();
            }
          };

          return (
            <MiniAppTableRow
              aria-selected={selectUser ? isSelected : undefined}
              interactive={Boolean(selectUser)}
              key={user.userId}
              onClick={selectUser ? openUserDetail : undefined}
              onContextMenu={
                openRosterUserContextMenu
                  ? (event) => openRosterUserContextMenu(event, user.userId)
                  : undefined
              }
              onKeyDown={selectUser ? handleUserRowKeyDown : undefined}
              selected={isSelected}
              tabIndex={selectUser ? 0 : undefined}
            >
              {visibleColumnIds.map((columnId) =>
                columnId === "actions" ? (
                  <MiniAppRowActionsCell
                    key="actions"
                    label={`${ORG_MANAGER_LABELS.rowActionsButtonPrefix} ${getDirectoryUserDisplayName(
                      user,
                      profileDisplayNamesByUserId,
                    )}`}
                    onOpen={(event) =>
                      openRosterUserContextMenu?.(event, user.userId)
                    }
                  />
                ) : (
                  renderDirectoryUserCell(columnId, {
                    profileDisplayNamesByUserId,
                    user,
                  })
                ),
              )}
            </MiniAppTableRow>
          );
        })}
        <MiniAppVirtualTableSpacerRow
          colSpan={visibleColumnIds.length}
          height={virtualUsers.bottomPadding}
        />
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}

export function DirectoryListSection({
  directory,
  loading,
  openDirectoryContextMenu,
  openRosterUserContextMenu,
  profileDisplayNamesByUserId,
  selectedUserId,
  selectUser,
}: {
  directory: OrganizationDirectory;
  loading: boolean;
  openDirectoryContextMenu?: DirectoryContextMenuHandler | undefined;
  openRosterUserContextMenu?: RosterUserContextMenuHandler | undefined;
  profileDisplayNamesByUserId: ReadonlyMap<string, string>;
  selectedUserId: string | null;
  selectUser: (userId: string | null) => void;
}) {
  return (
    <section
      aria-label={ORG_MANAGER_LABELS.directory}
      className="org-manager-panel org-manager-panel--context-target"
      onContextMenu={(event) => {
        if (
          event.defaultPrevented ||
          !isDirectoryAreaContextMenuTarget(event)
        ) {
          return;
        }

        openDirectoryContextMenu?.(event);
      }}
    >
      <DirectoryTable
        directory={directory}
        loading={loading}
        openRosterUserContextMenu={openRosterUserContextMenu}
        profileDisplayNamesByUserId={profileDisplayNamesByUserId}
        selectedUserId={selectedUserId}
        selectUser={selectUser}
      />
    </section>
  );
}
