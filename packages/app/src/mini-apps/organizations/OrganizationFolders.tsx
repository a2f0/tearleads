import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";
import type { ContainerShareAccessLevel } from "@tearleads/client-sdk";
import { MiniAppStatus } from "../../components/mini-app/MiniAppLayout";
import {
  MiniAppRowButton,
  MiniAppRowText,
} from "../../components/mini-app/rows/MiniAppRow";
import { ORGANIZATIONS_LABELS } from "./labels";
import type {
  OrganizationDashboardCard,
  OrganizationDashboardFolder,
} from "./model/organizationDashboard";

const PERMISSION_LABELS = {
  admin: ORGANIZATIONS_LABELS.permissionAdmin,
  read: ORGANIZATIONS_LABELS.permissionRead,
  write: ORGANIZATIONS_LABELS.permissionWrite,
} satisfies Record<ContainerShareAccessLevel, string>;

function OrganizationFolderRow({
  folder,
  onOpen,
}: {
  folder: OrganizationDashboardFolder;
  onOpen: (folderId: string) => void;
}) {
  return (
    <li>
      <MiniAppRowButton onClick={() => onOpen(folder.id)}>
        <FolderIcon aria-hidden="true" focusable="false" size={18} />
        <MiniAppRowText>
          {folder.workspaceRoot
            ? ORGANIZATIONS_LABELS.workspaceRoot
            : folder.name}
        </MiniAppRowText>
        <span
          className="organizations-badge"
          title={ORGANIZATIONS_LABELS.permission}
        >
          {PERMISSION_LABELS[folder.accessLevel]}
        </span>
      </MiniAppRowButton>
    </li>
  );
}

/**
 * One organization's entry-point folders, each with the user's effective
 * permission on it.
 */
export function OrganizationFolders({
  card,
  name,
  onOpenFolder,
}: {
  card: OrganizationDashboardCard;
  name: string;
  onOpenFolder: (folderId: string) => void;
}) {
  if (card.syncPaused) {
    return (
      <MiniAppStatus>{ORGANIZATIONS_LABELS.syncPausedStatus}</MiniAppStatus>
    );
  }
  if (card.folders.length === 0) {
    return <MiniAppStatus>{ORGANIZATIONS_LABELS.noFolders}</MiniAppStatus>;
  }
  return (
    <ul
      aria-label={ORGANIZATIONS_LABELS.foldersIn(name)}
      className="organizations-folders"
    >
      {card.folders.map((folder) => (
        <OrganizationFolderRow
          folder={folder}
          key={folder.id}
          onOpen={onOpenFolder}
        />
      ))}
    </ul>
  );
}
