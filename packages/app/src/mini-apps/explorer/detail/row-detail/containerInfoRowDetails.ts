import type { ContainerInfo } from "@tearleads/client-sdk";
import {
  EXPLORER_LABELS,
  getExplorerContainerInfoGrantSummaryLabel,
  getExplorerContainerInfoRecipientSummaryLabel,
} from "../../labels";
import {
  type ExplorerInfoRowDetail,
  formatExplorerInfoRowDetailTime,
} from "./ExplorerInfoRowDetail";

type ContainerRemoteInfo = NonNullable<ContainerInfo["remoteInfo"]>;
export type SecurityPathEntry = NonNullable<
  ContainerRemoteInfo["security"]
>["path"][number];
export type SyncCursor = ContainerRemoteInfo["syncCursors"][number];

export function getSecurityPathKey(entry: SecurityPathEntry): string {
  return `${entry.containerId}:${entry.manifestHash}`;
}

export function getSecurityPathRecipientSummary(
  entry: SecurityPathEntry,
): string {
  return getExplorerContainerInfoRecipientSummaryLabel({
    recipientTargetCount: entry.recipientTargetCount,
    wrapCount: entry.wrapCount,
  });
}

export function getSecurityPathGrantSummary(entry: SecurityPathEntry): string {
  return getExplorerContainerInfoGrantSummaryLabel({
    directGrantCount: entry.directGrantCount,
    referencedPrincipalCount: entry.referencedPrincipalCount,
  });
}

export function getSecurityPathDetail(
  entry: SecurityPathEntry,
  containerName: string,
): ExplorerInfoRowDetail {
  return {
    fields: [
      {
        id: "container",
        label: EXPLORER_LABELS.infoRowDetailContainerRow,
        value: containerName,
      },
      {
        copyable: true,
        id: "containerId",
        label: EXPLORER_LABELS.infoRowDetailContainerIdRow,
        value: entry.containerId,
      },
      {
        copyable: true,
        id: "manifestHash",
        label: EXPLORER_LABELS.infoRowDetailManifestHashRow,
        value: entry.manifestHash,
      },
      {
        copyable: true,
        id: "eventHash",
        label: EXPLORER_LABELS.infoRowDetailEventHashRow,
        value: entry.eventHash,
      },
      {
        id: "keyEpoch",
        label: EXPLORER_LABELS.containerInfoSecurityKeyEpochRow,
        value: String(entry.containerKeyEpoch),
      },
      {
        copyable: true,
        id: "keyEpochId",
        label: EXPLORER_LABELS.infoRowDetailKeyEpochIdRow,
        value: entry.containerKeyEpochId,
      },
      {
        id: "recipients",
        label: EXPLORER_LABELS.containerInfoRecipientsColumn,
        value: getSecurityPathRecipientSummary(entry),
      },
      {
        id: "grants",
        label: EXPLORER_LABELS.infoRowDetailGrantsRow,
        value: getSecurityPathGrantSummary(entry),
      },
    ],
    title: EXPLORER_LABELS.infoRowDetailPathEntryTitle,
  };
}

export function getSyncCursorKey(cursor: SyncCursor): string {
  return `${cursor.laneKind}:${cursor.laneId}`;
}

/** The lane as its row spells it: kind, then id. */
export function getSyncCursorLaneId(cursor: SyncCursor): string {
  return `${cursor.laneKind}/${cursor.laneId}`;
}

export function getSyncCursorDetail(cursor: SyncCursor): ExplorerInfoRowDetail {
  return {
    fields: [
      {
        id: "lane",
        label: EXPLORER_LABELS.containerInfoLaneColumn,
        value: cursor.label,
      },
      {
        copyable: true,
        id: "laneId",
        label: EXPLORER_LABELS.infoRowDetailLaneIdRow,
        value: getSyncCursorLaneId(cursor),
      },
      {
        id: "cursor",
        label: EXPLORER_LABELS.containerInfoCursorColumn,
        value:
          formatExplorerInfoRowDetailTime(cursor.watermarkUpdatedAt) ??
          EXPLORER_LABELS.containerInfoNoLocalCursor,
      },
      {
        copyable: true,
        id: "watermarkId",
        label: EXPLORER_LABELS.infoRowDetailWatermarkIdRow,
        value: cursor.watermarkId,
      },
      {
        id: "saved",
        label: EXPLORER_LABELS.containerInfoSavedColumn,
        value: formatExplorerInfoRowDetailTime(cursor.savedAt),
      },
    ],
    title: EXPLORER_LABELS.infoRowDetailSyncCursorTitle,
  };
}
