import type { DirectCheckoutSession } from "@tearleads/client-sdk";

/**
 * The Org Manager's inline card checkout (`billing/useDirectCheckout.ts`).
 * Each `begin` numbers an attempt; the attempt's continuations (mount, email
 * events, confirmation) name it, and only the current attempt may move the
 * flow. The mounted session lives only in the states that own it, so the hook
 * unmounts it on leaving them.
 *
 * | state      | begin    | email     | mounted    | start-failed | confirm    | confirm-failed | confirmed | teardown |
 * | ---------- | -------- | --------- | ---------- | ------------ | ---------- | -------------- | --------- | -------- |
 * | idle       | starting | -         | -          | -            | -          | -              | -         | idle     |
 * | starting   | -        | starting  | collecting | idle (error) | -          | -              | -         | idle     |
 * | collecting | -        | same      | -          | -            | confirming | -              | -         | idle     |
 * | confirming | -        | same      | -          | -            | -          | collecting     | idle      | idle     |
 *
 * `-` returns the same state, and so does any event naming another attempt.
 * `teardown` also clears an idle state's error.
 */
export type DirectCheckoutMachineState =
  | { readonly kind: "idle"; readonly error: string | null }
  | {
      readonly kind: "starting";
      readonly attempt: number;
      readonly emailComplete: boolean;
    }
  | {
      readonly kind: "collecting";
      readonly attempt: number;
      readonly emailComplete: boolean;
      readonly session: DirectCheckoutSession;
      readonly error: string | null;
    }
  | {
      readonly kind: "confirming";
      readonly attempt: number;
      readonly emailComplete: boolean;
      readonly session: DirectCheckoutSession;
    };

export type DirectCheckoutEvent =
  /** Subscribe: start a checkout on the server. */
  | { readonly type: "begin"; readonly attempt: number }
  /** The provider form's billing email became complete or incomplete. */
  | {
      readonly type: "email-changed";
      readonly attempt: number;
      readonly complete: boolean;
    }
  /** The payment element mounted into the panel's host. */
  | {
      readonly type: "mounted";
      readonly attempt: number;
      readonly session: DirectCheckoutSession;
    }
  /** No checkout intent, no host, or the start threw. */
  | {
      readonly type: "start-failed";
      readonly attempt: number;
      readonly error: string;
    }
  /** Pay. */
  | { readonly type: "confirm" }
  /** Declined or thrown; the element stays mounted for corrections. */
  | {
      readonly type: "confirm-failed";
      readonly attempt: number;
      readonly error: string;
    }
  /** Paid, or cancelled by the provider: the session is spent. */
  | { readonly type: "confirmed"; readonly attempt: number }
  /** Cancel, organization switch, disable, or unmount. */
  | { readonly type: "teardown" };

export const IDLE_DIRECT_CHECKOUT: DirectCheckoutMachineState = {
  kind: "idle",
  error: null,
};

type ActiveKind = Exclude<DirectCheckoutMachineState["kind"], "idle">;

function inAttempt<K extends ActiveKind>(
  state: DirectCheckoutMachineState,
  attempt: number,
  ...kinds: K[]
): state is Extract<DirectCheckoutMachineState, { kind: K }> {
  return (
    state.kind !== "idle" &&
    state.attempt === attempt &&
    kinds.some((kind) => kind === state.kind)
  );
}

export function transitionDirectCheckout(
  state: DirectCheckoutMachineState,
  event: DirectCheckoutEvent,
): DirectCheckoutMachineState {
  switch (event.type) {
    case "begin":
      return state.kind === "idle"
        ? { kind: "starting", attempt: event.attempt, emailComplete: false }
        : state;
    case "confirm":
      return state.kind === "collecting"
        ? {
            kind: "confirming",
            attempt: state.attempt,
            emailComplete: state.emailComplete,
            session: state.session,
          }
        : state;
    case "teardown":
      return state === IDLE_DIRECT_CHECKOUT ? state : IDLE_DIRECT_CHECKOUT;
    default:
      return transitionAttempt(state, event);
  }
}

/** Events an attempt's own continuations send; another attempt's are ignored. */
type AttemptEvent = Exclude<
  DirectCheckoutEvent,
  { readonly type: "begin" | "confirm" | "teardown" }
>;

function transitionAttempt(
  state: DirectCheckoutMachineState,
  event: AttemptEvent,
): DirectCheckoutMachineState {
  const { attempt } = event;
  switch (event.type) {
    case "email-changed":
      return inAttempt(
        state,
        attempt,
        "starting",
        "collecting",
        "confirming",
      ) && state.emailComplete !== event.complete
        ? { ...state, emailComplete: event.complete }
        : state;
    case "mounted":
      return inAttempt(state, attempt, "starting")
        ? { ...state, kind: "collecting", session: event.session, error: null }
        : state;
    case "start-failed":
      return inAttempt(state, attempt, "starting")
        ? { kind: "idle", error: event.error }
        : state;
    case "confirm-failed":
      return inAttempt(state, attempt, "confirming")
        ? { ...state, kind: "collecting", error: event.error }
        : state;
    case "confirmed":
      return inAttempt(state, attempt, "confirming")
        ? IDLE_DIRECT_CHECKOUT
        : state;
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled direct checkout event: ${JSON.stringify(value)}`);
}
