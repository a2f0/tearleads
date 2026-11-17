/**
 * Durable reads owed to container metadata documents.
 *
 * A clean metadata document skips its read until a hint names it, and hints
 * are lost while this client is offline or not yet subscribed. Hydration owes a
 * read when a listing shows the container changed since this client recorded
 * it. The owed read joins the in-memory needs-sync queue first, so a pass
 * already reading the document sees the sequence move and keeps it, and is
 * then written down, before hydration advances the timestamps and the lane
 * watermark that revealed it. A restart reloads what is still owed.
 */

import {
  listContainerMetadataRevalidations,
  requestContainerMetadataRevalidation,
  settleContainerMetadataRevalidation,
} from "../../../workflows/container-contents/metadata/metadataRevalidation";
import { bumpMetadataSyncSeq } from "./metadataSyncSignal";
import type { ContainerContentsStoreSyncState } from "./syncAgentTypes";

type MetadataRevalidationState = Pick<
  ContainerContentsStoreSyncState,
  | "containersById"
  | "metadataDocumentIdsNeedingSync"
  | "metadataSyncSignalSeqById"
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
  await requestContainerMetadataRevalidation(
    state.runtime.infra.execSql,
    documentId,
  );
}

/**
 * Requeue reads a previous run still owed for the containers now loaded, and
 * returns how many. A debt for a container no longer held is dropped: a
 * container that returns is re-attached without key bundles, so it is read
 * anyway.
 */
export async function restoreOwedContainerMetadataReads(
  state: MetadataRevalidationState,
): Promise<number> {
  const { execSql } = state.runtime.infra;
  const heldDocumentIds = new Set(
    [...state.containersById.values()].map(({ record }) => record.documentId),
  );
  let restored = 0;
  for (const documentId of await listContainerMetadataRevalidations(execSql)) {
    if (heldDocumentIds.has(documentId)) {
      queueMetadataRead(state, documentId);
      restored += 1;
    } else {
      await settleContainerMetadataRevalidation(execSql, documentId);
    }
  }
  return restored;
}

/** Forget the durable debt once a completed read cleared the queued one. */
export async function settleOwedContainerMetadataRead(
  state: MetadataRevalidationState,
  documentId: string,
): Promise<void> {
  if (state.metadataDocumentIdsNeedingSync.has(documentId)) {
    return;
  }
  await settleContainerMetadataRevalidation(
    state.runtime.infra.execSql,
    documentId,
  );
}
