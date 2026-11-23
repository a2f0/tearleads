import type {
  PendingWriteQueueItem,
  SyncLaneSnapshot,
  SyncLaneStatus,
} from "@tearleads/client-sdk";
import type { ExplorerUploadItem } from "../../../../stores/explorer/explorerUploadItemMachine";
import { EXPLORER_LABELS } from "../../labels";
import {
  getStatusLabel,
  getWriteQueueItemError,
  getWriteQueueItemKey,
} from "../sync/writeQueueItems";
import {
  type ExplorerTransferProgress,
  getExplorerTransferStatusPercent,
} from "./ExplorerTransferCells";
import {
  type ExplorerUploadDerivedStatus,
  getExplorerUploadTransfer,
  indexUploadLanes,
} from "./uploadTransfer";

/** A file uploaded this session, with the status its upload derives to. */
export interface OutgoingUpload {
  readonly item: ExplorerUploadItem;
  readonly status: ExplorerUploadDerivedStatus;
}

/**
 * One row of the Outgoing table. A file uploaded this session appears once:
 * joined to its document's write-queue entry while that entry exists, and on
 * its own before and after. `key` stays the file's across that change, so its
 * row keeps its identity as it moves.
 */
export type OutgoingRow =
  /**
   * A file with nothing in the write queue: not imported yet, finished, or
   * imported but not (or no longer) listed by the queue's latest read.
   */
  | {
      readonly kind: "file";
      readonly key: string;
      readonly transfer: ExplorerTransferProgress;
      readonly upload: OutgoingUpload;
    }
  /** A file whose document still has queued writes. */
  | {
      readonly kind: "file-write";
      readonly key: string;
      readonly transfer: ExplorerTransferProgress;
      readonly upload: OutgoingUpload;
      readonly write: PendingWriteQueueItem;
    }
  /**
   * Queued writes that are no file uploaded this session: edits, moves, folder
   * metadata, revalidation, or a file uploaded before this session.
   */
  | {
      readonly kind: "write";
      readonly key: string;
      readonly transfer: ExplorerTransferProgress;
      readonly write: PendingWriteQueueItem;
    };

export interface OutgoingRowsInput {
  billingBlockedOrganizationId: string | null;
  lanes: ReadonlyArray<SyncLaneSnapshot>;
  /** The session's uploads, oldest first, as their history keeps them. */
  uploads: ReadonlyArray<ExplorerUploadItem>;
  /** The write queue in its own order: oldest write first. */
  writes: ReadonlyArray<PendingWriteQueueItem>;
}

export function isBillingBlockedWrite(
  write: PendingWriteQueueItem,
  billingBlockedOrganizationId: string | null,
): boolean {
  return (
    write.organizationId !== null &&
    write.organizationId === billingBlockedOrganizationId
  );
}

/** How a queued entry reads when no upload of this session explains it. */
export function getWriteTransfer(
  write: PendingWriteQueueItem,
  billingBlocked: boolean,
): ExplorerTransferProgress {
  const status: SyncLaneStatus = write.status === "error" ? "error" : "queued";
  return {
    detail:
      billingBlocked && write.status === "pending"
        ? EXPLORER_LABELS.writeQueueBillingPaused
        : getWriteQueueItemError(write),
    label: getStatusLabel(write.status),
    percent: getExplorerTransferStatusPercent(status),
    status,
  };
}

// While its file is still on its way, a joined row reads as the upload: its
// lane status and transferred bytes. A queue error or a billing pause says
// more about why it is stuck, and once the upload settled (or failed after its
// document was stored) what remains queued is the document's own writes.
function getFileWriteTransfer(
  upload: ExplorerUploadItem,
  uploadTransfer: ExplorerTransferProgress,
  write: PendingWriteQueueItem,
  billingBlocked: boolean,
): ExplorerTransferProgress {
  const writeExplains =
    write.status === "error" || (billingBlocked && write.status === "pending");
  return upload.status === "imported" && !writeExplains
    ? uploadTransfer
    : getWriteTransfer(write, billingBlocked);
}

/** Where a file without queued writes sits among the rows. */
type FileBand = "upcoming" | "unlisted" | "finished";

function getFileBand(status: ExplorerUploadItem["status"]): FileBand {
  switch (status) {
    case "queued":
    case "importing":
      return "upcoming";
    case "imported":
      return "unlisted";
    case "uploaded":
    case "removed":
    case "failed":
    case "cancelled":
      return "finished";
  }
}

// Only a recognized document can be a file this session uploaded; an entry
// with a namespace is an unrecognized document kind.
function isUploadableDocument(write: PendingWriteQueueItem): boolean {
  return write.objectKind === "document" && write.namespace === null;
}

/**
 * The Outgoing table's rows, top to bottom: files not imported yet, in the
 * order they import; the write queue in its own order, each uploaded file
 * joined to its document's entry; imported files the queue does not list, in
 * upload order; then finished files, newest first.
 */
export function deriveOutgoingRows(
  input: OutgoingRowsInput,
): ReadonlyArray<OutgoingRow> {
  const lanes = indexUploadLanes(input.lanes);
  const uploadsByLocalId = new Map<string, ExplorerUploadItem>();
  for (const item of input.uploads) {
    if (item.localId !== null && !uploadsByLocalId.has(item.localId)) {
      uploadsByLocalId.set(item.localId, item);
    }
  }
  const joinedUploadIds = new Set<string>();

  const queueRows = input.writes.map((write): OutgoingRow => {
    const billingBlocked = isBillingBlockedWrite(
      write,
      input.billingBlockedOrganizationId,
    );
    const partner = isUploadableDocument(write)
      ? uploadsByLocalId.get(write.localId)
      : undefined;
    if (partner === undefined || joinedUploadIds.has(partner.id)) {
      return {
        key: `write:${getWriteQueueItemKey(write)}`,
        kind: "write",
        transfer: getWriteTransfer(write, billingBlocked),
        write,
      };
    }
    joinedUploadIds.add(partner.id);
    const { status, transfer } = getExplorerUploadTransfer(partner, lanes);
    return {
      key: `upload:${partner.id}`,
      kind: "file-write",
      transfer: getFileWriteTransfer(partner, transfer, write, billingBlocked),
      upload: { item: partner, status },
      write,
    };
  });

  const bands: Record<FileBand, OutgoingRow[]> = {
    finished: [],
    unlisted: [],
    upcoming: [],
  };
  for (const item of input.uploads) {
    if (joinedUploadIds.has(item.id)) continue;
    const { status, transfer } = getExplorerUploadTransfer(item, lanes);
    bands[getFileBand(item.status)].push({
      key: `upload:${item.id}`,
      kind: "file",
      transfer,
      upload: { item, status },
    });
  }

  return [
    ...bands.upcoming,
    ...queueRows,
    ...bands.unlisted,
    ...bands.finished.reverse(),
  ];
}
