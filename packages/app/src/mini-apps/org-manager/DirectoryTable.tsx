import type {
  OrganizationDirectory,
  OrganizationDirectoryUser,
} from "@tearleads/client-sdk";
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
import { compactFingerprint, isKeyboardActivationKey } from "./display";
import { ORG_MANAGER_LABELS } from "./labels";

export type DirectoryContextMenuHandler = (
  event: MouseEvent<HTMLElement>,
) => void;
export type RosterUserContextMenuHandler = (
  event: MouseEvent<HTMLElement>,
  userId: string,
) => void;

const DIRECTORY_TABLE_COLUMNS = [
  {
    id: "user",
    header: ORG_MANAGER_LABELS.user,
    width: "48%",
  },
  {
    id: "status",
    header: ORG_MANAGER_LABELS.status,
    width: "7rem",
  },
  {
    className: "org-manager-directory-joined-column",
    id: "joined",
    header: ORG_MANAGER_LABELS.joined,
    width: "8rem",
  },
] satisfies ReadonlyArray<MiniAppTableColumn>;

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
      <MiniAppTable
        aria-label={ORG_MANAGER_LABELS.directory}
        columns={DIRECTORY_TABLE_COLUMNS}
      >
        <MiniAppVirtualTableSpacerRow
          colSpan={DIRECTORY_TABLE_COLUMNS.length}
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
              <MiniAppTableCell>
                <MiniAppTableText title={user.userId}>
                  {getDirectoryUserDisplayName(
                    user,
                    profileDisplayNamesByUserId,
                  )}
                </MiniAppTableText>
              </MiniAppTableCell>
              <MiniAppTableCell>
                <MiniAppTableText>
                  {user.status === "disabled"
                    ? ORG_MANAGER_LABELS.disabled
                    : ORG_MANAGER_LABELS.active}
                </MiniAppTableText>
              </MiniAppTableCell>
              <MiniAppTableCell className="org-manager-directory-joined-column">
                <MiniAppTableText title={user.joinedAt}>
                  {formatMiniAppDate(user.joinedAt)}
                </MiniAppTableText>
              </MiniAppTableCell>
            </MiniAppTableRow>
          );
        })}
        <MiniAppVirtualTableSpacerRow
          colSpan={DIRECTORY_TABLE_COLUMNS.length}
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
