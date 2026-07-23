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
import { MiniAppStatus } from "../../../components/mini-app/MiniAppLayout";
import {
  addMiniAppTableHeaderAction,
  getVisibleMiniAppTableColumnIds,
  MiniAppColumnMenuButton,
  type MiniAppColumnMenuOption,
  MiniAppCompactTableCell,
  type MiniAppCompactTableField,
  MiniAppCompactTableHeader,
  MiniAppRowActionsCell,
  MiniAppTable,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
  miniAppRowActionsColumn,
  useMiniAppColumnVisibility,
  useMiniAppCompactTableLayout,
} from "../../../components/mini-app/MiniAppTable";
import {
  getMiniAppVirtualFrameStyle,
  MiniAppVirtualTableSpacerRow,
  useMiniAppVirtualRows,
} from "../../../components/mini-app/virtual/MiniAppVirtual";
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

const DIRECTORY_COLUMN_LABELS: Readonly<
  Record<DirectoryTableColumnId, string>
> = {
  joined: ORG_MANAGER_LABELS.joined,
  status: ORG_MANAGER_LABELS.status,
  user: ORG_MANAGER_LABELS.user,
};

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

function getDirectoryCompactField(
  columnId: DirectoryTableColumnId,
  params: {
    profileDisplayNamesByUserId?: ReadonlyMap<string, string> | undefined;
    user: OrganizationDirectoryUser;
  },
): MiniAppCompactTableField {
  const { profileDisplayNamesByUserId, user } = params;
  switch (columnId) {
    case "user":
      return {
        id: columnId,
        label: DIRECTORY_COLUMN_LABELS[columnId],
        text: getDirectoryUserDisplayName(user, profileDisplayNamesByUserId),
        title: user.userId,
      };
    case "status":
      return {
        id: columnId,
        label: DIRECTORY_COLUMN_LABELS[columnId],
        text:
          user.status === "disabled"
            ? ORG_MANAGER_LABELS.disabled
            : ORG_MANAGER_LABELS.active,
      };
    case "joined":
      return {
        id: columnId,
        label: DIRECTORY_COLUMN_LABELS[columnId],
        text: formatMiniAppDate(user.joinedAt),
        title: user.joinedAt,
      };
  }
}

function useDirectoryTableColumns(
  showActions: boolean,
  compact: boolean,
): {
  columns: ReadonlyArray<MiniAppTableColumn>;
  visibleColumnIds: ReadonlyArray<DirectoryTableColumnId>;
} {
  const columnVisibility = useMiniAppColumnVisibility<DirectoryTableColumnId>({
    storageKey: "tearleads.org-manager.directory:hidden-columns",
    toggleableColumnIds: DIRECTORY_TOGGLEABLE_COLUMN_IDS,
  });
  const visibleColumnIds = useMemo(
    () =>
      getVisibleMiniAppTableColumnIds(
        DIRECTORY_TABLE_COLUMN_IDS,
        columnVisibility.hiddenColumns,
      ),
    [columnVisibility.hiddenColumns],
  );
  const columns = useMemo(() => {
    const columnMenu = (
      <MiniAppColumnMenuButton
        ariaLabel={ORG_MANAGER_LABELS.columns}
        hiddenColumns={columnVisibility.hiddenColumns}
        options={DIRECTORY_COLUMN_MENU_OPTIONS}
        stateLabels={{
          off: ORG_MANAGER_LABELS.columnsMenuStateOff,
          on: ORG_MANAGER_LABELS.columnsMenuStateOn,
        }}
        toggleColumn={columnVisibility.toggleColumn}
      />
    );
    const dataColumns = DIRECTORY_TABLE_COLUMNS.filter(
      (column) => !columnVisibility.hiddenColumns.has(column.id),
    );
    if (compact) {
      const compactColumn = {
        header: (
          <MiniAppCompactTableHeader
            primary={visibleColumnIds.slice(0, 1).map((id) => ({
              id,
              text: DIRECTORY_COLUMN_LABELS[id],
            }))}
            secondary={visibleColumnIds.slice(1).map((id) => ({
              id,
              text: DIRECTORY_COLUMN_LABELS[id],
            }))}
          />
        ),
        id: "summary",
      } satisfies MiniAppTableColumn;

      return showActions
        ? [
            compactColumn,
            miniAppRowActionsColumn(
              ORG_MANAGER_LABELS.rowActionsColumn,
              columnMenu,
            ),
          ]
        : addMiniAppTableHeaderAction([compactColumn], columnMenu);
    }
    // When the touch kebab column trails the table it is the trailing edge, so
    // the column-menu trigger rides in its header to stay flush right — on the
    // last data column it would sit one narrow column in from the edge.
    return showActions
      ? [
          ...dataColumns,
          miniAppRowActionsColumn(
            ORG_MANAGER_LABELS.rowActionsColumn,
            columnMenu,
          ),
        ]
      : addMiniAppTableHeaderAction(dataColumns, columnMenu);
  }, [
    compact,
    columnVisibility.hiddenColumns,
    columnVisibility.toggleColumn,
    showActions,
    visibleColumnIds,
  ]);

  return { columns, visibleColumnIds };
}

function DirectoryUserRow({
  compact,
  openRosterUserContextMenu,
  profileDisplayNamesByUserId,
  selectedUserId,
  selectUser,
  showActions,
  user,
  visibleColumnIds,
}: {
  compact: boolean;
  openRosterUserContextMenu?: RosterUserContextMenuHandler | undefined;
  profileDisplayNamesByUserId?: ReadonlyMap<string, string> | undefined;
  selectedUserId?: string | null | undefined;
  selectUser?: ((userId: string) => void) | undefined;
  showActions: boolean;
  user: OrganizationDirectoryUser;
  visibleColumnIds: ReadonlyArray<DirectoryTableColumnId>;
}) {
  const isSelected = selectedUserId === user.userId;
  const openUserDetail = () => selectUser?.(user.userId);
  const compactFields = visibleColumnIds.map((columnId) =>
    getDirectoryCompactField(columnId, {
      profileDisplayNamesByUserId,
      user,
    }),
  );
  const handleUserRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (selectUser && isKeyboardActivationKey(event.key)) {
      event.preventDefault();
      openUserDetail();
    }
  };

  return (
    <MiniAppTableRow
      aria-selected={selectUser ? isSelected : undefined}
      interactive={Boolean(selectUser)}
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
      {compact ? (
        <MiniAppCompactTableCell
          primary={compactFields.slice(0, 1)}
          secondary={compactFields.slice(1)}
        />
      ) : (
        visibleColumnIds.map((columnId) =>
          renderDirectoryUserCell(columnId, {
            profileDisplayNamesByUserId,
            user,
          }),
        )
      )}
      {showActions ? (
        <MiniAppRowActionsCell
          label={`${ORG_MANAGER_LABELS.rowActionsButtonPrefix} ${getDirectoryUserDisplayName(
            user,
            profileDisplayNamesByUserId,
          )}`}
          onOpen={(event) => openRosterUserContextMenu?.(event, user.userId)}
        />
      ) : null}
    </MiniAppTableRow>
  );
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
  const { compact, rowHeight } = useMiniAppCompactTableLayout();
  const virtualUsers = useMiniAppVirtualRows({
    rowHeight,
    rows: users,
  });
  // Touch layouts have no right-click; add the kebab wherever the row context
  // menu is wired.
  const showActions =
    useRoutedLayoutActive() && Boolean(openRosterUserContextMenu);
  const { columns, visibleColumnIds } = useDirectoryTableColumns(
    showActions,
    compact,
  );

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
      className={`mini-app-table-frame--virtual mini-app-table-frame--compact org-manager-virtual-table${
        compact ? " mini-app-table-frame--two-line" : ""
      }`}
      ref={virtualUsers.frameRef}
      style={getMiniAppVirtualFrameStyle(rowHeight)}
    >
      <MiniAppTable aria-label={ORG_MANAGER_LABELS.directory} columns={columns}>
        <MiniAppVirtualTableSpacerRow
          colSpan={columns.length}
          height={virtualUsers.topPadding}
        />
        {virtualUsers.rows.map((user) => (
          <DirectoryUserRow
            compact={compact}
            key={user.userId}
            openRosterUserContextMenu={openRosterUserContextMenu}
            profileDisplayNamesByUserId={profileDisplayNamesByUserId}
            selectedUserId={selectedUserId}
            selectUser={selectUser}
            showActions={showActions}
            user={user}
            visibleColumnIds={visibleColumnIds}
          />
        ))}
        <MiniAppVirtualTableSpacerRow
          colSpan={columns.length}
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
