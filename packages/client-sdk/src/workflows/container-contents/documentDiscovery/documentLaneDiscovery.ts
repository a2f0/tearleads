import { ContainerSyncWatermarkRepository } from "../../../data/persistence/container-contents/containerSyncWatermarkPersistence";
import { DocumentDiscoveryEvidenceRepository } from "../../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";

/**
 * Whether a known container's document lane still owes a listing.
 *
 * | durable evidence                                   | state   |
 * | -------------------------------------------------- | ------- |
 * | no settled lane row (never listed, or cut short)   | owed    |
 * | staged candidates in `pending_document_discoveries` | owed    |
 * | settled lane row and no staged candidate           | settled |
 *
 * Only an applied listing that leaves no candidate pending settles a lane
 * (`recordContainerDocumentListing` sets the lane row's `checked_at`). An
 * access-level change or a remote reset deletes the row, and staging
 * candidates owes the lane again until they are acknowledged. Discovery spans
 * network round trips, so a reload can land anywhere inside it; this durable
 * state is what lets the next start resume the lane rather than wait for a
 * hint that never comes.
 */
export type DocumentLaneDiscoveryState =
  | { readonly status: "settled" }
  | {
      readonly status: "owed";
      readonly reason: "pending-candidates" | "unsettled";
    };

export function documentLaneDiscoveryState(input: {
  readonly pendingCandidates: boolean;
  readonly settled: boolean;
}): DocumentLaneDiscoveryState {
  if (input.pendingCandidates) {
    return { reason: "pending-candidates", status: "owed" };
  }
  return input.settled
    ? { status: "settled" }
    : { reason: "unsettled", status: "owed" };
}

/** The given containers whose document lane still owes a listing, in order. */
export async function listOwedDocumentLaneContainerIds(
  execSql: ExecSql,
  containerIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<string>> {
  if (containerIds.length === 0) {
    return [];
  }
  const [settled, pending] = await Promise.all([
    new ContainerSyncWatermarkRepository(
      execSql,
    ).listSettledContainerDocumentLaneIds(),
    new DocumentDiscoveryEvidenceRepository(execSql).listPendingContainerIds(),
  ]);
  return containerIds.filter(
    (containerId) =>
      documentLaneDiscoveryState({
        pendingCandidates: pending.has(containerId),
        settled: settled.has(containerId),
      }).status === "owed",
  );
}
