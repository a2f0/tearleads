import type {
  OrganizationDirectory,
  OrganizationDirectoryUser,
} from "@tearleads/client-sdk";
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
import { compactFingerprint } from "../display";
import { ORG_MANAGER_LABELS } from "../labels";
import { useOrgManagerTableColumns } from "../orgManagerTableColumns";

export type DirectoryContextMenuHandler = (
  event: MouseEvent<HTMLElement>,
) => void;
export type RosterUserContextMenuHandler = (
  event: MouseEvent<HTMLElement>,
  userId: string,
) => void;

type DirectoryTableColumnId = "user" | "status" | "joined";

function getDirectoryUserStatusLabel(
  user: OrganizationDirectoryUser,
  syncSeatUserIds: ReadonlySet<string> | null,
): string {
  if (user.status === "disabled") return ORG_MANAGER_LABELS.disabled;
  if (syncSeatUserIds !== null && !syncSeatUserIds.has(user.userId)) {
    return ORG_MANAGER_LABELS.syncSeatUnavailable;
  }
  return ORG_MANAGER_LABELS.active;
}

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
    syncSeatUserIds: ReadonlySet<string> | null;
    user: OrganizationDirectoryUser;
  },
): ReactNode {
  const { profileDisplayNamesByUserId, syncSeatUserIds, user } = params;
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
            {getDirectoryUserStatusLabel(user, syncSeatUserIds)}
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
    syncSeatUserIds: ReadonlySet<string> | null;
    user: OrganizationDirectoryUser;
  },
): MiniAppCompactTableField {
  const { profileDisplayNamesByUserId, syncSeatUserIds, user } = params;
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
        text: getDirectoryUserStatusLabel(user, syncSeatUserIds),
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

const DIRECTORY_TABLE_COLUMNS_CONFIG = {
  allColumnIds: DIRECTORY_TABLE_COLUMN_IDS,
  columnLabels: DIRECTORY_COLUMN_LABELS,
  dataColumns: DIRECTORY_TABLE_COLUMNS,
  menuOptions: DIRECTORY_COLUMN_MENU_OPTIONS,
  storageKey: "tearleads.org-manager.directory:hidden-columns",
  toggleableColumnIds: DIRECTORY_TOGGLEABLE_COLUMN_IDS,
};

function DirectoryUserRow({
  compact,
  openRosterUserContextMenu,
  profileDisplayNamesByUserId,
  selectedUserId,
  selectUser,
  showActions,
  syncSeatUserIds,
  user,
  visibleColumnIds,
}: {
  compact: boolean;
  openRosterUserContextMenu?: RosterUserContextMenuHandler | undefined;
  profileDisplayNamesByUserId?: ReadonlyMap<string, string> | undefined;
  selectedUserId?: string | null | undefined;
  selectUser?: ((userId: string) => void) | undefined;
  showActions: boolean;
  syncSeatUserIds: ReadonlySet<string> | null;
  user: OrganizationDirectoryUser;
  visibleColumnIds: ReadonlyArray<DirectoryTableColumnId>;
}) {
  const isSelected = selectedUserId === user.userId;
  const openUserDetail = () => selectUser?.(user.userId);
  const compactFields = visibleColumnIds.map((columnId) =>
    getDirectoryCompactField(columnId, {
      profileDisplayNamesByUserId,
      syncSeatUserIds,
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
            syncSeatUserIds,
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
  pending,
  profileDisplayNamesByUserId,
  selectedUserId,
  openRosterUserContextMenu,
  selectUser,
  syncSeatUserIds = null,
}: {
  directory: OrganizationDirectory | null;
  // The roster is still being fetched (or has not been fetched yet), so an
  // absent directory is not evidence that there is nothing to show.
  pending: boolean;
  openRosterUserContextMenu?: RosterUserContextMenuHandler | undefined;
  profileDisplayNamesByUserId?: ReadonlyMap<string, string> | undefined;
  selectedUserId?: string | null;
  selectUser?: ((userId: string) => void) | undefined;
  syncSeatUserIds?: ReadonlySet<string> | null | undefined;
}) {
  const users = directory?.users ?? [];
  const virtualUsers = useMiniAppCompactTableRows({ rows: users });
  const { compact, rowHeight } = virtualUsers;
  // Touch layouts have no right-click; add the kebab wherever the row context
  // menu is wired.
  const showActions =
    useRoutedLayoutActive() && Boolean(openRosterUserContextMenu);
  const { columns, visibleColumnIds } = useOrgManagerTableColumns(
    DIRECTORY_TABLE_COLUMNS_CONFIG,
    showActions,
    compact,
  );

  if (!directory) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {pending
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
            syncSeatUserIds={syncSeatUserIds}
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
  pending,
  openDirectoryContextMenu,
  openRosterUserContextMenu,
  profileDisplayNamesByUserId,
  selectedUserId,
  selectUser,
  syncSeatUserIds = null,
}: {
  directory: OrganizationDirectory;
  pending: boolean;
  openDirectoryContextMenu?: DirectoryContextMenuHandler | undefined;
  openRosterUserContextMenu?: RosterUserContextMenuHandler | undefined;
  profileDisplayNamesByUserId: ReadonlyMap<string, string>;
  selectedUserId: string | null;
  selectUser: (userId: string | null) => void;
  syncSeatUserIds?: ReadonlySet<string> | null | undefined;
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
        pending={pending}
        openRosterUserContextMenu={openRosterUserContextMenu}
        profileDisplayNamesByUserId={profileDisplayNamesByUserId}
        selectedUserId={selectedUserId}
        selectUser={selectUser}
        syncSeatUserIds={syncSeatUserIds}
      />
    </section>
  );
}
