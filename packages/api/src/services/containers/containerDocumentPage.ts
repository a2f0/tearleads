import type { SyncWatermark } from "@tearleads/validators/response";
import { compareDiscoveryOrder, discoveryWatermark } from "./syncPaging";

export interface ContainerDocumentRow {
  createdAt: Date;
  discoveryOrder: bigint;
  documentId: string;
  manifestHash: string;
  manifestEpoch: number;
  updatedAt: string;
}

export interface ContainerDocumentTombstoneRow {
  discoveryOrder: bigint;
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
    return compareDiscoveryOrder(
      { discoveryOrder: left.row.discoveryOrder, id: left.row.documentId },
      { discoveryOrder: right.row.discoveryOrder, id: right.row.documentId },
    );
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
      ? discoveryWatermark(last.discoveryOrder, last.documentId, last.updatedAt)
      : input.watermark,
  };
}
