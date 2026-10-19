import {
  isContainerProjectionInvalidationHint,
  isDocumentUpdateCreatedEvent,
} from "../../../../data/documents/documentSync";
import { sequenceUnchanged } from "../../../../workflows/documents/sync/syncLane";
import { resumeAfterAncestorRepairHint } from "../ancestorRepairPark";
import type { DocumentStoreState } from "../state";
import { invalidateDocumentWriterProjection } from "../writerProjectionGeneration";
import {
  allowDocumentStoreRemoteSync,
  markDocumentStoreRemoteSyncPending,
} from "./syncGeneration";

/**
 * The client-chosen id each store last submitted a remote create under. A peer
 * can edit the document between the create's commit and the creator
 * installing the id, and a seeded create answers the pass's earlier signal
 * without a pull, so that edit's hint must still mark the store pending.
 */
const plannedRemoteDocumentIds = new WeakMap<DocumentStoreState, string>();

export function recordPlannedRemoteDocumentId(
  state: DocumentStoreState,
  documentId: string,
): void {
  plannedRemoteDocumentIds.set(state, documentId);
}

function remoteUpdateHintDocumentId(state: DocumentStoreState): string | null {
  if (!state.record) return null;
  return state.record.documentId ?? plannedRemoteDocumentIds.get(state) ?? null;
}

export function hasRemoteDocumentUpdateEvent(
  state: DocumentStoreState,
  events: ReadonlyArray<unknown>,
): boolean {
  const documentId = remoteUpdateHintDocumentId(state);
  let remoteUpdateFound = false;

  for (const event of events) {
    if (
      !isDocumentUpdateCreatedEvent(event) ||
      event.documentId !== documentId
    ) {
      continue;
    }

    if (event.updateIds && event.updateIds.length > 0) {
      for (const updateId of event.updateIds) {
        if (!state.locallyAcceptedUpdateIds.has(updateId)) {
          remoteUpdateFound = true;
          continue;
        }

        state.locallyAcceptedUpdateIds.delete(updateId);
      }
      continue;
    }

    remoteUpdateFound = true;
  }

  return remoteUpdateFound;
}

/** Clear the remote-update signal only when its consumed sequence is unchanged.
 * A moved sequence means a newer remote event arrived mid-pass and must survive
 * for the coalesced re-run to avoid the convergence-stall race.
 */
export const canClearRemoteUpdateSignalAfterSync = sequenceUnchanged;

export function clearConsumedRemoteUpdateSignal(
  state: DocumentStoreState,
  consumedSignalSequence: number,
): void {
  // A peer event can arrive while the HTTP request is in flight. Clear only
  // the sequence this pass consumed so the newer event survives for a re-run.
  if (
    canClearRemoteUpdateSignalAfterSync(
      state.remoteUpdateSignalSeq,
      consumedSignalSequence,
    )
  ) {
    state.remoteUpdateCompletedSignalSeq = consumedSignalSequence;
    state.remoteUpdatePending = false;
  }
}

export function handleDocumentRemoteEvents(
  state: DocumentStoreState,
  scheduleSync: () => void,
): void {
  const nextEvents = state.runtime.state.events.slice(state.lastEventCount);
  state.lastEventCount = state.runtime.state.events.length;

  // A container the document's path cites may have moved its manifest; the
  // store cannot tell which containers this document links into, so the held
  // projection goes and the next mutation fetches a fresh one. This runs even
  // before the document has a remote id: a create in flight captured the
  // generation when it started and must not install its pre-hint projection.
  const projectionInvalidated = nextEvents.some(
    isContainerProjectionInvalidationHint,
  );
  if (projectionInvalidated) invalidateDocumentWriterProjection(state);

  if (!remoteUpdateHintDocumentId(state)) return;

  // Writes parked behind an ancestor another member must re-key: this hint is
  // the only signal that the repair may have landed. It names no ancestor, so
  // any one re-runs the pass, which parks again if the path is still stale.
  if (
    state.record?.documentId &&
    projectionInvalidated &&
    resumeAfterAncestorRepairHint(state)
  ) {
    scheduleSync();
  }

  if (hasRemoteDocumentUpdateEvent(state, nextEvents)) {
    allowDocumentStoreRemoteSync(state);
    // Let an in-flight pass distinguish this new signal from the one it
    // consumed before its network request.
    markDocumentStoreRemoteSyncPending(state, "independent");
    scheduleSync();
  }
}
