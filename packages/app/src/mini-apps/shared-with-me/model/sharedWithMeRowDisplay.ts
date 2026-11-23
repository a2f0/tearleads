import type { ContainerShareAccessLevel } from "@tearleads/client-sdk";
import { SHARED_WITH_ME_LABELS } from "../labels";
import type { SharedOrganization, SharedWithMeRow } from "./sharedWithMeRows";

const PERMISSION_LABELS = {
  admin: SHARED_WITH_ME_LABELS.permissionAdmin,
  read: SHARED_WITH_ME_LABELS.permissionRead,
  write: SHARED_WITH_ME_LABELS.permissionWrite,
} satisfies Record<ContainerShareAccessLevel, string>;

/** A short status word for the row, and the sentence that explains it. */
interface SharedWithMeRowStatus {
  readonly detail: string;
  readonly label: string;
}

export function organizationDisplayName(
  organization: SharedOrganization,
): string {
  return organization.name ?? SHARED_WITH_ME_LABELS.unnamedOrganization;
}

export function rowDisplayName(row: SharedWithMeRow): string {
  if (row.kind === "organization") {
    return organizationDisplayName(row.organization);
  }
  return row.folder.workspaceRoot
    ? SHARED_WITH_ME_LABELS.workspaceRoot
    : row.folder.name;
}

/** The user's effective permission on a folder; an organization row has none. */
export function rowPermissionLabel(row: SharedWithMeRow): string {
  return row.kind === "folder"
    ? PERMISSION_LABELS[row.folder.accessLevel]
    : SHARED_WITH_ME_LABELS.permissionNone;
}

function rowStatuses(
  row: SharedWithMeRow,
  changing: boolean,
): SharedWithMeRowStatus[] {
  if (changing) {
    return [
      {
        detail: SHARED_WITH_ME_LABELS.updatingStatus,
        label: SHARED_WITH_ME_LABELS.updatingStatus,
      },
    ];
  }
  const { organization } = row;
  // Sync is always one of two states, so the row always names it.
  const statuses: SharedWithMeRowStatus[] = [
    organization.syncPaused
      ? {
          detail: SHARED_WITH_ME_LABELS.syncPausedStatusDetail,
          label: SHARED_WITH_ME_LABELS.syncPausedStatus,
        }
      : {
          detail: SHARED_WITH_ME_LABELS.syncEnabledStatusDetail,
          label: SHARED_WITH_ME_LABELS.syncEnabledStatus,
        },
  ];
  if (organization.leaveRequested) {
    statuses.push({
      detail: SHARED_WITH_ME_LABELS.leaveRequestedStatusDetail,
      label: SHARED_WITH_ME_LABELS.leaveRequestedStatus,
    });
  }
  // A device that first met the organization paused has not listed its
  // folders, so it cannot say that none are shared.
  if (row.kind === "organization" && !organization.syncPaused) {
    statuses.push({
      detail: SHARED_WITH_ME_LABELS.nothingSharedStatusDetail,
      label: SHARED_WITH_ME_LABELS.nothingSharedStatus,
    });
  }
  return statuses;
}

/**
 * The row's status column: whether its organization syncs and what else the
 * user chose for it, or the change still running for it.
 */
export function rowStatusText(
  row: SharedWithMeRow,
  changing: boolean,
): { readonly label: string; readonly title: string } {
  const statuses = rowStatuses(row, changing);
  return {
    label: statuses.map((status) => status.label).join(", "),
    title: statuses.map((status) => status.detail).join(" "),
  };
}
