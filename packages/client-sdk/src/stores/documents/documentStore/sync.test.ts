import { expect, test } from "bun:test";
import type { DocumentStoreState } from "./state";
import {
  canClearRemoteUpdateSignalAfterSync,
  clearConsumedRemoteUpdateSignal,
  handleDocumentRemoteEvents,
  hasRemoteDocumentUpdateEvent,
} from "./syncRemoteSignals";

function createEventTestState(
  locallyAcceptedUpdateIds: readonly string[],
): DocumentStoreState {
  return {
    locallyAcceptedUpdateIds: new Set(locallyAcceptedUpdateIds),
    record: {
      documentId: "document-1",
    },
  } as DocumentStoreState;
}

function createRemoteEventState(
  events: readonly unknown[],
): DocumentStoreState {
  return {
    lastEventCount: 0,
    locallyAcceptedUpdateIds: new Set<string>(),
    record: { documentId: "document-1" },
    remoteUpdateCompletedSignalSeq: 0,
    remoteUpdatePending: false,
    remoteUpdateSignalSeq: 0,
    runtime: { state: { events: [...events] } },
  } as unknown as DocumentStoreState;
}

test("hasRemoteDocumentUpdateEvent cleans local echo ids after earlier remote events", () => {
  const state = createEventTestState(["local-update-1"]);

  expect(
    hasRemoteDocumentUpdateEvent(state, [
      {
        documentId: "document-1",
        type: "document_update_created",
      },
      {
        documentId: "document-1",
        type: "document_update_created",
        updateIds: ["local-update-1"],
      },
    ]),
  ).toBe(true);

  expect(state.locallyAcceptedUpdateIds.has("local-update-1")).toBe(false);
});

test("hasRemoteDocumentUpdateEvent cleans local ids from mixed update events", () => {
  const state = createEventTestState(["local-update-1", "local-update-2"]);

  expect(
    hasRemoteDocumentUpdateEvent(state, [
      {
        documentId: "document-1",
        type: "document_update_created",
        updateIds: ["local-update-1", "remote-update-1", "local-update-2"],
      },
    ]),
  ).toBe(true);

  expect([...state.locallyAcceptedUpdateIds]).toEqual([]);
});

test("handleDocumentRemoteEvents bumps the signal sequence when a remote update arrives", () => {
  const state = createRemoteEventState([
    { documentId: "document-1", type: "document_update_created" },
  ]);

  let scheduled = 0;
  handleDocumentRemoteEvents(state, () => {
    scheduled += 1;
  });

  expect(state.remoteUpdatePending).toBe(true);
  // The sequence MUST advance so an in-flight pass that snapshotted seq 0 can
  // detect this fresh signal and refuse to clear it.
  expect(state.remoteUpdateSignalSeq).toBe(1);
  expect(scheduled).toBe(1);
});

// Regression for a convergence-stall race: finalizeDocumentSync used to clear
// remoteUpdatePending unconditionally at the end of a pass, AFTER the network
// GET + persist awaits. A peer update that committed after this pass's GET
// snapshot but whose event arrived during the await would set the signal, then
// be erased by the unconditional clear; the coalesced re-run then skipped (no
// pending signal) and the update was never fetched. The fix snapshots the
// signal sequence at pass entry and only clears when it is unchanged.
test("a remote event arriving mid-pass keeps the signal set so the re-run fetches it", () => {
  // Pass enters and snapshots the current signal sequence.
  const consumedSignalSeq = 0;

  // E2 arrives during the pass's await window: handleDocumentRemoteEvents
  // re-sets the signal and advances the sequence past what the pass consumed.
  const state = createRemoteEventState([
    { documentId: "document-1", type: "document_update_created" },
  ]);
  handleDocumentRemoteEvents(state, () => {});
  expect(state.remoteUpdateSignalSeq).toBe(1);

  // finalizeDocumentSync must NOT clear the signal, because a newer event is
  // pending; otherwise E2 is lost and convergence stalls.
  expect(
    canClearRemoteUpdateSignalAfterSync(
      state.remoteUpdateSignalSeq,
      consumedSignalSeq,
    ),
  ).toBe(false);
});

test("a quiescent pass clears the signal so it does not re-sync forever", () => {
  const state = createRemoteEventState([]);
  state.remoteUpdatePending = true;
  state.remoteUpdateSignalSeq = 3;

  clearConsumedRemoteUpdateSignal(state, 3);

  expect(state.remoteUpdateCompletedSignalSeq).toBe(3);
  expect(state.remoteUpdatePending).toBe(false);
});
