/**
 * Whether the Sync Status tray app shows sync as active, held so a lane run
 * that starts and settles within a moment does not blink the glyph.
 *
 * - `idle`: no activity shown.
 * - `entering`: activity began; it shows once it outlasts the enter delay.
 * - `active`: activity shown.
 * - `leaving`: activity stopped; it stays shown until the exit delay ends,
 *   so a run that follows straight after keeps the glyph steady.
 *
 * Effects run on entering a state: `entering` and `leaving` arm their delay,
 * and leaving either disarms it.
 */
export type SyncActivityHoldState =
  | { readonly status: "idle" }
  | { readonly status: "entering" }
  | { readonly status: "active" }
  | { readonly status: "leaving" };

export type SyncActivityHoldEvent =
  | { readonly active: boolean; readonly type: "activity-changed" }
  | { readonly type: "delay-elapsed" };

export const IDLE_SYNC_ACTIVITY_HOLD: SyncActivityHoldState = {
  status: "idle",
};

type SyncActivityHoldStatus = SyncActivityHoldState["status"];
type SyncActivityHoldInput = "on" | "off" | "elapsed";

const STATES: Record<SyncActivityHoldStatus, SyncActivityHoldState> = {
  active: { status: "active" },
  entering: { status: "entering" },
  idle: IDLE_SYNC_ACTIVITY_HOLD,
  leaving: { status: "leaving" },
};

// The table below, row by row.
const NEXT: Record<
  SyncActivityHoldStatus,
  Record<SyncActivityHoldInput, SyncActivityHoldStatus>
> = {
  active: { elapsed: "active", off: "leaving", on: "active" },
  entering: { elapsed: "active", off: "idle", on: "entering" },
  idle: { elapsed: "idle", off: "idle", on: "entering" },
  leaving: { elapsed: "idle", off: "leaving", on: "active" },
};

/** Whether this state shows sync as active. */
export function showsSyncActivity(state: SyncActivityHoldState): boolean {
  return state.status === "active" || state.status === "leaving";
}

/**
 * Pure transition; returns the same reference for ignored events.
 *
 * | state \ event | activity on | activity off | delay-elapsed |
 * | ------------- | ----------- | ------------ | ------------- |
 * | idle          | entering    | (same)       | (same)        |
 * | entering      | (same)      | idle         | active        |
 * | active        | (same)      | leaving      | (same)        |
 * | leaving       | active      | (same)       | idle          |
 */
export function transitionSyncActivityHold(
  state: SyncActivityHoldState,
  event: SyncActivityHoldEvent,
): SyncActivityHoldState {
  const input: SyncActivityHoldInput =
    event.type === "delay-elapsed" ? "elapsed" : event.active ? "on" : "off";
  const next = NEXT[state.status][input];
  return next === state.status ? state : STATES[next];
}
