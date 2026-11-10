import type { StripeSyncOptionResponse } from "@tearleads/validators/response";

/**
 * The inline checkout's offer (`billing/useDirectCheckout.ts`): every plan
 * that covers the roster. Subscribe can open a form only from `ready`: while a
 * load is in flight, including the reload after a Pay whose plan is no longer
 * offered, there is no offer, so the buyer cannot open a form for a plan that
 * is being replaced.
 *
 * | state   | off | load    | loaded | load-failed |
 * | ------- | --- | ------- | ------ | ----------- |
 * | off     | -   | loading | -      | -           |
 * | loading | off | -       | ready  | failed      |
 * | ready   | off | loading | -      | -           |
 * | failed  | off | loading | -      | -           |
 *
 * `-` returns the same state. The hook drops a superseded load's result
 * before it becomes an event.
 */
export type CheckoutOptionState =
  | { readonly status: "off" }
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      /** Smallest first; empty when the server integration is not configured. */
      readonly options: readonly StripeSyncOptionResponse[];
    }
  | { readonly status: "failed"; readonly error: string };

export type CheckoutOptionEvent =
  /** The platform cannot buy here, or the panel is not offering checkout. */
  | { readonly type: "off" }
  | { readonly type: "load" }
  | {
      readonly type: "loaded";
      readonly options: readonly StripeSyncOptionResponse[];
    }
  | { readonly type: "load-failed"; readonly error: string };

export const CHECKOUT_OPTION_OFF: CheckoutOptionState = { status: "off" };
const LOADING: CheckoutOptionState = { status: "loading" };

export function transitionCheckoutOption(
  state: CheckoutOptionState,
  event: CheckoutOptionEvent,
): CheckoutOptionState {
  switch (event.type) {
    case "off":
      return state.status === "off" ? state : CHECKOUT_OPTION_OFF;
    case "load":
      return state.status === "loading" ? state : LOADING;
    case "loaded":
      return state.status === "loading"
        ? { status: "ready", options: event.options }
        : state;
    case "load-failed":
      return state.status === "loading"
        ? { status: "failed", error: event.error }
        : state;
  }
}
