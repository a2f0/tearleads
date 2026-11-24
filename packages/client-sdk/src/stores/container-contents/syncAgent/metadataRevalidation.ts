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
import { coversMetadataUpdateCount } from "../../../workflows/container-contents/metadata/metadataSyncVerdicts";
import type { SyncedContainerMetadataState } from "../../../workflows/container-contents/metadata/metadataTypes";
import type { ContainerState } from "../../../workflows/container-contents/remoteHydration";
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
  request: {
    readonly advertisedUpdateCount: number;
    readonly documentId: string;
  },
): Promise<void> {
  queueMetadataRead(state, request.documentId);
  await state.persistence.requestContainerMetadataRevalidation(
    state.runtime.infra.execSql,
    request,
  );
}

/**
 * Whether a completed read, once saved, covers the update count a listing
 * advertised: this device's processed cursor counts at least as many. A read
 * served by a replica that lags the listing can succeed without the edit; its
 * debt then stays for a later pass.
 */
function coversAdvertisedMetadataUpdates(
  execSql: ExecSql,
  containerState: Pick<ContainerState, "container" | "doc">,
  owed: ContainerMetadataRevalidation,
): Promise<boolean> {
  return coversMetadataUpdateCount(execSql, {
    containerId: containerState.container.id,
    doc: containerState.doc,
    documentId: owed.documentId,
    updateCount: owed.advertisedUpdateCount,
  });
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

/**
 * Whether a completed read keeps its signals for another read, and whether to
 * ask for that read now. A resumed pull reads only to its earlier bound, and a
 * superseded result discarded what it pulled: both hand the read to a fresh
 * pass. A replica lagging the listing can answer without the advertised edit;
 * that debt waits for a later pass rather than a follow-up loop.
 */
export async function keptContainerMetadataSignals(input: {
  containerState: ContainerState;
  execSql: ExecSql;
  owedRead: ContainerMetadataRevalidation | null;
  synced: SyncedContainerMetadataState;
}): Promise<{ followUp: boolean; keep: boolean }> {
  const followUp =
    input.synced.resumedEarlierPull === true ||
    isSupersededMetadataSync(input.synced);
  const behindListing =
    input.owedRead !== null &&
    !(await coversAdvertisedMetadataUpdates(
      input.execSql,
      input.containerState,
      input.owedRead,
    ));
  return { followUp, keep: followUp || behindListing };
}

function isSupersededMetadataSync(
  synced: Pick<
    SyncedContainerMetadataState,
    | "mutationSuperseded"
    | "pullContinuationSuperseded"
    | "syncIdentitySuperseded"
  >,
): boolean {
  return (
    synced.mutationSuperseded === true ||
    synced.pullContinuationSuperseded === true ||
    synced.syncIdentitySuperseded === true
  );
}
