/**
 * Durable reads owed to container metadata documents.
 *
 * A clean metadata document skips its read until a hint names it, and hints
 * are lost while this client is offline or not yet subscribed. Hydration owes a
 * read when a listing shows the container changed since this client recorded
 * it. The owed read joins the in-memory needs-sync queue first, so a pass
 * already reading the document sees the sequence move and keeps it, and is
 * then written down, before hydration advances the timestamps and the lane
 * watermark that revealed it. A store's first sync pass reloads what is still
 * owed. Each request carries a revision; a read settles only the revision it
 * saw before its request, so a newer request from another tab survives.
 */

import type {
  ContainerMetadataRevalidation,
  ExecSql,
} from "../../../workflows/container-contents/containerPersistence";
import { bumpMetadataSyncSeq } from "./metadataSyncSignal";
import type { ContainerContentsStoreSyncState } from "./syncAgentTypes";

type MetadataRevalidationState = Pick<
  ContainerContentsStoreSyncState,
  | "containersById"
  | "metadataDocumentIdsNeedingSync"
  | "metadataSyncSignalSeqById"
  | "persistence"
  | "runtime"
>;

function queueMetadataRead(
  state: MetadataRevalidationState,
  documentId: string,
): void {
  state.metadataDocumentIdsNeedingSync.add(documentId);
  bumpMetadataSyncSeq(state.metadataSyncSignalSeqById, documentId);
}

/** Owe a metadata document one read, in memory and then durably. */
export async function oweContainerMetadataRead(
  state: MetadataRevalidationState,
  documentId: string,
): Promise<void> {
  queueMetadataRead(state, documentId);
  await state.persistence.requestContainerMetadataRevalidation(
    state.runtime.infra.execSql,
    documentId,
  );
}

/**
 * Requeue reads a previous run still owed for the containers now held, and
 * return how many. A debt for a container this store does not hold is left
 * alone: another tab sharing the database may hold it. Work stops once
 * `isCurrent` reports a replaced store or database.
 */
export async function restoreOwedContainerMetadataReads(
  state: MetadataRevalidationState,
  isCurrent: () => boolean,
): Promise<number> {
  const { execSql } = state.runtime.infra;
  const heldDocumentIds = new Set(
    [...state.containersById.values()].map(({ record }) => record.documentId),
  );
  const owed =
    await state.persistence.listContainerMetadataRevalidations(execSql);
  if (!isCurrent()) return 0;
  let restored = 0;
  for (const { documentId } of owed) {
    if (heldDocumentIds.has(documentId)) {
      queueMetadataRead(state, documentId);
      restored += 1;
    }
  }
  return restored;
}

/** The durable request a read is about to answer, read before its request. */
export async function findOwedContainerMetadataRead(
  state: MetadataRevalidationState,
  input: { readonly documentId: string; readonly execSql: ExecSql },
): Promise<ContainerMetadataRevalidation | null> {
  const owed = await state.persistence.listContainerMetadataRevalidations(
    input.execSql,
  );
  return owed.find(({ documentId }) => documentId === input.documentId) ?? null;
}

/**
 * Forget the request a completed read answered, once that read also cleared
 * the queued one. The read's own database is passed in, so a pass that
 * outlived a database swap never settles a debt the replacement owes.
 */
export async function settleOwedContainerMetadataRead(
  state: MetadataRevalidationState,
  input: {
    readonly execSql: ExecSql;
    readonly revalidation: ContainerMetadataRevalidation;
  },
): Promise<void> {
  if (state.metadataDocumentIdsNeedingSync.has(input.revalidation.documentId)) {
    return;
  }
  await state.persistence.settleContainerMetadataRevalidation(
    input.execSql,
    input.revalidation,
  );
}
