export type SuspensionChange = "lift" | "suspend";

/**
 * Suspend and lift on identity detail. A suspension asks first (confirming)
 * and keeps its dialog open while it runs; a lift starts at once. The last
 * failure stays shown until the next change starts.
 */
export type IdentitySuspensionState =
  | { readonly status: "idle"; readonly error: string | null }
  | { readonly status: "confirming"; readonly error: string | null }
  | {
      readonly status: "running";
      readonly change: SuspensionChange;
      readonly request: symbol;
    };

export type IdentitySuspensionEvent =
  | { readonly type: "ask-to-suspend" }
  | { readonly type: "cancel" }
  | {
      readonly type: "start";
      readonly change: SuspensionChange;
      readonly request: symbol;
    }
  | {
      readonly type: "settle";
      readonly request: symbol;
      readonly error: string | null;
    };

export const IDLE_SUSPENSION: IdentitySuspensionState = {
  error: null,
  status: "idle",
};

/** A suspension starts from its confirmation, a lift from rest. */
const STARTS_FROM: Record<SuspensionChange, IdentitySuspensionState["status"]> =
  {
    lift: "idle",
    suspend: "confirming",
  };

/**
 * Every event not listed for a state is ignored there: nothing starts while a
 * change runs, and only the change still running may settle.
 */
export function transitionIdentitySuspension(
  state: IdentitySuspensionState,
  event: IdentitySuspensionEvent,
): IdentitySuspensionState {
  switch (event.type) {
    case "ask-to-suspend":
      return state.status === "idle"
        ? { error: state.error, status: "confirming" }
        : state;
    case "cancel":
      return state.status === "confirming"
        ? { error: state.error, status: "idle" }
        : state;
    case "start":
      return state.status === STARTS_FROM[event.change]
        ? { change: event.change, request: event.request, status: "running" }
        : state;
    case "settle":
      return state.status === "running" && state.request === event.request
        ? { error: event.error, status: "idle" }
        : state;
    default:
      return event satisfies never;
  }
}
