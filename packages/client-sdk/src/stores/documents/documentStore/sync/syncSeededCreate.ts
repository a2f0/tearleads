import { encodeVersionVector } from "@tearleads/loro";
import {
  type DocumentRecord,
  documentCreateSeedCandidate,
  type PendingUpdateRecord,
} from "../../../../workflows/documents";
import { listPendingUpdates } from "../persistence";
import type {
  DocumentState,
  DocumentStoreState,
  EncapsulationKeyPair,
} from "../state";
import {
  cleanupPreRegisteredUpdateIdsOnFailure,
  discardPreRegisteredUpdateIds,
  preRegisterMaterializedDocumentSyncUpdateIds,
} from "./syncAcceptedUpdateIds";
import type { DocumentStoreSyncGeneration } from "./syncGeneration";
import { clearConsumedRemoteUpdateSignal } from "./syncRemoteSignals";
import { ensureRemoteDocument } from "./syncShared";

/**
 * Creates a document that does not exist remotely yet. When its whole content
 * is one queued row (see `documentCreateSeedCandidate`), the create commits
 * that row as its seed and stands in for this pass's sync: the row settles and
 * a signal raised before the pass is answered, since no remote content can
 * predate the create. A deferred birth with nothing queued keeps the ordinary
 * path, where the coverage pass materializes it.
 */
export async function ensureSeededRemoteDocument(input: {
  readonly consumedRemoteUpdateSignalSeq: number;
  readonly currentDoc: DocumentState;
  readonly encapsulationKeyPair: EncapsulationKeyPair;
  readonly generation: DocumentStoreSyncGeneration;
  readonly nextRecord: DocumentRecord;
  readonly pendingUpdates: PendingUpdateRecord[];
  readonly state: DocumentStoreState;
}): Promise<{
  readonly pendingUpdates: PendingUpdateRecord[];
  readonly record: DocumentRecord | null;
}> {
  const { state } = input;
  const seedUpdate = input.nextRecord.documentId
    ? null
    : documentCreateSeedCandidate({
        documentVersion: encodeVersionVector(input.currentDoc),
        pendingUpdates: input.pendingUpdates,
      });
  const ensure = (seed: Parameters<typeof ensureRemoteDocument>[5]) =>
    ensureRemoteDocument(
      state,
      input.currentDoc,
      input.nextRecord,
      input.encapsulationKeyPair,
      input.generation,
      seed,
    );
  if (!seedUpdate) {
    return {
      pendingUpdates: input.pendingUpdates,
      record: await ensure(undefined),
    };
  }

  // Registered before the network await, as a sync registers its sent ids, so
  // the create's own update echo is classified as self-authored.
  const seedUpdateIds: string[] = [];
  preRegisterMaterializedDocumentSyncUpdateIds(state, seedUpdateIds, [
    seedUpdate.id,
  ]);
  let committed = false;
  const record = await cleanupPreRegisteredUpdateIdsOnFailure(
    state,
    seedUpdateIds,
    () =>
      ensure({
        onCommitted: () => {
          committed = true;
        },
        update: seedUpdate,
      }),
  );
  if (!committed) {
    discardPreRegisteredUpdateIds(state, seedUpdateIds);
    return { pendingUpdates: input.pendingUpdates, record };
  }
  clearConsumedRemoteUpdateSignal(state, input.consumedRemoteUpdateSignalSeq);
  return { pendingUpdates: await listPendingUpdates(state), record };
}
