/**
 * Decides when a start lists the document lanes an earlier boot left owed
 * ([owed document lanes](../../../../../docs/developer/device-first.md#owed-document-lanes)).
 * The catch-up after an acknowledged connection lists every known lane, owed
 * ones included, so a start whose connect attempt is still pending waits for
 * that acknowledgement instead of listing an owed lane twice. A start with no
 * attempt pending (offline, realtime unavailable, between retries), or whose
 * attempt ends without an acknowledgement, resumes the owed lanes itself.
 *
 * | State | Event | Next | Resume |
 * | --- | --- | --- | --- |
 * | awaiting-hydration | hydrated, acknowledgement latched | done | no |
 * | awaiting-hydration | hydrated, attempt pending | awaiting-acknowledgement | no |
 * | awaiting-hydration | hydrated, no attempt pending | done | yes |
 * | awaiting-acknowledgement | runtime, acknowledged | done | no |
 * | awaiting-acknowledgement | runtime, the same attempt pending | unchanged | no |
 * | awaiting-acknowledgement | runtime, attempt ended or replaced | done | yes |
 * | any | reset | awaiting-hydration | no |
 *
 * Other events leave the state unchanged. A connection acknowledged after
 * the resume ran is a new catch-up and lists every lane, as any does.
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
    if (event.pendingConnectAttempt !== undefined) {
      return {
        resume: false,
        state: {
          attempt: event.pendingConnectAttempt,
          status: "awaiting-acknowledgement",
        },
      };
    }
    return { resume: true, state: DONE };
  }
  if (state.status !== "awaiting-acknowledgement") {
    return { resume: false, state };
  }
  if (event.acknowledged) return { resume: false, state: DONE };
  if (event.pendingConnectAttempt === state.attempt) {
    return { resume: false, state };
  }
  return { resume: true, state: DONE };
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
