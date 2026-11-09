import {
  isSameOrganizationReadModelScope,
  type OrganizationReadModelScope,
} from "./organizationReadModelScope";

/**
 * One organization's reconciliation pass owner.
 *
 * | state    | requested                 | iterationStarted | readStarted (same iteration) | scopeOvertaken (same iteration) |
 * | -------- | ------------------------- | ---------------- | ---------------------------- | ------------------------------- |
 * | queued   | merge flags; adopt scope  | checking (1)     | ignored                      | ignored                         |
 * | checking | merge flags               | checking (n + 1) | reading                      | owe a follow-up if scope exists |
 * | reading  | merge flags               | checking (n + 1) | ignored                      | owe a follow-up if scope exists |
 *
 * `demanded` owes an unconditional follow-up; `requiresSdkBarrier` makes the
 * next read wait behind SDK reconciliation already in flight. Entering
 * `checking` consumes the demand bit into `owesRead`; entering `reading`
 * consumes the barrier into `useSdkBarrier`. Completions of async work carry
 * the iteration that started them, so a stale completion cannot move a newer
 * iteration.
 */
export type ReconciliationPassState =
  | {
      readonly status: "queued";
      readonly demanded: boolean;
      readonly requiresSdkBarrier: boolean;
      readonly scope: OrganizationReadModelScope;
    }
  | {
      readonly status: "checking";
      readonly demanded: boolean;
      readonly iteration: number;
      readonly owesRead: boolean;
      readonly requiresSdkBarrier: boolean;
      readonly scope: OrganizationReadModelScope;
    }
  | {
      readonly status: "reading";
      readonly demanded: boolean;
      readonly iteration: number;
      readonly requiresSdkBarrier: boolean;
      readonly scope: OrganizationReadModelScope;
      readonly useSdkBarrier: boolean;
    };

export type ReconciliationPassEvent =
  | {
      readonly type: "requested";
      readonly demanded: boolean;
      readonly requiresSdkBarrier: boolean;
      readonly scope: OrganizationReadModelScope;
    }
  | {
      readonly type: "iterationStarted";
      readonly scope: OrganizationReadModelScope;
    }
  | { readonly type: "readStarted"; readonly iteration: number }
  | {
      readonly type: "scopeOvertaken";
      readonly currentScopeExists: boolean;
      readonly iteration: number;
    };

export function initialReconciliationPass(request: {
  readonly demanded: boolean;
  readonly requiresSdkBarrier: boolean;
  readonly scope: OrganizationReadModelScope;
}): ReconciliationPassState {
  return { status: "queued", ...request };
}

export function transitionReconciliationPass(
  state: ReconciliationPassState,
  event: ReconciliationPassEvent,
): ReconciliationPassState {
  switch (event.type) {
    case "requested":
      return {
        ...state,
        demanded: state.demanded || event.demanded,
        requiresSdkBarrier:
          state.requiresSdkBarrier || event.requiresSdkBarrier,
        // Only a pass that has not begun adopts the newly requested scope;
        // a running pass's scope is checked again after its I/O.
        ...(state.status === "queued" &&
        !isSameOrganizationReadModelScope(state.scope, event.scope)
          ? { scope: event.scope }
          : {}),
      };
    case "iterationStarted":
      return {
        status: "checking",
        demanded: false,
        iteration: state.status === "queued" ? 1 : state.iteration + 1,
        owesRead: state.demanded,
        requiresSdkBarrier: state.requiresSdkBarrier,
        scope: event.scope,
      };
    case "readStarted":
      if (state.status !== "checking" || state.iteration !== event.iteration) {
        return state;
      }
      return {
        status: "reading",
        demanded: state.demanded,
        iteration: state.iteration,
        requiresSdkBarrier: false,
        scope: state.scope,
        useSdkBarrier: state.requiresSdkBarrier,
      };
    case "scopeOvertaken":
      if (state.status === "queued" || state.iteration !== event.iteration) {
        return state;
      }
      return {
        ...state,
        demanded: state.demanded || event.currentScopeExists,
      };
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}
