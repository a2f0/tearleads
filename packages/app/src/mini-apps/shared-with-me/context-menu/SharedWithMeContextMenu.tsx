import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { PauseIcon } from "@phosphor-icons/react/dist/csr/Pause";
import { PlayIcon } from "@phosphor-icons/react/dist/csr/Play";
import { SignOutIcon } from "@phosphor-icons/react/dist/csr/SignOut";
import { Menu, MenuItem, type MenuPosition } from "@tearleads/windowing";
import type { OrganizationSyncChoices } from "../hooks/useOrganizationSyncChoices";
import { SHARED_WITH_ME_LABELS } from "../labels";
import { organizationDisplayName } from "../model/sharedWithMeRowDisplay";
import type { SharedWithMeRow } from "../model/sharedWithMeRows";

/**
 * Everything the user can do with one Shared with Me row: open its folder, and
 * the choices that apply to the whole organization it came from. One change
 * runs at a time, so those are disabled while any is running.
 */
export function SharedWithMeContextMenu({
  onClose,
  onOpenFolder,
  position,
  row,
  syncChoices,
}: {
  onClose: () => void;
  onOpenFolder: (folderId: string) => void;
  position: MenuPosition;
  row: SharedWithMeRow;
  syncChoices: OrganizationSyncChoices;
}) {
  const { organization } = row;
  const organizationName = organizationDisplayName(organization);
  const changing = syncChoices.changingOrganizationId !== null;
  const run = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <Menu direction="down" onClose={onClose} position={position}>
      {row.kind === "folder" ? (
        <MenuItem
          icon={FolderOpenIcon}
          label={SHARED_WITH_ME_LABELS.open}
          onClick={() => run(() => onOpenFolder(row.folder.id))}
        />
      ) : null}
      <MenuItem
        disabled={changing}
        icon={organization.syncPaused ? PlayIcon : PauseIcon}
        label={
          organization.syncPaused
            ? SHARED_WITH_ME_LABELS.resumeSync(organizationName)
            : SHARED_WITH_ME_LABELS.pauseSync(organizationName)
        }
        onClick={() =>
          run(
            () =>
              void syncChoices.setSyncPaused(
                organization.organizationId,
                !organization.syncPaused,
              ),
          )
        }
      />
      {organization.canAskToLeave ? (
        <MenuItem
          disabled={changing}
          icon={SignOutIcon}
          label={
            organization.leaveRequested
              ? SHARED_WITH_ME_LABELS.withdrawLeaveRequest(organizationName)
              : SHARED_WITH_ME_LABELS.askToLeave(organizationName)
          }
          onClick={() =>
            run(
              () =>
                void syncChoices.setLeaveRequested(
                  organization.organizationId,
                  !organization.leaveRequested,
                ),
            )
          }
        />
      ) : null}
    </Menu>
  );
}
