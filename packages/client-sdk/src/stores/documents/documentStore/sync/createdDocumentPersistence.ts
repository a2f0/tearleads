import { mergeVersionVectors } from "@tearleads/loro";
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
 * How a create that committed `seedUpdate` settles it: the row is accepted,
 * the commit position is the one its first sync would have recorded, and the
 * outgoing marker and frontier advance over it as the coverage pass would
 * have (see `prepareDocumentOutgoingCoverage`). Null when the create did not
 * commit the seed (a plain fallback or an adoption): the row stays queued and
 * syncs as before.
 */
function committedSeedSettlement(input: {
  readonly created: CreatedRemoteDocument;
  readonly liveRecord: DocumentRecord | null;
  readonly pendingBaseVersion: string | null;
  readonly seedUpdate: PendingUpdateRecord | undefined;
}): {
  readonly baseVersion: string;
  readonly options: SaveDocumentRecordOptions;
  readonly patch: Partial<DocumentRecord>;
} | null {
  const { seedUpdate } = input;
  const seed = input.created.response?.initialSync;
  if (
    !seedUpdate ||
    input.pendingBaseVersion === null ||
    !seed?.acceptedOutgoingUpdateIds.includes(seedUpdate.id)
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
    },
    patch: {
      lastCommitLsn: seed.commitLsn,
      snapshotEndVersion: mergeVersionVectors([
        ...(liveFrontier.length > 0 ? [liveFrontier] : []),
        baseVersion,
      ]),
    },
  };
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
    created: input.created,
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
    // As the coverage pass does: merge, so a concurrent local write that
    // advanced the in-memory marker is never moved backwards.
    if (state.pendingBaseVersion !== null) {
      state.pendingBaseVersion = mergeVersionVectors([
        state.pendingBaseVersion,
        settlement.baseVersion,
      ]);
    }
    input.seed?.onCommitted();
  }
  return persisted;
}
