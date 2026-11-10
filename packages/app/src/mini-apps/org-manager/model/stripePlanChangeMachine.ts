import type {
  StripePlanChange,
  StripeSyncOptionResponse,
} from "@tearleads/validators/response";

/**
 * Changing an active Stripe subscription's plan
 * (`model/useStripePlanChange.ts`). Every change is confirmed first, because
 * an upgrade charges the card at once; only one change runs at a time.
 *
 * | state      | choose     | dismiss | confirm  | changed | failed |
 * | ---------- | ---------- | ------- | -------- | ------- | ------ |
 * | idle       | confirming | -       | -        | -       | -      |
 * | confirming | confirming | idle    | changing | -       | -      |
 * | changing   | -          | -       | -        | idle    | idle   |
 *
 * `-` returns the same state. `idle` keeps the last outcome to show it.
 */

/** What choosing the plan does: charge now, schedule, or keep the plan. */
export type StripePlanDirection = "downgrade" | "keep" | "upgrade";

export type StripePlanChangeOutcome =
  | { readonly kind: "changed"; readonly change: StripePlanChange }
  | { readonly kind: "failed"; readonly error: string };

interface StripePlanChoice {
  readonly direction: StripePlanDirection;
  readonly option: StripeSyncOptionResponse;
}

export type StripePlanChangeState =
  | {
      readonly kind: "idle";
      readonly outcome: StripePlanChangeOutcome | null;
    }
  | ({ readonly kind: "confirming" } & StripePlanChoice)
  | ({ readonly kind: "changing" } & StripePlanChoice);

export type StripePlanChangeEvent =
  | ({ readonly type: "choose" } & StripePlanChoice)
  | { readonly type: "dismiss" }
  | { readonly type: "confirm" }
  | { readonly type: "changed"; readonly change: StripePlanChange }
  | { readonly type: "failed"; readonly error: string };

export const IDLE_STRIPE_PLAN_CHANGE: StripePlanChangeState = {
  kind: "idle",
  outcome: null,
};

export function transitionStripePlanChange(
  state: StripePlanChangeState,
  event: StripePlanChangeEvent,
): StripePlanChangeState {
  switch (event.type) {
    case "choose":
      return state.kind === "changing"
        ? state
        : {
            kind: "confirming",
            direction: event.direction,
            option: event.option,
          };
    case "dismiss":
      return state.kind === "confirming" ? IDLE_STRIPE_PLAN_CHANGE : state;
    case "confirm":
      return state.kind === "confirming"
        ? { ...state, kind: "changing" }
        : state;
    case "changed":
      return state.kind === "changing"
        ? { kind: "idle", outcome: { kind: "changed", change: event.change } }
        : state;
    case "failed":
      return state.kind === "changing"
        ? { kind: "idle", outcome: { kind: "failed", error: event.error } }
        : state;
  }
}

/** What choosing `option` does to a subscription at `seatCount`. */
export function stripePlanDirection(
  option: StripeSyncOptionResponse,
  seatCount: number,
): StripePlanDirection {
  if (option.seatLimit > seatCount) return "upgrade";
  return option.seatLimit < seatCount ? "downgrade" : "keep";
}
