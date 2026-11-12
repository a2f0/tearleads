export type InterruptPolicy = "terraform-state" | "bounded-command";

// Never configurable from the reset's environment or CLI. Terraform's first
// interrupt stops operations and persists state; a second can abort that work.
export const interruptPolicies = {
  "terraform-state": { signal: "SIGINT", graceMs: 60_000 },
  "bounded-command": { signal: "SIGTERM", graceMs: 1000 },
} as const;

export type ProcessState =
  | { status: "running" }
  | { status: "draining"; deadline: number }
  | { status: "forcing"; deadline: number }
  | { status: "settled" };

export type ProcessEvent =
  | { type: "interrupt"; now: number }
  | {
      type: "observe";
      now: number;
      leaderClosed: boolean;
      groupAlive: boolean;
    };

// The command result and run-level first signal/timings are independent of this
// per-process cancellation lifecycle. Wrapper exit is not group completion.
export function transitionProcess(
  state: ProcessState,
  event: ProcessEvent,
  policy: InterruptPolicy,
): ProcessState {
  if (event.type === "interrupt") {
    return state.status === "running"
      ? {
          status: "draining",
          deadline: event.now + interruptPolicies[policy].graceMs,
        }
      : state;
  }
  if (state.status === "settled") return state;
  if (event.leaderClosed && !event.groupAlive) return { status: "settled" };
  switch (state.status) {
    case "running":
      return state;
    case "draining":
      return event.now >= state.deadline
        ? { status: "forcing", deadline: event.now + 1000 }
        : state;
    case "forcing":
      return event.now >= state.deadline ? { status: "settled" } : state;
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}
