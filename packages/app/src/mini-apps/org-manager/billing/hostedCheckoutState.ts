/**
 * The "Pay on Stripe" link's flow. One state at a time: a mint is in flight
 * (`opening`), or the last attempt came back without a URL (`unavailable`,
 * which shows a notice until the next click), or neither (`idle`).
 *
 * | state       | open    | opened | declined    |
 * | ----------- | ------- | ------ | ----------- |
 * | idle        | opening | -      | -           |
 * | opening     | -       | idle   | unavailable |
 * | unavailable | opening | -      | -           |
 *
 * `-` returns the same state, so a second click while a session is minting
 * starts nothing.
 */
export type HostedCheckoutState =
  | { readonly status: "idle" }
  | { readonly status: "opening" }
  | { readonly status: "unavailable" };

export type HostedCheckoutEvent =
  /** The buyer clicked the link. */
  | { readonly type: "open" }
  /** The minted URL was handed to the new tab (or this one). */
  | { readonly type: "opened" }
  /** No URL: unconfigured, not eligible, already checking out, or failed. */
  | { readonly type: "declined" };

export const IDLE_HOSTED_CHECKOUT: HostedCheckoutState = { status: "idle" };
const OPENING: HostedCheckoutState = { status: "opening" };
const UNAVAILABLE: HostedCheckoutState = { status: "unavailable" };

export function transitionHostedCheckout(
  state: HostedCheckoutState,
  event: HostedCheckoutEvent,
): HostedCheckoutState {
  switch (event.type) {
    case "open":
      return state.status === "opening" ? state : OPENING;
    case "opened":
      return state.status === "opening" ? IDLE_HOSTED_CHECKOUT : state;
    case "declined":
      return state.status === "opening" ? UNAVAILABLE : state;
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled hosted checkout event: ${JSON.stringify(value)}`);
}
