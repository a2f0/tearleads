/**
 * Explicit state machine for writes parked behind a post-purge peer-ownership
 * refusal (`document_peer_restore_awaits_owner`).
 *
 * While parked, the document's queued writes stay on disk and every sync pass
 * runs pull-only so remote reads stay live (#3263, Residual 3). Tracking the
 * server's drained `pullTip` (`throughUpdateCount:throughUpdateId`) avoids
 * mistaking pre-purge local `committedVersion` for post-purge server state and
 * still detects when another device restores the missing peer even if this
 * device already holds those operations locally.
 */
export type PeerRestoreParkState =
  | { readonly status: "active" }
  | {
      readonly status: "parked_pull_needed";
      readonly observedPullTip: string | null;
    }
  | {
      readonly status: "parked";
      readonly observedPullTip: string | null;
    }
  | {
      readonly status: "probing_writes";
      readonly observedPullTip: string | null;
    };

export type PeerRestoreParkEvent =
  | { readonly type: "parked" }
  | {
      readonly type: "pull_settled";
      readonly pullTip: string;
    }
  | { readonly type: "peer_restore_allowed_hint" }
  | { readonly type: "write_pass_succeeded" }
  | { readonly type: "reset" };

export interface PeerRestoreParkTransition {
  readonly state: PeerRestoreParkState;
  /** True when the transition requires scheduling a follow-up sync pass. */
  readonly requestSync: boolean;
}

export const INITIAL_PEER_RESTORE_PARK_STATE: PeerRestoreParkState = {
  status: "active",
};

/** Opaque server tip identifier from a drained sync pull page. */
export function documentSyncPullTip(pullPage: {
  readonly throughUpdateCount: number;
  readonly throughUpdateId: string | null;
}): string {
  return `${pullPage.throughUpdateCount}:${pullPage.throughUpdateId ?? ""}`;
}

/** True when a sync pass must withhold queued writes and run pull-only. */
export function shouldDeferQueuedWritesWhileParked(
  state: PeerRestoreParkState,
): boolean {
  return state.status === "parked_pull_needed" || state.status === "parked";
}

/** Pure transition function for {@link PeerRestoreParkState}. */
export function transitionPeerRestorePark(
  state: PeerRestoreParkState,
  event: PeerRestoreParkEvent,
): PeerRestoreParkTransition {
  switch (event.type) {
    case "reset":
    case "write_pass_succeeded":
      return { requestSync: false, state: INITIAL_PEER_RESTORE_PARK_STATE };
    case "parked": {
      if (state.status === "active") {
        // Trigger one immediate pull-only pass so remote edits committed before
        // the 409 arrive immediately and we capture the current server tip.
        return {
          requestSync: true,
          state: { observedPullTip: null, status: "parked_pull_needed" },
        };
      }
      return {
        requestSync: false,
        state: { observedPullTip: state.observedPullTip, status: "parked" },
      };
    }
    case "pull_settled": {
      if (state.status === "active" || state.status === "probing_writes") {
        return { requestSync: false, state };
      }
      if (state.status === "parked_pull_needed") {
        return {
          requestSync: false,
          state: { observedPullTip: event.pullTip, status: "parked" },
        };
      }
      if (
        state.observedPullTip !== null &&
        event.pullTip !== state.observedPullTip
      ) {
        // Another device committed to the document. This pull-only pass just
        // applied any missing operations; probe queued writes once in case the
        // missing peer was restored.
        return {
          requestSync: true,
          state: { observedPullTip: event.pullTip, status: "probing_writes" },
        };
      }
      return {
        requestSync: false,
        state: { observedPullTip: event.pullTip, status: "parked" },
      };
    }
    case "peer_restore_allowed_hint": {
      if (state.status === "parked" || state.status === "parked_pull_needed") {
        return {
          requestSync: true,
          state: {
            observedPullTip: state.observedPullTip,
            status: "probing_writes",
          },
        };
      }
      return { requestSync: false, state };
    }
  }
}
