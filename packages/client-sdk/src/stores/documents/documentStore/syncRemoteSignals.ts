import { isDocumentUpdateCreatedEvent } from "../../../data/documents/documentSync";
import { sequenceUnchanged } from "../../../workflows/documents/syncLane";
import type { DocumentStoreState } from "./state";

export function hasRemoteDocumentUpdateEvent(
  state: DocumentStoreState,
  events: ReadonlyArray<unknown>,
): boolean {
  let remoteUpdateFound = false;

  for (const event of events) {
    if (
      !isDocumentUpdateCreatedEvent(event) ||
      event.documentId !== state.record?.documentId
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
  if (!state.record?.documentId) {
    state.lastEventCount = state.runtime.state.events.length;
    return;
  }

  const nextEvents = state.runtime.state.events.slice(state.lastEventCount);
  state.lastEventCount = state.runtime.state.events.length;

  if (hasRemoteDocumentUpdateEvent(state, nextEvents)) {
    state.remoteUpdatePending = true;
    // Let an in-flight pass distinguish this new signal from the one it
    // consumed before its network request.
    state.remoteUpdateSignalSeq += 1;
    scheduleSync();
  }
}
