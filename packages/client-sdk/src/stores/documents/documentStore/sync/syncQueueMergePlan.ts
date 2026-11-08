import {
  decodeVersionVector,
  mergeVersionVectors,
  minimumVersionVectors,
} from "@tearleads/loro";
import { MAX_DOCUMENT_SYNC_REQUEST_BYTES } from "@tearleads/validators/util";
import type { QueuedPendingUpdateRecord } from "../../../../workflows/documents";
import { provenOrdinaryUpdateBytes } from "../history/ordinaryUpdateProof";
import type { DocumentState } from "../state";

/**
 * Largest merged `updateData` (base64 characters, as the outgoing batch
 * counts them). Half a request leaves room for a baseline and other rows, so
 * a merged update is always sendable.
 */
export const QUEUED_UPDATE_MERGE_MAX_DATA_CHARACTERS = Math.floor(
  MAX_DOCUMENT_SYNC_REQUEST_BYTES / 2,
);

/** Most queued rows folded into merged updates in one sync pass. */
export const QUEUED_UPDATE_MERGE_MAX_ROWS_PER_PASS = 256;

export interface QueuedUpdateMergeLimits {
  readonly maxDataCharacters: number;
  readonly maxRows: number;
}

export const DEFAULT_QUEUED_UPDATE_MERGE_LIMITS: QueuedUpdateMergeLimits = {
  maxDataCharacters: QUEUED_UPDATE_MERGE_MAX_DATA_CHARACTERS,
  maxRows: QUEUED_UPDATE_MERGE_MAX_ROWS_PER_PASS,
};

/** Consecutive queued rows to replace with one update covering their union. */
export interface QueuedUpdateMergeGroup {
  /** In queue order; the first member's row keeps the queue position. */
  readonly members: readonly QueuedPendingUpdateRecord[];
  readonly partialStartVersionVector: string;
  readonly partialEndVersionVector: string;
  /** The members' largest rekey count, so the rekey budget is kept. */
  readonly rekeyCount: number;
}

type PeerRanges = Map<string, { end: number; start: number }>;

interface MergeRun {
  dataCharacters: number;
  members: QueuedPendingUpdateRecord[];
  peers: PeerRanges;
}

/** Per-peer `[start, end)` ranges a row declares, skipping empty peers. */
function rowPeerRanges(row: QueuedPendingUpdateRecord): PeerRanges {
  const start = decodeVersionVector(row.partialStartVersionVector);
  const ranges: PeerRanges = new Map();
  for (const [peer, end] of decodeVersionVector(
    row.partialEndVersionVector,
  ).toJSON()) {
    const peerStart = start.get(peer) ?? 0;
    if (end > peerStart) ranges.set(peer, { end, start: peerStart });
  }
  return ranges;
}

function isMergeableRow(
  row: QueuedPendingUpdateRecord,
  doc: DocumentState,
  limits: QueuedUpdateMergeLimits,
): boolean {
  return (
    row.origin === "local" &&
    row.sourceVersionVector == null &&
    row.updateData.length <= limits.maxDataCharacters &&
    provenOrdinaryUpdateBytes(doc, row) !== null
  );
}

/** Each shared peer's ranges touch or overlap, so the union has no gap. */
function rangesConnect(run: PeerRanges, row: PeerRanges): boolean {
  for (const [peer, range] of row) {
    const current = run.get(peer);
    if (current && (range.start > current.end || range.end < current.start)) {
      return false;
    }
  }
  return true;
}

function canExtendRun(
  run: MergeRun,
  row: QueuedPendingUpdateRecord,
  ranges: PeerRanges,
  input: { limits: QueuedUpdateMergeLimits; remainingRows: number },
): boolean {
  return (
    run.members.length < input.remainingRows &&
    run.dataCharacters + row.updateData.length <=
      input.limits.maxDataCharacters &&
    rangesConnect(run.peers, ranges)
  );
}

function extendRun(
  run: MergeRun,
  row: QueuedPendingUpdateRecord,
  ranges: PeerRanges,
): void {
  run.members.push(row);
  run.dataCharacters += row.updateData.length;
  for (const [peer, range] of ranges) {
    const current = run.peers.get(peer);
    run.peers.set(
      peer,
      current
        ? {
            end: Math.max(current.end, range.end),
            start: Math.min(current.start, range.start),
          }
        : range,
    );
  }
}

function toMergeGroup(run: MergeRun): QueuedUpdateMergeGroup {
  return {
    members: run.members,
    partialStartVersionVector: minimumVersionVectors(
      run.members.map((member) => member.partialStartVersionVector),
    ),
    partialEndVersionVector: mergeVersionVectors(
      run.members.map((member) => member.partialEndVersionVector),
    ),
    rekeyCount: Math.max(
      ...run.members.map((member) => member.rekeyCount ?? 0),
    ),
  };
}

/**
 * Plan which queued rows to merge. Rows are taken in queue order and grouped
 * into maximal runs of consecutive mergeable rows: ordinary local rows (not
 * outbox, not a rotation checkpoint) within the size cap that the live
 * document proves. A run is cut at any other row, where a shared peer's
 * ranges would leave a gap (overlaps are fine), or where the summed data or
 * the per-pass row budget would be exceeded. Only runs of two or more rows
 * become groups.
 */
export function planQueuedUpdateMerge(input: {
  readonly doc: DocumentState;
  readonly limits?: QueuedUpdateMergeLimits | undefined;
  readonly rows: readonly QueuedPendingUpdateRecord[];
}): QueuedUpdateMergeGroup[] {
  const limits = input.limits ?? DEFAULT_QUEUED_UPDATE_MERGE_LIMITS;
  const groups: QueuedUpdateMergeGroup[] = [];
  let remainingRows = limits.maxRows;
  let run: MergeRun | null = null;
  const closeRun = () => {
    if (run && run.members.length >= 2) {
      groups.push(toMergeGroup(run));
      remainingRows -= run.members.length;
    }
    run = null;
  };
  for (const row of input.rows) {
    if (remainingRows < 2) break;
    if (!isMergeableRow(row, input.doc, limits)) {
      closeRun();
      continue;
    }
    const ranges = rowPeerRanges(row);
    if (run && !canExtendRun(run, row, ranges, { limits, remainingRows })) {
      closeRun();
    }
    run ??= { dataCharacters: 0, members: [], peers: new Map() };
    extendRun(run, row, ranges);
  }
  closeRun();
  return groups;
}
