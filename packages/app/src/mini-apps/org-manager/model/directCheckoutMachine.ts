import type { DirectCheckoutSession } from "@tearleads/client-sdk";

/**
 * The plan an attempt's form shows. Pay starts the subscription at exactly
 * this `priceId`, so the charge is always the plan the buyer chose and saw.
 */
export interface DirectCheckoutPlan {
  readonly priceId: string;
  /** In the currency's minor unit. */
  readonly amount: number;
  readonly currency: string;
}

/**
 * The Org Manager's inline card checkout (`billing/useDirectCheckout.ts`).
 * Each `begin` numbers an attempt; the attempt's continuations (mount, form
 * and email events, confirmation) name it, and only the current attempt may
 * move the flow. The mounted session lives only in the states that own it, so
 * the hook unmounts it on leaving them. Nothing exists on the server until
 * `confirm`: the subscription starts at Pay, for the plan the state holds.
 *
 * | state          | begin    | email | form-ready | load-failed  | mounted    | start-failed | plan-changed | confirm        | confirm-failed | open-stripe        | stripe-opened | stripe-refused | plan-unavailable | confirmed | teardown |
 * | -------------- | -------- | ----- | ---------- | ------------ | ---------- | ------------ | ------------ | -------------- | -------------- | ------------------ | ------------- | -------------- | ---------------- | --------- | -------- |
 * | idle           | starting | -     | -          | -            | -          | -            | -            | -              | -              | -                  | -             | -              | -                | -         | idle     |
 * | starting       | -        | same  | same       | idle (error) | collecting | idle (error) | -            | -              | -              | -                  | -             | -              | -                | -         | idle     |
 * | collecting     | -        | same  | same       | idle (error) | -          | -            | collecting   | confirming (*) | -              | opening-stripe (*) | -             | -              | idle (error)     | -         | idle     |
 * | confirming     | -        | same  | -          | -            | -          | -            | -            | -              | collecting     | -                  | -             | -              | idle (error)     | idle      | idle     |
 * | opening-stripe | -        | same  | -          | -            | -          | -            | -            | -              | -              | -                  | idle          | collecting     | idle (error)     | -         | idle     |
 *
 * `-` returns the same state, and so does any event naming another attempt.
 * `same` updates the state's own flag. `(*)` only once the form is ready.
 * `plan-changed` clears the error and ignores the plan already chosen.
 * `stripe-refused` returns with its error. Only one way to pay runs at a
 * time: Pay and Stripe's page each start only from `collecting`.
 * `teardown` also clears an idle state's error.
 */
export type DirectCheckoutMachineState =
  | { readonly kind: "idle"; readonly error: string | null }
  | {
      readonly kind: "starting";
      readonly attempt: number;
      readonly plan: DirectCheckoutPlan;
      readonly emailComplete: boolean;
      /** The provider form rendered; it can report this before `mounted`. */
      readonly formReady: boolean;
    }
  | {
      readonly kind: "collecting";
      readonly attempt: number;
      readonly plan: DirectCheckoutPlan;
      readonly emailComplete: boolean;
      readonly formReady: boolean;
      readonly session: DirectCheckoutSession;
      readonly error: string | null;
    }
  | {
      readonly kind: "confirming";
      readonly attempt: number;
      readonly plan: DirectCheckoutPlan;
      readonly emailComplete: boolean;
      readonly session: DirectCheckoutSession;
    }
  | {
      /** Stripe's hosted page for the form's plan is being opened. */
      readonly kind: "opening-stripe";
      readonly attempt: number;
      readonly plan: DirectCheckoutPlan;
      readonly emailComplete: boolean;
      readonly session: DirectCheckoutSession;
    };

export type DirectCheckoutEvent =
  /** Subscribe: open the form for the plan the buyer chose. */
  | {
      readonly type: "begin";
      readonly attempt: number;
      readonly plan: DirectCheckoutPlan;
    }
  /** The provider form's billing email became complete or incomplete. */
  | {
      readonly type: "email-changed";
      readonly attempt: number;
      readonly complete: boolean;
    }
  /** Every provider element rendered and accepts input. */
  | { readonly type: "form-ready"; readonly attempt: number }
  /** The provider form failed to load after mounting. */
  | {
      readonly type: "load-failed";
      readonly attempt: number;
      readonly error: string;
    }
  /** The payment element mounted into the panel's host. */
  | {
      readonly type: "mounted";
      readonly attempt: number;
      readonly session: DirectCheckoutSession;
    }
  /** No host, or the provider form could not be mounted. */
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
  /** The buyer chose another offered plan while the form is open. */
  | {
      readonly type: "plan-changed";
      readonly attempt: number;
      readonly plan: DirectCheckoutPlan;
    }
  /**
   * The server refused the chosen plan as no longer offered (the roster
   * outgrew it, or its Price was retired), at Pay or when opening Stripe's
   * page. Nothing was charged; the form shows a plan that no longer applies,
   * so it closes and the offer reloads.
   */
  | {
      readonly type: "plan-unavailable";
      readonly attempt: number;
      readonly error: string;
    }
  /** Paid, or cancelled by the provider: the session is spent. */
  | { readonly type: "confirmed"; readonly attempt: number }
  /** Pay on Stripe's hosted page instead, for the form's plan. */
  | { readonly type: "open-stripe" }
  /** The buyer is on Stripe's page; the inline form closes. */
  | { readonly type: "stripe-opened"; readonly attempt: number }
  /** Stripe's page could not be opened; the form stays for another try. */
  | {
      readonly type: "stripe-refused";
      readonly attempt: number;
      readonly error: string;
    }
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
        ? {
            kind: "starting",
            attempt: event.attempt,
            plan: event.plan,
            emailComplete: false,
            formReady: false,
          }
        : state;
    case "confirm":
      return state.kind === "collecting" && state.formReady
        ? {
            kind: "confirming",
            attempt: state.attempt,
            plan: state.plan,
            emailComplete: state.emailComplete,
            session: state.session,
          }
        : state;
    case "open-stripe":
      return state.kind === "collecting" && state.formReady
        ? {
            kind: "opening-stripe",
            attempt: state.attempt,
            plan: state.plan,
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
  { readonly type: "begin" | "confirm" | "open-stripe" | "teardown" }
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
        "opening-stripe",
      ) && state.emailComplete !== event.complete
        ? { ...state, emailComplete: event.complete }
        : state;
    case "confirm-failed":
      return inAttempt(state, attempt, "confirming")
        ? { ...state, kind: "collecting", formReady: true, error: event.error }
        : state;
    case "plan-changed":
      return inAttempt(state, attempt, "collecting") &&
        state.plan.priceId !== event.plan.priceId
        ? { ...state, plan: event.plan, error: null }
        : state;
    case "plan-unavailable":
      return inAttempt(
        state,
        attempt,
        "collecting",
        "confirming",
        "opening-stripe",
      )
        ? { kind: "idle", error: event.error }
        : state;
    case "confirmed":
      return inAttempt(state, attempt, "confirming")
        ? IDLE_DIRECT_CHECKOUT
        : state;
    case "stripe-opened":
    case "stripe-refused":
      return transitionStripePage(state, event);
    default:
      return transitionLoad(state, event);
  }
}

/** Answers to opening Stripe's hosted page for the form's plan. */
function transitionStripePage(
  state: DirectCheckoutMachineState,
  event: Extract<
    AttemptEvent,
    { readonly type: "stripe-opened" | "stripe-refused" }
  >,
): DirectCheckoutMachineState {
  if (!inAttempt(state, event.attempt, "opening-stripe")) {
    return state;
  }
  return event.type === "stripe-opened"
    ? IDLE_DIRECT_CHECKOUT
    : { ...state, kind: "collecting", formReady: true, error: event.error };
}

/** The element mount and the provider form's load. */
type LoadEvent = Extract<
  AttemptEvent,
  { readonly type: "form-ready" | "load-failed" | "mounted" | "start-failed" }
>;

function transitionLoad(
  state: DirectCheckoutMachineState,
  event: LoadEvent,
): DirectCheckoutMachineState {
  const { attempt } = event;
  switch (event.type) {
    case "form-ready":
      return inAttempt(state, attempt, "starting", "collecting") &&
        !state.formReady
        ? { ...state, formReady: true }
        : state;
    case "load-failed":
      return inAttempt(state, attempt, "starting", "collecting")
        ? { kind: "idle", error: event.error }
        : state;
    case "mounted":
      return inAttempt(state, attempt, "starting")
        ? { ...state, kind: "collecting", session: event.session, error: null }
        : state;
    case "start-failed":
      return inAttempt(state, attempt, "starting")
        ? { kind: "idle", error: event.error }
        : state;
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled direct checkout event: ${JSON.stringify(value)}`);
}
