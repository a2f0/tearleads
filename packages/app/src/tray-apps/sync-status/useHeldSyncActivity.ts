import { useEffect, useState } from "react";
import {
  IDLE_SYNC_ACTIVITY_HOLD,
  showsSyncActivity,
  transitionSyncActivityHold,
} from "./syncActivityHoldMachine";

export interface SyncActivityDelays {
  /** A run shorter than this never shows, so a realtime nudge does not blink. */
  readonly enterMs: number;
  /** Runs that follow each other within this gap read as one stretch. */
  readonly exitMs: number;
}

const SYNC_ACTIVITY_DELAYS: SyncActivityDelays = {
  enterMs: 1000,
  exitMs: 1500,
};

/**
 * Whether sync work is running, held (see `syncActivityHoldMachine`) so the
 * tray shows sustained activity, such as a first sign-in pulling content,
 * without flickering on every short lane run.
 */
export function useHeldSyncActivity(
  active: boolean,
  delays: SyncActivityDelays = SYNC_ACTIVITY_DELAYS,
): boolean {
  const [state, setState] = useState(IDLE_SYNC_ACTIVITY_HOLD);
  const { enterMs, exitMs } = delays;

  useEffect(() => {
    setState((current) =>
      transitionSyncActivityHold(current, { active, type: "activity-changed" }),
    );
  }, [active]);

  useEffect(() => {
    if (state.status !== "entering" && state.status !== "leaving") return;
    const timer = setTimeout(
      () =>
        setState((current) =>
          transitionSyncActivityHold(current, { type: "delay-elapsed" }),
        ),
      state.status === "entering" ? enterMs : exitMs,
    );
    return () => clearTimeout(timer);
  }, [enterMs, exitMs, state]);

  return showsSyncActivity(state);
}
