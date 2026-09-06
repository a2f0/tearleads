import type { SyncWatermark } from "@tearleads/validators/response";
import { compareSyncTimestamps } from "./syncTimestamp";

export interface ContainerDocumentRow {
  createdAt: Date;
  documentId: string;
  manifestHash: string;
  manifestEpoch: number;
  updatedAt: string;
}

export interface ContainerDocumentTombstoneRow {
  documentId: string;
  updatedAt: string;
}

/** Select before expanding linked-container authorization and principal paths. */
export function selectContainerDocumentPage(input: {
  readonly documentRows: readonly ContainerDocumentRow[];
  readonly tombstoneRows: readonly ContainerDocumentTombstoneRow[];
  readonly limit: number;
  readonly watermark: SyncWatermark | null;
}) {
  const candidates = [
    ...input.documentRows.map((row) => ({ kind: "document" as const, row })),
    ...input.tombstoneRows.map((row) => ({ kind: "tombstone" as const, row })),
  ].sort((left, right) => {
    const timeOrder = compareSyncTimestamps(
      left.row.updatedAt,
      right.row.updatedAt,
    );
    return timeOrder || left.row.documentId.localeCompare(right.row.documentId);
  });
  const selected = candidates.slice(0, input.limit);
  const last = selected.at(-1)?.row;
  return {
    documentRows: selected.flatMap((candidate) =>
      candidate.kind === "document" ? [candidate.row] : [],
    ),
    tombstoneRows: selected.flatMap((candidate) =>
      candidate.kind === "tombstone" ? [candidate.row] : [],
    ),
    hasMore: candidates.length > selected.length,
    nextWatermark: last
      ? { id: last.documentId, updatedAt: last.updatedAt }
      : input.watermark,
  };
}
