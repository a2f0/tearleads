import type {
  DocumentSummary,
  DomainSyncSnapshot,
  SyncLaneSnapshot,
} from "@tearleads/client-sdk";
import { type ReactNode, useEffect, useId, useState } from "react";
import {
  MiniAppButton,
  MiniAppInfoSection,
  MiniAppStatus,
  type MiniAppTabDescriptor,
  MiniAppTabList,
  MiniAppTabPanel,
} from "../../../../components/mini-app/MiniAppLayout";
import {
  MiniAppKeyValueList,
  MiniAppKeyValueRow,
  MiniAppTableActionButton,
} from "../../../../components/mini-app/MiniAppTable";
import { formatByteLength } from "../../../../utils/formatByteLength";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";
import { EXPLORER_LABELS, getExplorerSyncLaneCountLabel } from "../../labels";
import { useExplorerDocumentSummary } from "../document/useExplorerDocumentSummary";
import {
  ExplorerSyncLaneProgress,
  ExplorerSyncLaneStatusBadge,
} from "./ExplorerSyncLaneShared";
import {
  formatExplorerSyncLaneBoolean,
  formatSyncLaneRunDuration,
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

/** How a document lane's detail reaches the document being synced. */
export interface ExplorerSyncLaneDocumentLinks {
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  openDocumentInfo: (localId: string, containerId: string) => void;
}

/** Where a lane's Label and Key lead: the thing the lane syncs. */
interface SyncLaneSubjectLink {
  label: string;
  onOpen: () => void;
}

const DOCUMENT_LANE_KEY_PREFIX = "documents:";

function SyncLaneSubjectValue(params: {
  children: ReactNode;
  link: SyncLaneSubjectLink | null;
  name: string;
}) {
  return params.link ? (
    <MiniAppTableActionButton
      aria-label={`${params.link.label}: ${params.name}`}
      onClick={params.link.onOpen}
    >
      {params.children}
    </MiniAppTableActionButton>
  ) : (
    params.children
  );
}

function ExplorerSyncLaneGeneralSection(params: {
  lane: SyncLaneSnapshot;
  onOpenBlobDetail?: ((storageKey: string) => void) | undefined;
  subject: SyncLaneSubjectLink | null;
}) {
  const { lane, subject } = params;
  const blobStorageKey = lane.blobStorageKey;

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.syncLanesGeneralHeading}>
      <MiniAppKeyValueList>
        <MiniAppKeyValueRow
          label={EXPLORER_LABELS.syncLanesLabelRow}
          title={lane.label}
        >
          <SyncLaneSubjectValue link={subject} name={lane.label}>
            {lane.label}
          </SyncLaneSubjectValue>
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow
          label={EXPLORER_LABELS.syncLanesKeyRow}
          title={lane.key}
        >
          <SyncLaneSubjectValue link={subject} name={lane.key}>
            <code>{lane.key}</code>
          </SyncLaneSubjectValue>
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow label={EXPLORER_LABELS.syncLanesPhaseColumn}>
          {getSyncLanePhaseLabel(lane.phase)}
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow label={EXPLORER_LABELS.syncLanesStatusColumn}>
          <ExplorerSyncLaneStatusBadge status={lane.status} />
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow label={EXPLORER_LABELS.syncLanesRegistrationRow}>
          {lane.registrationIndex.toLocaleString()}
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow label={EXPLORER_LABELS.syncLanesCountsColumn}>
          {getExplorerSyncLaneCountLabel({
            errorCount: lane.errorCount,
            requestCount: lane.requestCount,
            runCount: lane.runCount,
          })}
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow label={EXPLORER_LABELS.syncLanesProgressColumn}>
          <ExplorerSyncLaneProgress lane={lane} />
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow label={EXPLORER_LABELS.syncLanesProgressPercentRow}>
          {formatSyncLaneProgressPercent(lane)}
        </MiniAppKeyValueRow>
        {blobStorageKey !== null && params.onOpenBlobDetail ? (
          <MiniAppKeyValueRow
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
          </MiniAppKeyValueRow>
        ) : null}
      </MiniAppKeyValueList>
    </MiniAppInfoSection>
  );
}

// A document lane links to its document's info once the summary says where
// the document is shown; an orphaned or unhydrated one stays plain text.
function ExplorerSyncLaneDocumentGeneral(params: {
  documentLinks: ExplorerSyncLaneDocumentLinks;
  lane: SyncLaneSnapshot;
  localId: string;
  onOpenBlobDetail?: ((storageKey: string) => void) | undefined;
}) {
  const { documentLinks, localId } = params;
  const { documentSummary } = useExplorerDocumentSummary({
    fallbackDocumentSummary: null,
    loadDocumentSummary: documentLinks.loadDocumentSummary,
    localId,
  });
  const containerId = documentSummary?.containerId ?? null;
  return (
    <ExplorerSyncLaneGeneralSection
      lane={params.lane}
      onOpenBlobDetail={params.onOpenBlobDetail}
      subject={
        containerId === null
          ? null
          : {
              label: EXPLORER_LABELS.syncLanesOpenDocumentAction,
              onOpen: () =>
                documentLinks.openDocumentInfo(localId, containerId),
            }
      }
    />
  );
}

function ExplorerSyncLaneGeneral(params: {
  documentLinks?: ExplorerSyncLaneDocumentLinks | undefined;
  lane: SyncLaneSnapshot;
  onOpenBlobDetail?: ((storageKey: string) => void) | undefined;
}) {
  const { documentLinks, lane, onOpenBlobDetail } = params;
  if (documentLinks && lane.key.startsWith(DOCUMENT_LANE_KEY_PREFIX)) {
    return (
      <ExplorerSyncLaneDocumentGeneral
        documentLinks={documentLinks}
        // Remount per document so its summary load starts fresh.
        key={lane.key}
        lane={lane}
        localId={lane.key.slice(DOCUMENT_LANE_KEY_PREFIX.length)}
        onOpenBlobDetail={onOpenBlobDetail}
      />
    );
  }
  const { blobStorageKey } = lane;
  return (
    <ExplorerSyncLaneGeneralSection
      lane={lane}
      onOpenBlobDetail={onOpenBlobDetail}
      subject={
        blobStorageKey !== null && onOpenBlobDetail
          ? {
              label: EXPLORER_LABELS.syncLanesOpenBlobAction,
              onOpen: () => onOpenBlobDetail(blobStorageKey),
            }
          : null
      }
    />
  );
}

function ExplorerSyncLaneTimingSection(params: { lane: SyncLaneSnapshot }) {
  const { lane } = params;

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.syncLanesTimingHeading}>
      <MiniAppKeyValueList>
        <MiniAppKeyValueRow label={EXPLORER_LABELS.syncLanesRequestedRow}>
          {formatExplorerSyncLaneBoolean(lane.requested)}
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow label={EXPLORER_LABELS.syncLanesRunningRow}>
          {formatExplorerSyncLaneBoolean(lane.running)}
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow label={EXPLORER_LABELS.syncLanesLastActionColumn}>
          {getSyncLaneLastActionLabel(lane.lastAction)}
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow
          label={EXPLORER_LABELS.syncLanesLastActionAtRow}
          title={lane.lastActionAt}
        >
          {formatSyncLaneDateTime(lane.lastActionAt)}
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow
          label={EXPLORER_LABELS.syncLanesLastRequestedRow}
          title={lane.lastRequestedAt}
        >
          {formatSyncLaneDateTime(lane.lastRequestedAt)}
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow
          label={EXPLORER_LABELS.syncLanesLastStartedRow}
          title={lane.lastStartedAt}
        >
          {formatSyncLaneDateTime(lane.lastStartedAt)}
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow
          label={EXPLORER_LABELS.syncLanesLastCompletedRow}
          title={lane.lastCompletedAt}
        >
          {formatSyncLaneDateTime(lane.lastCompletedAt)}
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow
          label={EXPLORER_LABELS.syncLanesLastFailedRow}
          title={lane.lastFailedAt}
        >
          {formatSyncLaneDateTime(lane.lastFailedAt)}
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow label={EXPLORER_LABELS.syncLanesLastRunDurationRow}>
          {formatSyncLaneRunDuration(lane, (durations) => durations.lastMs)}
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow
          label={EXPLORER_LABELS.syncLanesAverageRunDurationRow}
        >
          {formatSyncLaneRunDuration(
            lane,
            (durations) => durations.totalMs / durations.count,
          )}
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow label={EXPLORER_LABELS.syncLanesMaxRunDurationRow}>
          {formatSyncLaneRunDuration(lane, (durations) => durations.maxMs)}
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow
          label={EXPLORER_LABELS.syncLanesLastErrorRow}
          title={lane.lastError}
        >
          {lane.lastError ?? EXPLORER_LABELS.syncLanesNoError}
        </MiniAppKeyValueRow>
      </MiniAppKeyValueList>
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
      <MiniAppKeyValueList>
        <MiniAppKeyValueRow label={EXPLORER_LABELS.syncLanesBytesRow}>
          {formatSyncLaneProgressBytes(progress)}
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow label={EXPLORER_LABELS.syncLanesPartsRow}>
          {formatSyncLaneProgressParts(progress)}
        </MiniAppKeyValueRow>
      </MiniAppKeyValueList>
    </MiniAppInfoSection>
  );
}

function ExplorerSyncLaneCoordinatorSection(params: {
  snapshot: DomainSyncSnapshot;
}) {
  const { snapshot } = params;

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.syncLanesCoordinatorHeading}>
      <MiniAppKeyValueList>
        <MiniAppKeyValueRow label={EXPLORER_LABELS.syncLanesPendingWorkRow}>
          {formatExplorerSyncLaneBoolean(snapshot.hasPendingWork)}
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow label={EXPLORER_LABELS.syncLanesPumpActiveRow}>
          {formatExplorerSyncLaneBoolean(snapshot.pumpActive)}
        </MiniAppKeyValueRow>
        <MiniAppKeyValueRow
          label={EXPLORER_LABELS.syncLanesSnapshotUpdatedRow}
          title={snapshot.updatedAt}
        >
          {formatSyncLaneDateTime(snapshot.updatedAt)}
        </MiniAppKeyValueRow>
      </MiniAppKeyValueList>
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
  documentLinks?: ExplorerSyncLaneDocumentLinks | undefined;
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
        <ExplorerSyncLaneGeneral
          documentLinks={params.documentLinks}
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
  documentLinks?: ExplorerSyncLaneDocumentLinks | undefined;
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
        documentLinks={params.documentLinks}
        idPrefix={tabIdPrefix}
        lane={lane}
        onOpenBlobDetail={params.onOpenBlobDetail}
        snapshot={params.snapshot}
      />
    </div>
  );
}
