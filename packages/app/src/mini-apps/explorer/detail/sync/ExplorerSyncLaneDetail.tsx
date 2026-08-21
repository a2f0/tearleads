import type {
  DomainSyncSnapshot,
  SyncLaneSnapshot,
} from "@symcrypt/client-sdk";
import type { ReactNode } from "react";
import { useEffect, useId, useState } from "react";
import {
  MiniAppButton,
  MiniAppInfoSection,
  MiniAppStatus,
  type MiniAppTabDescriptor,
  MiniAppTabList,
  MiniAppTabPanel,
} from "../../../../components/mini-app/MiniAppLayout";
import { MiniAppKeyValueTable } from "../../../../components/mini-app/MiniAppTable";
import { formatByteLength } from "../../../../utils/formatByteLength";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";
import { EXPLORER_LABELS, getExplorerSyncLaneCountLabel } from "../../labels";
import {
  ExplorerSyncLaneProgress,
  ExplorerSyncLaneStatusBadge,
} from "./ExplorerSyncLaneShared";
import {
  formatExplorerSyncLaneBoolean,
  getExplorerSyncLaneProgressPercent,
  getSyncLaneLastActionLabel,
  getSyncLanePhaseLabel,
} from "./ExplorerSyncLaneUtils";

type SyncLaneProgress = NonNullable<SyncLaneSnapshot["progress"]>;

function formatSyncLaneDateTime(value: string | null): string {
  return formatMiniAppDateTime(value, { emptyFallback: "-" });
}

function formatSyncLaneProgressPercent(lane: SyncLaneSnapshot): string {
  return `${getExplorerSyncLaneProgressPercent(lane)}%`;
}

function formatSyncLaneProgressBytes(progress: SyncLaneProgress): string {
  return `${formatByteLength(progress.bytesUploaded)} / ${formatByteLength(
    progress.bytesTotal,
  )}`;
}

function formatSyncLaneProgressParts(progress: SyncLaneProgress): string {
  return `${progress.partsCompleted.toLocaleString()} / ${progress.partsTotal.toLocaleString()}`;
}

function ExplorerSyncLaneInfoRow(params: {
  children: ReactNode;
  label: string;
  title?: string | null | undefined;
}) {
  return (
    <tr>
      <th>{params.label}</th>
      <td title={params.title ?? undefined}>{params.children}</td>
    </tr>
  );
}

function ExplorerSyncLaneGeneralSection(params: {
  lane: SyncLaneSnapshot;
  onOpenBlobDetail?: ((storageKey: string) => void) | undefined;
}) {
  const { lane } = params;
  const blobStorageKey = lane.blobStorageKey;

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.syncLanesGeneralHeading}>
      <MiniAppKeyValueTable>
        <tbody>
          <ExplorerSyncLaneInfoRow
            label={EXPLORER_LABELS.syncLanesLabelRow}
            title={lane.label}
          >
            {lane.label}
          </ExplorerSyncLaneInfoRow>
          <ExplorerSyncLaneInfoRow
            label={EXPLORER_LABELS.syncLanesKeyRow}
            title={lane.key}
          >
            <code>{lane.key}</code>
          </ExplorerSyncLaneInfoRow>
          <ExplorerSyncLaneInfoRow label={EXPLORER_LABELS.syncLanesPhaseColumn}>
            {getSyncLanePhaseLabel(lane.phase)}
          </ExplorerSyncLaneInfoRow>
          <ExplorerSyncLaneInfoRow
            label={EXPLORER_LABELS.syncLanesStatusColumn}
          >
            <ExplorerSyncLaneStatusBadge status={lane.status} />
          </ExplorerSyncLaneInfoRow>
          <ExplorerSyncLaneInfoRow
            label={EXPLORER_LABELS.syncLanesRegistrationRow}
          >
            {lane.registrationIndex.toLocaleString()}
          </ExplorerSyncLaneInfoRow>
          <ExplorerSyncLaneInfoRow
            label={EXPLORER_LABELS.syncLanesCountsColumn}
          >
            {getExplorerSyncLaneCountLabel({
              errorCount: lane.errorCount,
              requestCount: lane.requestCount,
              runCount: lane.runCount,
            })}
          </ExplorerSyncLaneInfoRow>
          <ExplorerSyncLaneInfoRow
            label={EXPLORER_LABELS.syncLanesProgressColumn}
          >
            <ExplorerSyncLaneProgress lane={lane} />
          </ExplorerSyncLaneInfoRow>
          <ExplorerSyncLaneInfoRow
            label={EXPLORER_LABELS.syncLanesProgressPercentRow}
          >
            {formatSyncLaneProgressPercent(lane)}
          </ExplorerSyncLaneInfoRow>
          {blobStorageKey !== null && params.onOpenBlobDetail ? (
            <ExplorerSyncLaneInfoRow
              label={EXPLORER_LABELS.syncLanesBlobRow}
              title={blobStorageKey}
            >
              <MiniAppButton
                variant="ghost"
                onClick={() => {
                  params.onOpenBlobDetail?.(blobStorageKey);
                }}
              >
                {EXPLORER_LABELS.syncLanesOpenBlobAction}
              </MiniAppButton>
            </ExplorerSyncLaneInfoRow>
          ) : null}
        </tbody>
      </MiniAppKeyValueTable>
    </MiniAppInfoSection>
  );
}

function ExplorerSyncLaneTimingSection(params: { lane: SyncLaneSnapshot }) {
  const { lane } = params;

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.syncLanesTimingHeading}>
      <MiniAppKeyValueTable>
        <tbody>
          <ExplorerSyncLaneInfoRow
            label={EXPLORER_LABELS.syncLanesRequestedRow}
          >
            {formatExplorerSyncLaneBoolean(lane.requested)}
          </ExplorerSyncLaneInfoRow>
          <ExplorerSyncLaneInfoRow label={EXPLORER_LABELS.syncLanesRunningRow}>
            {formatExplorerSyncLaneBoolean(lane.running)}
          </ExplorerSyncLaneInfoRow>
          <ExplorerSyncLaneInfoRow
            label={EXPLORER_LABELS.syncLanesLastActionColumn}
          >
            {getSyncLaneLastActionLabel(lane.lastAction)}
          </ExplorerSyncLaneInfoRow>
          <ExplorerSyncLaneInfoRow
            label={EXPLORER_LABELS.syncLanesLastActionAtRow}
            title={lane.lastActionAt}
          >
            {formatSyncLaneDateTime(lane.lastActionAt)}
          </ExplorerSyncLaneInfoRow>
          <ExplorerSyncLaneInfoRow
            label={EXPLORER_LABELS.syncLanesLastRequestedRow}
            title={lane.lastRequestedAt}
          >
            {formatSyncLaneDateTime(lane.lastRequestedAt)}
          </ExplorerSyncLaneInfoRow>
          <ExplorerSyncLaneInfoRow
            label={EXPLORER_LABELS.syncLanesLastStartedRow}
            title={lane.lastStartedAt}
          >
            {formatSyncLaneDateTime(lane.lastStartedAt)}
          </ExplorerSyncLaneInfoRow>
          <ExplorerSyncLaneInfoRow
            label={EXPLORER_LABELS.syncLanesLastCompletedRow}
            title={lane.lastCompletedAt}
          >
            {formatSyncLaneDateTime(lane.lastCompletedAt)}
          </ExplorerSyncLaneInfoRow>
          <ExplorerSyncLaneInfoRow
            label={EXPLORER_LABELS.syncLanesLastFailedRow}
            title={lane.lastFailedAt}
          >
            {formatSyncLaneDateTime(lane.lastFailedAt)}
          </ExplorerSyncLaneInfoRow>
          <ExplorerSyncLaneInfoRow
            label={EXPLORER_LABELS.syncLanesLastErrorRow}
            title={lane.lastError}
          >
            {lane.lastError ?? EXPLORER_LABELS.syncLanesNoError}
          </ExplorerSyncLaneInfoRow>
        </tbody>
      </MiniAppKeyValueTable>
    </MiniAppInfoSection>
  );
}

function ExplorerSyncLaneProgressSection(params: {
  progress: SyncLaneProgress | null;
}) {
  const { progress } = params;
  if (!progress) {
    return null;
  }

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.syncLanesProgressHeading}>
      <MiniAppKeyValueTable>
        <tbody>
          <ExplorerSyncLaneInfoRow label={EXPLORER_LABELS.syncLanesBytesRow}>
            {formatSyncLaneProgressBytes(progress)}
          </ExplorerSyncLaneInfoRow>
          <ExplorerSyncLaneInfoRow label={EXPLORER_LABELS.syncLanesPartsRow}>
            {formatSyncLaneProgressParts(progress)}
          </ExplorerSyncLaneInfoRow>
        </tbody>
      </MiniAppKeyValueTable>
    </MiniAppInfoSection>
  );
}

function ExplorerSyncLaneCoordinatorSection(params: {
  snapshot: DomainSyncSnapshot;
}) {
  const { snapshot } = params;

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.syncLanesCoordinatorHeading}>
      <MiniAppKeyValueTable>
        <tbody>
          <ExplorerSyncLaneInfoRow
            label={EXPLORER_LABELS.syncLanesPendingWorkRow}
          >
            {formatExplorerSyncLaneBoolean(snapshot.hasPendingWork)}
          </ExplorerSyncLaneInfoRow>
          <ExplorerSyncLaneInfoRow
            label={EXPLORER_LABELS.syncLanesPumpActiveRow}
          >
            {formatExplorerSyncLaneBoolean(snapshot.pumpActive)}
          </ExplorerSyncLaneInfoRow>
          <ExplorerSyncLaneInfoRow
            label={EXPLORER_LABELS.syncLanesSnapshotUpdatedRow}
            title={snapshot.updatedAt}
          >
            {formatSyncLaneDateTime(snapshot.updatedAt)}
          </ExplorerSyncLaneInfoRow>
        </tbody>
      </MiniAppKeyValueTable>
    </MiniAppInfoSection>
  );
}

type SyncLaneDetailTabId = "general" | "timing" | "progress" | "coordinator";

function getSyncLaneDetailTabs(
  lane: SyncLaneSnapshot,
): ReadonlyArray<MiniAppTabDescriptor<SyncLaneDetailTabId>> {
  return [
    { id: "general", label: EXPLORER_LABELS.syncLanesGeneralHeading },
    { id: "timing", label: EXPLORER_LABELS.syncLanesTimingHeading },
    // The upload-progress tab only exists for lanes carrying multipart
    // progress, mirroring the section's former conditional render.
    ...(lane.progress
      ? [
          {
            id: "progress" as const,
            label: EXPLORER_LABELS.syncLanesProgressHeading,
          },
        ]
      : []),
    { id: "coordinator", label: EXPLORER_LABELS.syncLanesCoordinatorHeading },
  ];
}

function ExplorerSyncLaneDetailTabs(params: {
  activeTab: SyncLaneDetailTabId;
  idPrefix: string;
  onSelect: (tab: SyncLaneDetailTabId) => void;
  tabs: ReadonlyArray<MiniAppTabDescriptor<SyncLaneDetailTabId>>;
}) {
  return (
    <MiniAppTabList
      activeTab={params.activeTab}
      idPrefix={params.idPrefix}
      label={EXPLORER_LABELS.syncLanesDetailTabsLabel}
      onSelect={params.onSelect}
      tabs={params.tabs}
    />
  );
}

function ExplorerSyncLaneDetailTabPanel(params: {
  activeTab: SyncLaneDetailTabId;
  idPrefix: string;
  lane: SyncLaneSnapshot;
  onOpenBlobDetail?: ((storageKey: string) => void) | undefined;
  snapshot: DomainSyncSnapshot;
}) {
  const { activeTab, lane, snapshot } = params;

  return (
    <MiniAppTabPanel
      activeTab={activeTab}
      className="explorer-info-tab-panel"
      idPrefix={params.idPrefix}
    >
      {activeTab === "general" ? (
        <ExplorerSyncLaneGeneralSection
          lane={lane}
          onOpenBlobDetail={params.onOpenBlobDetail}
        />
      ) : null}
      {activeTab === "timing" ? (
        <ExplorerSyncLaneTimingSection lane={lane} />
      ) : null}
      {activeTab === "progress" ? (
        <ExplorerSyncLaneProgressSection progress={lane.progress} />
      ) : null}
      {activeTab === "coordinator" ? (
        <ExplorerSyncLaneCoordinatorSection snapshot={snapshot} />
      ) : null}
    </MiniAppTabPanel>
  );
}

export function ExplorerSyncLaneDetail(params: {
  laneKey: string;
  onOpenBlobDetail?: ((storageKey: string) => void) | undefined;
  snapshot: DomainSyncSnapshot;
}) {
  const [activeTab, setActiveTab] = useState<SyncLaneDetailTabId>("general");
  const tabIdPrefix = useId();
  // Reset to the first tab when switching lanes so the detail never opens on a
  // tab the previous lane had but this one lacks (the progress tab).
  useEffect(() => {
    setActiveTab("general");
  }, [params.laneKey]);

  const lane = params.snapshot.lanes.find(
    (candidate) => candidate.key === params.laneKey,
  );

  if (!lane) {
    return (
      <MiniAppStatus>
        {EXPLORER_LABELS.syncLanesLaneNotFound} <code>{params.laneKey}</code>
      </MiniAppStatus>
    );
  }

  const tabs = getSyncLaneDetailTabs(lane);
  // A live snapshot can drop the progress tab out from under an active
  // selection (upload finishes); fall back to the first tab so the panel below
  // never renders empty.
  const resolvedTab = tabs.some((tab) => tab.id === activeTab)
    ? activeTab
    : "general";

  return (
    <div className="explorer-info explorer-sync-lane-detail">
      <ExplorerSyncLaneDetailTabs
        activeTab={resolvedTab}
        idPrefix={tabIdPrefix}
        onSelect={setActiveTab}
        tabs={tabs}
      />
      <ExplorerSyncLaneDetailTabPanel
        activeTab={resolvedTab}
        idPrefix={tabIdPrefix}
        lane={lane}
        onOpenBlobDetail={params.onOpenBlobDetail}
        snapshot={params.snapshot}
      />
    </div>
  );
}
