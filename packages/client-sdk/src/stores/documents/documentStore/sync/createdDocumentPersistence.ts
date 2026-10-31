import { mergeVersionVectors } from "@tearleads/loro";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentCreateSeedResponse } from "@tearleads/validators/response";
import type {
  createRemoteDocument,
  DocumentRecord,
  PendingUpdateRecord,
} from "../../../../workflows/documents";
import { persistDocument } from "../persistence";
import type {
  DocumentState,
  DocumentStoreState,
  PersistedDocumentRecord,
  SaveDocumentRecordOptions,
} from "../state";
import type { DocumentStoreSyncGeneration } from "./syncGeneration";

type CreatedRemoteDocument = NonNullable<
  Awaited<ReturnType<typeof createRemoteDocument>>
>;

/** A create's seed; `onCommitted` runs once its settlement persists. */
export interface CreateSeed {
  readonly onCommitted: () => void;
  readonly update: PendingUpdateRecord;
}

/**
 * A create's deferred first update, for its attachment bind to carry:
 * `onSigned` receives it signed, once the created identity persists.
 */
export interface DeferredBindSeed {
  readonly onSigned: (request: DocumentSyncRequest) => void;
  readonly update: PendingUpdateRecord;
}

/**
 * How a request that committed `seedUpdate` (a create's seed, or the deferred
 * first update an attachment bind carried) settles it: the row is accepted,
 * the commit position is the one its first sync would have recorded, and the
 * outgoing marker and frontier advance over it as the coverage pass would
 * have (see `prepareDocumentOutgoingCoverage`). Null when the request did not
 * commit the seed (a plain fallback or an adoption): the row stays queued and
 * syncs as before.
 */
function committedSeedSettlement(input: {
  readonly committed: DocumentCreateSeedResponse | undefined;
  readonly liveRecord: DocumentRecord | null;
  readonly pendingBaseVersion: string | null;
  readonly seedUpdate: PendingUpdateRecord | undefined;
}): {
  readonly baseVersion: string;
  readonly options: SaveDocumentRecordOptions;
  readonly patch: Partial<DocumentRecord>;
} | null {
  const { committed, seedUpdate } = input;
  if (
    !seedUpdate ||
    input.pendingBaseVersion === null ||
    !committed?.acceptedOutgoingUpdateIds.includes(seedUpdate.id)
  ) {
    return null;
  }
  const baseVersion = mergeVersionVectors([
    input.pendingBaseVersion,
    seedUpdate.partialEndVersionVector,
  ]);
  const liveFrontier = input.liveRecord?.snapshotEndVersion ?? "";
  return {
    baseVersion,
    options: {
      acceptedPendingUpdateIds: [seedUpdate.id],
      clearSyncFailure: true,
      pendingBaseVersionOverride: baseVersion,
      preserveSnapshotStructuredFields: true,
      preserveSnapshotText: true,
    },
    patch: {
      lastCommitLsn: committed.commitLsn,
      snapshotEndVersion: mergeVersionVectors([
        ...(liveFrontier.length > 0 ? [liveFrontier] : []),
        baseVersion,
      ]),
    },
  };
}

/**
 * As the coverage pass does: merge, so a concurrent local write that
 * advanced the in-memory marker is never moved backwards.
 */
function advancePendingBaseVersion(
  state: DocumentStoreState,
  baseVersion: string,
): void {
  if (state.pendingBaseVersion !== null) {
    state.pendingBaseVersion = mergeVersionVectors([
      state.pendingBaseVersion,
      baseVersion,
    ]);
  }
}

/**
 * Persists a just-created remote identity (documentId and content keys), and
 * settles the create's seed when it committed. Preserves the optimistic
 * snapshot fields: the user may have kept typing during the round trip.
 */
export async function persistCreatedRemoteDocument(input: {
  readonly created: CreatedRemoteDocument;
  readonly currentDoc: DocumentState;
  readonly generation: DocumentStoreSyncGeneration | undefined;
  readonly seed: CreateSeed | undefined;
  readonly state: DocumentStoreState;
}): Promise<PersistedDocumentRecord | null> {
  const { state } = input;
  const settlement = committedSeedSettlement({
    committed: input.created.response?.initialSync,
    liveRecord: state.record,
    pendingBaseVersion: state.pendingBaseVersion,
    seedUpdate: input.seed?.update,
  });
  const persisted = await persistDocument(
    state,
    input.currentDoc,
    { ...input.created.persistedState, ...settlement?.patch },
    {
      ...settlement?.options,
      preserveSnapshotStructuredFields: true,
      preserveSnapshotText: true,
    },
    input.generation,
  );
  if (persisted && settlement) {
    advancePendingBaseVersion(state, settlement.baseVersion);
    input.seed?.onCommitted();
  }
  return persisted;
}

/**
 * Settles the deferred first update an attachment bind carried once the
 * bind's acknowledgement names it. Otherwise the row stays queued and syncs
 * on its own, as it did before a bind could carry it. Returns whether the
 * row settled.
 */
export async function persistBindCarriedSeed(input: {
  readonly committed: DocumentCreateSeedResponse | undefined;
  readonly currentDoc: DocumentState;
  readonly generation: DocumentStoreSyncGeneration;
  readonly state: DocumentStoreState;
  /** Rechecked as the durable mutation starts. */
  readonly stillCurrent: () => boolean;
  readonly update: PendingUpdateRecord;
}): Promise<boolean> {
  const { state } = input;
  const settlement = committedSeedSettlement({
    committed: input.committed,
    liveRecord: state.record,
    pendingBaseVersion: state.pendingBaseVersion,
    seedUpdate: input.update,
  });
  if (!settlement) return false;
  const persisted = await persistDocument(
    state,
    input.currentDoc,
    settlement.patch,
    { ...settlement.options, stillCurrent: input.stillCurrent },
    input.generation,
  );
  if (!persisted) return false;
  advancePendingBaseVersion(state, settlement.baseVersion);
  return true;
}
