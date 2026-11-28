/**
 * Periodic catch-up scheduler for sessions that stay online and authenticated
 * without an acknowledged realtime connection.
 *
 * A start whose connection is never acknowledged runs one catch-up sweep
 * immediately via `owed-discovery`. While realtime remains unacknowledged,
 * this machine schedules bounded watermarked catch-up sweeps so peer writes
 * made after startup still reach settled lanes (including across flapping
 * reconnect attempts that never acknowledge). Whenever realtime connects,
 * prerequisites drop, or the service stops, any pending timer is cancelled
 * immediately so a healthy realtime session schedules zero timers and sends
 * zero polling requests.
 *
 * | State | Event | Next | Effect |
 * | --- | --- | --- | --- |
 * | stopped | start (eligible) | scheduled | schedule |
 * | stopped | start (!eligible) | idle | none |
 * | idle | evaluate (eligible) | scheduled | schedule |
 * | idle | sweep-started | running | none |
 * | idle | stop | stopped | none |
 * | scheduled | evaluate (!eligible) | idle | cancel |
 * | scheduled | sweep-started | running | cancel |
 * | scheduled | timer-fired (eligible) | running | run |
 * | scheduled | timer-fired (!eligible) | idle | none |
 * | scheduled | stop | stopped | cancel |
 * | running | sweep-settled (same run, eligible) | scheduled | schedule |
 * | running | sweep-settled (same run, !eligible) | idle | none |
 * | running | sweep-started (newer run) | running (new) | none |
 * | running | stop | stopped | none |
 */
export type UnacknowledgedCatchUpState =
  | { readonly status: "stopped" }
  | { readonly status: "idle" }
  | { readonly status: "scheduled" }
  | { readonly status: "running"; readonly run: object };

export type UnacknowledgedCatchUpEvent =
  | { readonly type: "start"; readonly eligible: boolean }
  | { readonly type: "evaluate"; readonly eligible: boolean }
  | { readonly type: "sweep-started"; readonly run: object }
  | {
      readonly type: "timer-fired";
      readonly eligible: boolean;
      readonly run: object;
    }
  | {
      readonly type: "sweep-settled";
      readonly eligible: boolean;
      readonly run: object;
    }
  | { readonly type: "stop" };

export type UnacknowledgedCatchUpEffect =
  | "none"
  | "schedule"
  | "cancel"
  | "run";

export interface UnacknowledgedCatchUpTransition {
  readonly state: UnacknowledgedCatchUpState;
  readonly effect: UnacknowledgedCatchUpEffect;
}

/** Default interval between periodic HTTP catch-ups while unacknowledged. */
export const DEFAULT_UNACKNOWLEDGED_CATCH_UP_INTERVAL_MS = 60_000;

export const STOPPED_UNACKNOWLEDGED_CATCH_UP: UnacknowledgedCatchUpState = {
  status: "stopped",
};

const IDLE_STATE: UnacknowledgedCatchUpState = { status: "idle" };
const SCHEDULED_STATE: UnacknowledgedCatchUpState = { status: "scheduled" };

function scheduleOrIdle(eligible: boolean): UnacknowledgedCatchUpTransition {
  return eligible
    ? { effect: "schedule", state: SCHEDULED_STATE }
    : { effect: "none", state: IDLE_STATE };
}

function transitionIdle(
  state: UnacknowledgedCatchUpState,
  event: UnacknowledgedCatchUpEvent,
): UnacknowledgedCatchUpTransition {
  if (event.type === "evaluate") return scheduleOrIdle(event.eligible);
  if (event.type === "sweep-started") {
    return { effect: "none", state: { run: event.run, status: "running" } };
  }
  return { effect: "none", state };
}

function transitionScheduled(
  state: UnacknowledgedCatchUpState,
  event: UnacknowledgedCatchUpEvent,
): UnacknowledgedCatchUpTransition {
  if (event.type === "evaluate") {
    return event.eligible
      ? { effect: "none", state }
      : { effect: "cancel", state: IDLE_STATE };
  }
  if (event.type === "sweep-started") {
    return { effect: "cancel", state: { run: event.run, status: "running" } };
  }
  if (event.type === "timer-fired") {
    return event.eligible
      ? { effect: "run", state: { run: event.run, status: "running" } }
      : { effect: "none", state: IDLE_STATE };
  }
  return { effect: "none", state };
}

function transitionRunning(
  state: Extract<UnacknowledgedCatchUpState, { readonly status: "running" }>,
  event: UnacknowledgedCatchUpEvent,
): UnacknowledgedCatchUpTransition {
  if (event.type === "sweep-started") {
    return { effect: "none", state: { run: event.run, status: "running" } };
  }
  if (event.type === "sweep-settled" && state.run === event.run) {
    return scheduleOrIdle(event.eligible);
  }
  return { effect: "none", state };
}

export function transitionUnacknowledgedCatchUp(
  state: UnacknowledgedCatchUpState,
  event: UnacknowledgedCatchUpEvent,
): UnacknowledgedCatchUpTransition {
  if (event.type === "stop") {
    return {
      effect: state.status === "scheduled" ? "cancel" : "none",
      state: STOPPED_UNACKNOWLEDGED_CATCH_UP,
    };
  }
  switch (state.status) {
    case "stopped":
      return event.type === "start"
        ? scheduleOrIdle(event.eligible)
        : { effect: "none", state };
    case "idle":
      return transitionIdle(state, event);
    case "scheduled":
      return transitionScheduled(state, event);
    case "running":
      return transitionRunning(state, event);
  }
}
