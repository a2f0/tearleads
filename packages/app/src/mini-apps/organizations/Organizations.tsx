import { BuildingOfficeIcon } from "@phosphor-icons/react/dist/csr/BuildingOffice";
import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";
import { useCallback, useId } from "react";
import {
  MiniAppButton,
  MiniAppPanel,
  MiniAppRoot,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatePanel,
  MiniAppStatus,
} from "../../components/mini-app/MiniAppLayout";
import {
  MiniAppRowButton,
  MiniAppRowText,
} from "../../components/mini-app/rows/MiniAppRow";
import { useAccountBootstrapProgress } from "../../identity/useAccountBootstrapProgress";
import { useMiniAppBusActions } from "../bus";
import { useOrganizationDashboard } from "./hooks/useOrganizationDashboard";
import type { OrganizationSyncChoices } from "./hooks/useOrganizationSyncChoices";
import { ORGANIZATIONS_LABELS } from "./labels";
import type {
  OrganizationDashboardCard,
  OrganizationDashboardFolder,
} from "./model/organizationDashboard";
import "./Organizations.css";

const EMPTY_ICON = <BuildingOfficeIcon size={40} weight="light" />;

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

function leaveButtonLabel(card: OrganizationDashboardCard, busy: boolean) {
  if (card.leaveRequested) {
    return busy
      ? ORGANIZATIONS_LABELS.withdrawingLeaveRequest
      : ORGANIZATIONS_LABELS.withdrawLeaveRequest;
  }
  return busy
    ? ORGANIZATIONS_LABELS.askingToLeave
    : ORGANIZATIONS_LABELS.askToLeave;
}

function OrganizationLeaveButton({
  card,
  syncChoices,
}: {
  card: OrganizationDashboardCard;
  syncChoices: OrganizationSyncChoices;
}) {
  if (!card.canAskToLeave) return null;
  const busy = syncChoices.changingOrganizationId === card.organizationId;
  return (
    <MiniAppButton
      disabled={syncChoices.changingOrganizationId !== null}
      onClick={() =>
        void syncChoices.setLeaveRequested(
          card.organizationId,
          !card.leaveRequested,
        )
      }
    >
      {leaveButtonLabel(card, busy)}
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
        {card.leaveRequested ? (
          <MiniAppStatus>
            {ORGANIZATIONS_LABELS.leaveRequestedStatus}
          </MiniAppStatus>
        ) : null}
        <div className="organizations-card-actions">
          <OrganizationSyncButton card={card} syncChoices={syncChoices} />
          <OrganizationLeaveButton card={card} syncChoices={syncChoices} />
        </div>
      </MiniAppPanel>
    </li>
  );
}

/**
 * Whole-surface stand-ins for the list: account setup still running, the
 * dashboard still loading, or genuinely no organizations yet.
 */
function OrganizationsStatePanel({ ready }: { ready: boolean }) {
  const progress = useAccountBootstrapProgress();
  if (progress) {
    return (
      <MiniAppStatePanel
        busy
        description={progress.description}
        title={progress.title}
      />
    );
  }
  if (!ready) {
    return <MiniAppStatePanel busy title={ORGANIZATIONS_LABELS.loading} />;
  }
  return (
    <MiniAppStatePanel
      description={ORGANIZATIONS_LABELS.emptyDescription}
      icon={EMPTY_ICON}
      title={ORGANIZATIONS_LABELS.empty}
    />
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

  if (!ready || cards.length === 0) {
    return (
      <MiniAppRoot className="organizations">
        <OrganizationsStatePanel ready={ready} />
      </MiniAppRoot>
    );
  }

  return (
    <MiniAppRoot className="organizations">
      <MiniAppSection>
        <MiniAppSectionHeading>
          <h2>{ORGANIZATIONS_LABELS.title}</h2>
        </MiniAppSectionHeading>
        {syncChoices.error ? (
          <MiniAppStatus tone="error">{syncChoices.error}</MiniAppStatus>
        ) : null}
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
      </MiniAppSection>
    </MiniAppRoot>
  );
}
