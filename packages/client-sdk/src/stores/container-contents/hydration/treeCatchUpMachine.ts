/**
 * Whether the tree crawl an acknowledged connection owes has vouched for the
 * document lanes it was not served.
 *
 * After an acknowledged connection the container store lists the root lane
 * and every known folder's child lane. A row it is served owes that
 * container's document lane a listing; a lane whose row it was not served
 * did not move. That holds only for a crawl that listed every lane it queued,
 * so the catch-up that lists document lanes asks here first.
 *
 * | State | Event | Next |
 * | --- | --- | --- |
 * | any | owed (an acknowledged connection) | owed |
 * | owed | settled, complete | complete |
 * | owed | settled, incomplete | incomplete |
 * | incomplete | settled, complete (a retry succeeded) | complete |
 * | complete, none | settled | unchanged |
 *
 * `complete` vouches for the lanes not served. `none` (no acknowledged
 * connection yet, or a host with no such crawl) and `incomplete` do not: the
 * catch-up then lists every known lane, as it did before lanes were owed.
 */
export type TreeCatchUpState =
  | { readonly status: "none" }
  | { readonly status: "owed" }
  | { readonly status: "complete" }
  | { readonly status: "incomplete" };

export type TreeCatchUpEvent =
  | { readonly type: "owed" }
  | { readonly complete: boolean; readonly type: "settled" };

export const NO_TREE_CATCH_UP: TreeCatchUpState = { status: "none" };

export function transitionTreeCatchUp(
  state: TreeCatchUpState,
  event: TreeCatchUpEvent,
): TreeCatchUpState {
  if (event.type === "owed") return { status: "owed" };
  if (state.status === "owed") {
    return { status: event.complete ? "complete" : "incomplete" };
  }
  if (state.status === "incomplete" && event.complete) {
    return { status: "complete" };
  }
  return state;
}
