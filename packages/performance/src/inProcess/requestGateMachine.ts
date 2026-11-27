export type RequestGateState =
  | { readonly status: "pending" }
  | { readonly status: "held" }
  | { readonly status: "done" };

export type RequestGateEvent =
  | { readonly type: "match" }
  | { readonly type: "release" }
  | { readonly type: "cancel" };

export type RequestGateEffect = "notify-arrived" | "resolve-release";

export interface RequestGateTransition {
  readonly state: RequestGateState;
  readonly effects: readonly RequestGateEffect[];
}

export const initialRequestGateState: RequestGateState = { status: "pending" };

/**
 * Pure state-machine transition for one one-shot HTTP proxy request gate:
 * `pending` -> `held` -> `done`, or `pending` -> `done` on early release/cancel.
 */
export function transitionRequestGate(
  state: RequestGateState,
  event: RequestGateEvent,
): RequestGateTransition {
  switch (state.status) {
    case "pending":
      if (event.type === "match") {
        return { state: { status: "held" }, effects: ["notify-arrived"] };
      }
      return { state: { status: "done" }, effects: ["resolve-release"] };
    case "held":
      if (event.type === "release" || event.type === "cancel") {
        return { state: { status: "done" }, effects: ["resolve-release"] };
      }
      return { state, effects: [] };
    case "done":
      return { state, effects: [] };
  }
}
