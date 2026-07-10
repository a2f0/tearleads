import type {
  DomainSyncSnapshot,
  SyncLaneSnapshot,
} from "@tearleads/client-sdk";
import type { ReactNode } from "react";
import {
  MiniAppInfoSection,
  MiniAppStatus,
} from "../../../../components/shared/MiniAppLayout";
import { MiniAppInfoTable } from "../../../../components/shared/MiniAppTable";
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

function ExplorerSyncLaneGeneralSection(params: { lane: SyncLaneSnapshot }) {
  const { lane } = params;

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.syncLanesGeneralHeading}>
      <MiniAppInfoTable>
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
        </tbody>
      </MiniAppInfoTable>
    </MiniAppInfoSection>
  );
}

function ExplorerSyncLaneTimingSection(params: { lane: SyncLaneSnapshot }) {
  const { lane } = params;

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.syncLanesTimingHeading}>
      <MiniAppInfoTable>
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
      </MiniAppInfoTable>
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
      <MiniAppInfoTable>
        <tbody>
          <ExplorerSyncLaneInfoRow label={EXPLORER_LABELS.syncLanesBytesRow}>
            {formatSyncLaneProgressBytes(progress)}
          </ExplorerSyncLaneInfoRow>
          <ExplorerSyncLaneInfoRow label={EXPLORER_LABELS.syncLanesPartsRow}>
            {formatSyncLaneProgressParts(progress)}
          </ExplorerSyncLaneInfoRow>
        </tbody>
      </MiniAppInfoTable>
    </MiniAppInfoSection>
  );
}

function ExplorerSyncLaneCoordinatorSection(params: {
  snapshot: DomainSyncSnapshot;
}) {
  const { snapshot } = params;

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.syncLanesCoordinatorHeading}>
      <MiniAppInfoTable>
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
      </MiniAppInfoTable>
    </MiniAppInfoSection>
  );
}

export function ExplorerSyncLaneDetail(params: {
  laneKey: string;
  snapshot: DomainSyncSnapshot;
}) {
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

  return (
    <div className="explorer-sync-lane-detail-grid">
      <ExplorerSyncLaneGeneralSection lane={lane} />
      <ExplorerSyncLaneTimingSection lane={lane} />
      <ExplorerSyncLaneProgressSection progress={lane.progress} />
      <ExplorerSyncLaneCoordinatorSection snapshot={params.snapshot} />
    </div>
  );
}
