/**
 * Stripe's two checkout frames loading toward one usable form. Each frame
 * loads on its own: the form is ready once both have rendered, and failed as
 * soon as either cannot load. Ready and failed are final.
 *
 * | status  | element-ready                         | element-failed |
 * | ------- | ------------------------------------- | -------------- |
 * | loading | loading, or ready once none is pending | failed         |
 * | ready   | -                                     | -              |
 * | failed  | -                                     | -              |
 */
export type StripeFormElement = "contactDetails" | "payment";

export type StripeFormLoadState =
  | {
      readonly status: "loading";
      readonly pending: readonly StripeFormElement[];
    }
  | { readonly status: "ready" }
  | { readonly status: "failed" };

export type StripeFormLoadEvent =
  | { readonly type: "element-ready"; readonly element: StripeFormElement }
  | { readonly type: "element-failed"; readonly error: unknown };

export const INITIAL_STRIPE_FORM_LOAD: StripeFormLoadState = {
  status: "loading",
  pending: ["contactDetails", "payment"],
};

const READY: StripeFormLoadState = { status: "ready" };
const FAILED: StripeFormLoadState = { status: "failed" };

/** Returns `state` itself when the event changes nothing. */
export function transitionStripeFormLoad(
  state: StripeFormLoadState,
  event: StripeFormLoadEvent,
): StripeFormLoadState {
  if (state.status !== "loading") {
    return state;
  }
  switch (event.type) {
    case "element-ready": {
      const pending = state.pending.filter(
        (element) => element !== event.element,
      );
      if (pending.length === state.pending.length) {
        return state;
      }
      return pending.length === 0 ? READY : { status: "loading", pending };
    }
    case "element-failed":
      return FAILED;
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Stripe form load event: ${JSON.stringify(value)}`);
}
