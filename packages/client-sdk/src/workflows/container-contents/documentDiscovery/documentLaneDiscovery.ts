import { ContainerSyncWatermarkRepository } from "../../../data/persistence/container-contents/containerSyncWatermarkPersistence";
import {
  type DocumentLaneRevalidation,
  DocumentLaneRevalidationRepository,
} from "../../../data/persistence/container-contents/documentLaneRevalidations";
import { DocumentDiscoveryEvidenceRepository } from "../../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";

/**
 * Whether a known container's document lane still owes a listing.
 *
 * | durable evidence                                     | state   |
 * | ---------------------------------------------------- | ------- |
 * | no settled lane row (never listed, or cut short)     | owed    |
 * | staged candidates in `pending_document_discoveries`  | owed    |
 * | a request in `document_lane_revalidations`           | owed    |
 * | settled lane row, no staged candidate and no request | settled |
 *
 * Only an applied listing that leaves no candidate pending settles a lane
 * (`recordContainerDocumentListing` sets the lane row's `checked_at`). An
 * access-level change or a remote reset deletes the row, and staging
 * candidates owes the lane again until they are acknowledged. A tree listing
 * that is served the container's row requests a listing, because every
 * server write that changes what the lane returns republishes that row; the
 * listing that read the request before it began settles it. Discovery spans
 * network round trips, so a reload can land anywhere inside it; this durable
 * state is what lets the next start resume the lane rather than wait for a
 * hint that never comes, and what lets a catch-up list the lanes that moved
 * instead of every lane.
 */
export type DocumentLaneDiscoveryState =
  | { readonly status: "settled" }
  | {
      readonly status: "owed";
      readonly reason: "pending-candidates" | "requested" | "unsettled";
    };

export function documentLaneDiscoveryState(input: {
  readonly pendingCandidates: boolean;
  readonly requested: boolean;
  readonly settled: boolean;
}): DocumentLaneDiscoveryState {
  if (input.pendingCandidates) {
    return { reason: "pending-candidates", status: "owed" };
  }
  if (!input.settled) return { reason: "unsettled", status: "owed" };
  return input.requested
    ? { reason: "requested", status: "owed" }
    : { status: "settled" };
}

/** The given containers whose document lane still owes a listing, in order. */
export async function listOwedDocumentLaneContainerIds(
  execSql: ExecSql,
  containerIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<string>> {
  if (containerIds.length === 0) {
    return [];
  }
  const [settled, pending, requested] = await Promise.all([
    new ContainerSyncWatermarkRepository(
      execSql,
    ).listSettledContainerDocumentLaneIds(),
    new DocumentDiscoveryEvidenceRepository(execSql).listPendingContainerIds(),
    new DocumentLaneRevalidationRepository(execSql).listOwedContainerIds(),
  ]);
  return containerIds.filter(
    (containerId) =>
      documentLaneDiscoveryState({
        pendingCandidates: pending.has(containerId),
        requested: requested.has(containerId),
        settled: settled.has(containerId),
      }).status === "owed",
  );
}

/**
 * Owes each container's document lane one listing, durably. A tree listing
 * calls it for a container whose row it was served, before the serving lane's
 * watermark passes that row.
 */
export function requestDocumentLaneListings(
  execSql: ExecSql,
  containerIds: ReadonlyArray<string>,
): Promise<void> {
  return new DocumentLaneRevalidationRepository(execSql).request(containerIds);
}

export type { DocumentLaneRevalidation } from "../../../data/persistence/container-contents/documentLaneRevalidations";

/**
 * The listings a tree listing still owes these containers' lanes. A listing
 * reads them before its request, so it settles only what was owed before it
 * began.
 */
export function findOwedDocumentLaneListings(
  execSql: ExecSql,
  containerIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<DocumentLaneRevalidation>> {
  return new DocumentLaneRevalidationRepository(execSql).find(containerIds);
}

/** Settles the request a settled listing read before it began. */
export function settleOwedDocumentLaneListing(
  execSql: ExecSql,
  owed: DocumentLaneRevalidation,
): Promise<void> {
  return new DocumentLaneRevalidationRepository(execSql).settle(owed);
}

/**
 * Forgets the listings owed to containers this device does not store.
 * Nothing lists such a lane, and a container stored later owes its first
 * listing by having no settled lane.
 */
export function forgetUnheldDocumentLaneListings(
  execSql: ExecSql,
): Promise<void> {
  return new DocumentLaneRevalidationRepository(execSql).forgetUnheld();
}
