import type {
  DomainSyncSnapshot,
  SyncLaneSnapshot,
} from "@tearleads/client-sdk";
import { useMemo } from "react";
import {
  MiniAppInfoSection,
  MiniAppStatus,
} from "../../../components/shared/MiniAppLayout";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import { EXPLORER_LABELS } from "../labels";
import {
  ExplorerSyncLaneProgress,
  ExplorerSyncLaneStatusBadge,
} from "./ExplorerSyncLaneShared";
import { summarizeSyncLanes } from "./ExplorerSyncLaneUtils";
import "./ExplorerSyncLanesPanel.css";

const MAX_BLOB_BROWSER_SYNC_LANES = 4;

function isBlobBrowserVisibleSyncLane(lane: SyncLaneSnapshot): boolean {
  return (
    lane.phase === "blob" ||
    lane.status === "error" ||
    lane.status === "queued" ||
    lane.status === "running"
  );
}

function getBlobBrowserSyncLanes(
  snapshot: DomainSyncSnapshot,
): SyncLaneSnapshot[] {
  return snapshot.lanes
    .filter(isBlobBrowserVisibleSyncLane)
    .slice(0, MAX_BLOB_BROWSER_SYNC_LANES);
}

export function BlobBrowserSyncStatus(params: {
  snapshot: DomainSyncSnapshot;
}) {
  const summary = useMemo(
    () => summarizeSyncLanes(params.snapshot),
    [params.snapshot],
  );
  const lanes = useMemo(
    () => getBlobBrowserSyncLanes(params.snapshot),
    [params.snapshot],
  );
  const hiddenLaneCount =
    params.snapshot.lanes.filter(isBlobBrowserVisibleSyncLane).length -
    lanes.length;

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.blobBrowserSyncHeading}>
      <div className="explorer-blob-browser-sync-status">
        <div className="explorer-blob-browser-sync-summary">
          <span>
            {summary.running.toLocaleString()} running,{" "}
            {summary.queued.toLocaleString()} queued,{" "}
            {summary.errors.toLocaleString()} errors
          </span>
          <span title={params.snapshot.updatedAt}>
            {formatMiniAppDateTime(params.snapshot.updatedAt, {
              emptyFallback: "-",
            })}
          </span>
        </div>
        {lanes.length > 0 ? (
          <div className="explorer-blob-browser-sync-lanes">
            {lanes.map((lane) => (
              <div className="explorer-blob-browser-sync-row" key={lane.key}>
                <span className="explorer-blob-browser-sync-name">
                  <span>{lane.label}</span>
                  {lane.lastError ? <code>{lane.lastError}</code> : null}
                </span>
                <ExplorerSyncLaneStatusBadge status={lane.status} />
                <ExplorerSyncLaneProgress lane={lane} />
              </div>
            ))}
            {hiddenLaneCount > 0 ? (
              <MiniAppStatus as="span">
                {hiddenLaneCount.toLocaleString()} more
              </MiniAppStatus>
            ) : null}
          </div>
        ) : (
          <MiniAppStatus as="span">
            {EXPLORER_LABELS.blobBrowserSyncIdle}
          </MiniAppStatus>
        )}
      </div>
    </MiniAppInfoSection>
  );
}
