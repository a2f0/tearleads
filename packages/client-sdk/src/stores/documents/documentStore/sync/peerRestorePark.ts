import {
  documentSyncPullTip,
  INITIAL_PEER_RESTORE_PARK_STATE,
  type PeerRestoreParkState,
  shouldDeferQueuedWritesWhileParked,
  transitionPeerRestorePark,
} from "../../../../data/documents/shared/sync/peerRestoreParkMachine";

const parkStateByStore = new WeakMap<object, PeerRestoreParkState>();

function getState(state: object): PeerRestoreParkState {
  return parkStateByStore.get(state) ?? INITIAL_PEER_RESTORE_PARK_STATE;
}

function applyTransition(
  state: object,
  event: Parameters<typeof transitionPeerRestorePark>[1],
): boolean {
  const next = transitionPeerRestorePark(getState(state), event);
  if (next.state.status === "active") {
    parkStateByStore.delete(state);
  } else {
    parkStateByStore.set(state, next.state);
  }
  return next.requestSync;
}

export function shouldDeferDocumentStoreQueuedWrites(state: object): boolean {
  return shouldDeferQueuedWritesWhileParked(getState(state));
}

export function isDocumentPeerRestorePullNeeded(state: object): boolean {
  return getState(state).status === "parked_pull_needed";
}

export function recordDocumentPeerRestoreParked(state: object): boolean {
  return applyTransition(state, { type: "parked" });
}

export function resumeDocumentPeerRestoreOnHint(state: object): boolean {
  return applyTransition(state, { type: "peer_restore_allowed_hint" });
}

export function resetDocumentPeerRestorePark(state: object): void {
  applyTransition(state, { type: "reset" });
}

export function settleDocumentPeerRestoreAfterSync(input: {
  readonly outgoingUpdateCount: number;
  readonly pullComplete: boolean;
  readonly pullPage: {
    readonly throughUpdateCount: number;
    readonly throughUpdateId: string | null;
  };
  readonly settledPendingUpdateCount: number;
  readonly state: object;
  readonly writesDeferred: boolean | undefined;
}): boolean {
  if (input.writesDeferred) {
    if (!input.pullComplete) return false;
    return applyTransition(input.state, {
      pullTip: documentSyncPullTip(input.pullPage),
      type: "pull_settled",
    });
  }
  if (input.outgoingUpdateCount > 0 && input.settledPendingUpdateCount > 0) {
    applyTransition(input.state, { type: "write_pass_succeeded" });
  }
  return false;
}
