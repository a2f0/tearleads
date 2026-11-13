import type { ChildProcess } from "node:child_process";
import {
  type InterruptPolicy,
  interruptPolicies,
  type ProcessEvent,
  type ProcessState,
  transitionProcess,
} from "./softResetProcessState";

interface Clock {
  now(): number;
  every(callback: () => void): () => void;
}
const clock: Clock = {
  now: () => performance.now(),
  every(callback) {
    const timer = setInterval(callback, 50);
    return () => clearInterval(timer);
  },
};
function groupAlive(pid: number | undefined) {
  if (pid === undefined) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    // Permission errors are not proof of exit.
    return !(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}
function killGroup(pid: number | undefined, signal: NodeJS.Signals) {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // Absence is checked separately; a failed signal must not shorten grace.
  }
}

// Only tests inject a clock/scheduler. ResetRun always uses the production
// clock and the fixed policy; neither environment nor CLI can shorten it.
export function superviseCommand(
  child: ChildProcess,
  policy: InterruptPolicy,
  scheduler: Clock = clock,
) {
  let state: ProcessState = { status: "running" };
  let outcome: { code: number | null } | { error: Error } | undefined;
  const {
    promise: completed,
    resolve,
    reject,
  } = Promise.withResolvers<number | null>();
  const observe = () =>
    send({
      type: "observe",
      now: scheduler.now(),
      leaderClosed: outcome !== undefined,
      groupAlive: groupAlive(child.pid),
    });
  const stopTimer = scheduler.every(observe);
  function finish(next: Extract<ProcessState, { status: "settled" }>) {
    stopTimer();
    child.unref();
    if (groupAlive(child.pid))
      console.error(
        "Process group remains after teardown; inspect descendants manually.",
      );
    if (outcome && "error" in outcome) reject(outcome.error);
    else if (next.reason === "descendants")
      reject(
        new Error(
          "Command left live descendants after its leader exited; automatic cleanup required. Inspect private command logs; manual recovery required.",
        ),
      );
    else resolve(outcome?.code ?? null);
  }
  function send(event: ProcessEvent) {
    const next = transitionProcess(state, event, policy);
    if (next === state) return;
    state = next;
    switch (next.status) {
      case "observing":
        console.error(
          "Command leader exited with live descendants; observing the owned group for 1s before cleanup.",
        );
        break;
      case "draining":
        console.error(
          `${next.reason === "descendants" ? "Natural-exit descendant cleanup (command failed)" : "Cancellation"}: ${policy}; allowing ${interruptPolicies[policy].graceMs / 1000}s for the process group to stop. Repeated signals are ignored.`,
        );
        killGroup(child.pid, interruptPolicies[policy].signal);
        break;
      case "forcing":
        console.error(
          "Process group grace expired; forcing process group termination. State may be incomplete and a backend lock may remain; manual recovery required.",
        );
        killGroup(child.pid, "SIGKILL");
        break;
      case "settled":
        finish(next);
        break;
      case "running":
        break;
    }
  }
  child.once("error", () => {
    outcome = { error: new Error("Could not start required command.") };
    observe();
  });
  child.once("close", (code) => {
    outcome ??= { code };
    observe();
  });
  return {
    completed,
    interrupt: () => send({ type: "interrupt", now: scheduler.now() }),
  };
}
