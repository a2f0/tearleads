import { BuildingOfficeIcon } from "@phosphor-icons/react/dist/csr/BuildingOffice";
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
import { useAccountBootstrapProgress } from "../../identity/useAccountBootstrapProgress";
import { useMiniAppBusActions } from "../bus";
import { useOrganizationDashboard } from "./hooks/useOrganizationDashboard";
import type { OrganizationSyncChoices } from "./hooks/useOrganizationSyncChoices";
import { ORGANIZATIONS_LABELS } from "./labels";
import type { OrganizationDashboardCard } from "./model/organizationDashboard";
import { resolveOrganizationsSurfaceState } from "./model/organizationsSurfaceState";
import { OrganizationFolders } from "./OrganizationFolders";
import "./Organizations.css";

const EMPTY_ICON = <BuildingOfficeIcon size={40} weight="light" />;

function cardBadge(card: OrganizationDashboardCard): string {
  if (card.active) return ORGANIZATIONS_LABELS.activeBadge;
  if (card.syncPaused) return ORGANIZATIONS_LABELS.syncPausedBadge;
  return card.workspace
    ? ORGANIZATIONS_LABELS.workspaceBadge
    : ORGANIZATIONS_LABELS.memberBadge;
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

  const progress = useAccountBootstrapProgress();
  const surfaceState = resolveOrganizationsSurfaceState({
    cardCount: cards.length,
    progress,
    ready,
  });

  if (surfaceState) {
    return (
      <MiniAppRoot className="organizations">
        <MiniAppStatePanel
          busy={surfaceState.busy}
          description={surfaceState.description}
          icon={EMPTY_ICON}
          title={surfaceState.title}
        />
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
