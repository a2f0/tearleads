import {
  type ConnectAttemptWaitTransition,
  NO_CONNECT_ATTEMPT_WAIT,
  transitionConnectAttemptWait,
} from "../../workflows/shared/connectAttemptWaitMachine";

/**
 * Decides when a start lists the document lanes an earlier boot left owed
 * ([owed document lanes](../../../../../docs/developer/device-first.md#owed-document-lanes)).
 * The catch-up after an acknowledged connection lists every owed lane, so a
 * start whose connect attempt is still pending waits for that
 * acknowledgement instead of listing owed lanes in both. A start with no
 * attempt pending (offline, realtime unavailable, between retries), or whose
 * attempt ends without an acknowledgement, resumes the owed lanes itself.
 * Whether it waits is decided by `connectAttemptWaitMachine.ts`, as for the
 * other work an acknowledgement does; a resume handed to the catch-up is
 * done, since that catch-up's own record survives a lost connection.
 *
 * | State | Event | Next | Resume |
 * | --- | --- | --- | --- |
 * | awaiting-hydration | hydrated, acknowledgement latched | done | no |
 * | awaiting-hydration | hydrated, attempt pending | awaiting-acknowledgement | no |
 * | awaiting-hydration | hydrated, no attempt pending | done | yes |
 * | awaiting-acknowledgement | runtime, the same attempt pending | unchanged | no |
 * | awaiting-acknowledgement | runtime, attempt settled, acknowledged | done | no |
 * | awaiting-acknowledgement | runtime, attempt ended or replaced | done | yes |
 * | any | reset | awaiting-hydration | no |
 *
 * Other events leave the state unchanged. That is the whole guarantee: a
 * connection that starts or is acknowledged after the resume ran is a new
 * catch-up, which lists the lanes still owed and the ones its crawl is served.
 */
export type OwedDiscoveryResumeState =
  | { readonly status: "awaiting-hydration" }
  | { readonly status: "awaiting-acknowledgement"; readonly attempt: number }
  | { readonly status: "done" };

interface ConnectionObservation {
  /** The connection generation advanced, or its catch-up is latched. */
  readonly acknowledged: boolean;
  readonly pendingConnectAttempt: number | undefined;
}

export type OwedDiscoveryResumeEvent =
  | ({ readonly type: "hydrated" } & ConnectionObservation)
  | ({ readonly type: "runtime" } & ConnectionObservation)
  | { readonly type: "reset" };

export const INITIAL_OWED_DISCOVERY_RESUME: OwedDiscoveryResumeState = {
  status: "awaiting-hydration",
};

const DONE: OwedDiscoveryResumeState = { status: "done" };
/** What a waiting resume waits to do: list the owed lanes. */
const RESUME = "resume" as const;

function afterWait(next: ConnectAttemptWaitTransition<typeof RESUME>): {
  readonly resume: boolean;
  readonly state: OwedDiscoveryResumeState;
} {
  if (next.state.status === "waiting") {
    return {
      resume: false,
      state: {
        attempt: next.state.attempt,
        status: "awaiting-acknowledgement",
      },
    };
  }
  return { resume: next.released !== undefined, state: DONE };
}

export function transitionOwedDiscoveryResume(
  state: OwedDiscoveryResumeState,
  event: OwedDiscoveryResumeEvent,
): { readonly resume: boolean; readonly state: OwedDiscoveryResumeState } {
  if (event.type === "reset") {
    return { resume: false, state: INITIAL_OWED_DISCOVERY_RESUME };
  }
  if (event.type === "hydrated") {
    if (state.status !== "awaiting-hydration") return { resume: false, state };
    if (event.acknowledged) return { resume: false, state: DONE };
    return afterWait(
      transitionConnectAttemptWait(NO_CONNECT_ATTEMPT_WAIT, {
        pendingConnectAttempt: event.pendingConnectAttempt,
        request: RESUME,
        type: "hold",
      }),
    );
  }
  if (state.status !== "awaiting-acknowledgement") {
    return { resume: false, state };
  }
  return afterWait(
    transitionConnectAttemptWait(
      { attempt: state.attempt, request: RESUME, status: "waiting" },
      {
        acknowledged: event.acknowledged,
        pendingConnectAttempt: event.pendingConnectAttempt,
        type: "observe",
      },
    ),
  );
}

/**
 * Applies one event to the holder's state, latching the resume for the
 * holder to raise once its tree is published.
 */
export function stepOwedDiscoveryResume(
  holder: {
    owedDiscoveryResume: OwedDiscoveryResumeState;
    pendingOwedDiscovery: boolean;
  },
  event: OwedDiscoveryResumeEvent,
): void {
  const next = transitionOwedDiscoveryResume(holder.owedDiscoveryResume, event);
  holder.owedDiscoveryResume = next.state;
  if (next.resume) holder.pendingOwedDiscovery = true;
}
