/**
 * Whether one public history attempt may name a held head state, and whether
 * it did. `disabled`: replays and fallback reads distrust local copies.
 * `eligible`: a held copy may be looked up. `heldSent`: the request named one,
 * so a verification failure is retried once with the served state.
 */
export type HeldHeadState =
  | { readonly status: "disabled" }
  | { readonly status: "eligible" }
  | { readonly status: "heldSent" };

export type HeldHeadEvent =
  | { readonly type: "heldLoaded" }
  | { readonly type: "heldMissing" };

export function initialHeldHeadState(allowed: boolean): HeldHeadState {
  return allowed ? { status: "eligible" } : { status: "disabled" };
}

/** Only an eligible attempt moves; every other state ignores both events. */
export function transitionHeldHeadState(
  state: HeldHeadState,
  event: HeldHeadEvent,
): HeldHeadState {
  switch (state.status) {
    case "eligible":
      switch (event.type) {
        case "heldLoaded":
          return { status: "heldSent" };
        case "heldMissing":
          return state;
        default:
          return assertNever(event);
      }
    case "disabled":
    case "heldSent":
      return state;
    default:
      return assertNever(state);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected held head state input: ${JSON.stringify(value)}`);
}
