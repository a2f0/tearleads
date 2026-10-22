import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";
import { useCallback, useId } from "react";
import {
  MiniAppButton,
  MiniAppPanel,
  MiniAppRoot,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../components/mini-app/MiniAppLayout";
import {
  MiniAppRowButton,
  MiniAppRowText,
} from "../../components/mini-app/rows/MiniAppRow";
import { useMiniAppBusActions } from "../bus";
import { useOrganizationDashboard } from "./hooks/useOrganizationDashboard";
import type { OrganizationSyncChoices } from "./hooks/useOrganizationSyncChoices";
import { ORGANIZATIONS_LABELS } from "./labels";
import type {
  OrganizationDashboardCard,
  OrganizationDashboardFolder,
} from "./model/organizationDashboard";
import "./Organizations.css";

function cardBadge(card: OrganizationDashboardCard): string {
  if (card.active) return ORGANIZATIONS_LABELS.activeBadge;
  if (card.syncPaused) return ORGANIZATIONS_LABELS.syncPausedBadge;
  return card.workspace
    ? ORGANIZATIONS_LABELS.workspaceBadge
    : ORGANIZATIONS_LABELS.memberBadge;
}

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
        {folder.readOnly ? (
          <span className="organizations-badge">
            {ORGANIZATIONS_LABELS.readOnlyBadge}
          </span>
        ) : null}
      </MiniAppRowButton>
    </li>
  );
}

function syncButtonLabel(card: OrganizationDashboardCard, busy: boolean) {
  if (card.syncPaused) {
    return busy
      ? ORGANIZATIONS_LABELS.resumingSync
      : ORGANIZATIONS_LABELS.resumeSync;
  }
  return busy
    ? ORGANIZATIONS_LABELS.pausingSync
    : ORGANIZATIONS_LABELS.pauseSync;
}

function OrganizationSyncButton({
  card,
  syncChoices,
}: {
  card: OrganizationDashboardCard;
  syncChoices: OrganizationSyncChoices;
}) {
  if (!card.canChangeSync) return null;
  const busy = syncChoices.changingOrganizationId === card.organizationId;
  return (
    <MiniAppButton
      disabled={syncChoices.changingOrganizationId !== null}
      onClick={() =>
        void syncChoices.setSyncPaused(card.organizationId, !card.syncPaused)
      }
    >
      {syncButtonLabel(card, busy)}
    </MiniAppButton>
  );
}

function OrganizationFolders({
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

function OrganizationCard({
  card,
  onOpenFolder,
  syncChoices,
}: {
  card: OrganizationDashboardCard;
  onOpenFolder: (folderId: string) => void;
  syncChoices: OrganizationSyncChoices;
}) {
  const headingId = useId();
  const name = card.name ?? ORGANIZATIONS_LABELS.unnamedOrganization;
  return (
    <li>
      <MiniAppPanel
        aria-labelledby={headingId}
        className="organizations-card"
        role="region"
        variant="framed"
      >
        <div className="organizations-card-header">
          <h3 id={headingId}>{name}</h3>
          <span className="organizations-badge">{cardBadge(card)}</span>
        </div>
        <OrganizationFolders
          card={card}
          name={name}
          onOpenFolder={onOpenFolder}
        />
        <OrganizationSyncButton card={card} syncChoices={syncChoices} />
      </MiniAppPanel>
    </li>
  );
}

/**
 * Every organization this user belongs to and the folders they can reach in
 * each, independent of which organization is the active workspace.
 */
export function Organizations() {
  const { cards, ready, syncChoices } = useOrganizationDashboard();
  const { openMiniApp } = useMiniAppBusActions();
  const openFolder = useCallback(
    (folderId: string) =>
      openMiniApp({ appId: "explorer", pathSegments: ["items", folderId] }),
    [openMiniApp],
  );

  return (
    <MiniAppRoot className="organizations">
      <MiniAppSection>
        <MiniAppSectionHeading>
          <h2>{ORGANIZATIONS_LABELS.title}</h2>
        </MiniAppSectionHeading>
        {syncChoices.error ? (
          <MiniAppStatus tone="error">{syncChoices.error}</MiniAppStatus>
        ) : null}
        {!ready ? (
          <MiniAppStatus>{ORGANIZATIONS_LABELS.loading}</MiniAppStatus>
        ) : cards.length === 0 ? (
          <MiniAppStatus>{ORGANIZATIONS_LABELS.empty}</MiniAppStatus>
        ) : (
          <ul
            aria-label={ORGANIZATIONS_LABELS.title}
            className="organizations-list"
          >
            {cards.map((card) => (
              <OrganizationCard
                card={card}
                key={card.organizationId}
                onOpenFolder={openFolder}
                syncChoices={syncChoices}
              />
            ))}
          </ul>
        )}
      </MiniAppSection>
    </MiniAppRoot>
  );
}
