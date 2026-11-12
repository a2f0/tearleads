export type InterruptPolicy = "terraform-state" | "bounded-command";

// Never configurable from the reset's environment or CLI. Terraform's first
// interrupt stops operations and persists state; a second can abort that work.
export const interruptPolicies = {
  "terraform-state": { signal: "SIGINT", graceMs: 60_000 },
  "bounded-command": { signal: "SIGTERM", graceMs: 1000 },
} as const;

type StopReason = "interrupted" | "descendants";
export type ProcessState =
  | { status: "running" }
  | { status: "observing"; deadline: number }
  | { status: "draining"; reason: StopReason; deadline: number }
  | { status: "forcing"; reason: StopReason; deadline: number }
  | { status: "settled"; reason: StopReason | "natural" };

export type ProcessEvent =
  | { type: "interrupt"; now: number }
  | {
      type: "observe";
      now: number;
      leaderClosed: boolean;
      groupAlive: boolean;
    };

function startDraining(
  state: ProcessState,
  reason: StopReason,
  now: number,
  policy: InterruptPolicy,
): ProcessState {
  return state.status === "running" || state.status === "observing"
    ? {
        status: "draining",
        reason,
        deadline: now + interruptPolicies[policy].graceMs,
      }
    : state;
}

// Wrapper exit starts one no-signal observation window, not success. Once
// cleanup begins its reason and deadline survive every later event. The run's
// first operator signal/exit code is independent of this per-command machine.
export function transitionProcess(
  state: ProcessState,
  event: ProcessEvent,
  policy: InterruptPolicy,
): ProcessState {
  if (event.type === "interrupt") {
    return startDraining(state, "interrupted", event.now, policy);
  }
  if (state.status === "settled") return state;
  if (event.leaderClosed && !event.groupAlive)
    return {
      status: "settled",
      reason: "reason" in state ? state.reason : "natural",
    };
  switch (state.status) {
    case "running":
      return event.leaderClosed
        ? { status: "observing", deadline: event.now + 1000 }
        : state;
    case "observing":
      return event.now >= state.deadline
        ? startDraining(state, "descendants", event.now, policy)
        : state;
    case "draining":
      return event.now >= state.deadline
        ? {
            status: "forcing",
            reason: state.reason,
            deadline: event.now + 1000,
          }
        : state;
    case "forcing":
      return event.now >= state.deadline
        ? { status: "settled", reason: state.reason }
        : state;
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}
