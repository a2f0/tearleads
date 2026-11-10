import type {
  DirectCheckoutCapability,
  Tearleads,
} from "@tearleads/client-sdk";
import type { StripeSyncOptionResponse } from "@tearleads/validators/response";
import { useCallback, useEffect, useRef } from "react";
import { readCheckoutAppearance } from "../billing/checkoutAppearance";
import {
  CHECKOUT_LABELS,
  checkoutPayErrorMessage,
  isCheckoutPlanUnavailable,
} from "../billing/checkoutCopy";
import { ORG_MANAGER_LABELS } from "../labels";
import type {
  DirectCheckoutEvent,
  DirectCheckoutMachineState,
  DirectCheckoutPlan,
} from "./directCheckoutMachine";

/**
 * The checkout's begin, mount, and Pay effects (`billing/useDirectCheckout.ts`).
 * The machine (`directCheckoutMachine.ts`) decides; these run the work a
 * state calls for and report back with the attempt they belong to.
 */

/**
 * The flow's state machine. The ref is the machine and the state copy renders
 * it: a second click that lands before React re-renders reads the ref, so it
 * can neither start a second checkout nor charge the card twice.
 */
export interface CheckoutMachine {
  readonly hostRef: React.RefObject<HTMLDivElement | null>;
  readonly current: () => DirectCheckoutMachineState;
  /** Applies `event`; returns the new state, or null when it was ignored. */
  readonly send: (
    event: DirectCheckoutEvent,
  ) => DirectCheckoutMachineState | null;
  readonly nextAttempt: () => number;
}

export type LogError = (message: string | Error, cause?: unknown) => void;

export interface BeginCheckoutDeps {
  readonly available: boolean;
  readonly canSubscribe: boolean;
  readonly enabled: boolean;
  /** The plans on offer; a form opens only for one of them. */
  readonly options: readonly StripeSyncOptionResponse[];
}

/** The plan a form shows for an offered option; null without a Stripe price. */
function planOf(
  options: readonly StripeSyncOptionResponse[],
  option: StripeSyncOptionResponse,
): DirectCheckoutPlan | null {
  return options.includes(option) && option.unitAmount !== null
    ? {
        priceId: option.priceId,
        amount: option.unitAmount,
        currency: option.currency,
      }
    : null;
}

/** Subscribe: opens the form for the chosen plan. Nothing starts server-side. */
export function useBeginCheckout(
  machine: CheckoutMachine,
  deps: BeginCheckoutDeps,
): (option: StripeSyncOptionResponse) => void {
  return useCallback(
    (option: StripeSyncOptionResponse) => {
      const plan = planOf(deps.options, option);
      if (!deps.available || !deps.canSubscribe || !deps.enabled || !plan) {
        return;
      }
      // Ignored unless idle: a second begin would strand the previous
      // element's iframe. The UI prevents this today; the hook must not
      // depend on that.
      machine.send({ type: "begin", attempt: machine.nextAttempt(), plan });
    },
    [deps, machine],
  );
}

/**
 * Switches the open form to another offered plan: the machine records it, so
 * Pay starts that plan, and the form re-prices in place. Ignored while
 * paying.
 */
export function useChangePlan(
  machine: CheckoutMachine,
  options: readonly StripeSyncOptionResponse[],
): (option: StripeSyncOptionResponse) => void {
  return useCallback(
    (option: StripeSyncOptionResponse) => {
      const current = machine.current();
      const plan = planOf(options, option);
      if (current.kind !== "collecting" || !plan) {
        return;
      }
      const next = machine.send({
        type: "plan-changed",
        attempt: current.attempt,
        plan,
      });
      if (next?.kind === "collecting") {
        next.session.updatePrice({
          amount: plan.amount,
          currency: plan.currency,
        });
      }
    },
    [machine, options],
  );
}

export interface MountCheckoutDeps {
  readonly capability: DirectCheckoutCapability;
  readonly logError: LogError;
}

async function mountCheckout(
  machine: CheckoutMachine,
  attempt: number,
  plan: DirectCheckoutPlan,
  deps: MountCheckoutDeps,
): Promise<void> {
  const unavailable = CHECKOUT_LABELS.unavailable;
  try {
    const host = machine.hostRef.current;
    if (!host) {
      machine.send({ type: "start-failed", attempt, error: unavailable });
      return;
    }
    const session = await deps.capability.mount({
      host,
      price: { amount: plan.amount, currency: plan.currency },
      appearance: readCheckoutAppearance(host),
      // The machine ignores a late event from an abandoned element, so it
      // cannot unlock Pay on the panel.
      onBillingEmailChange: (email) => {
        machine.send({
          type: "email-changed",
          attempt,
          complete: email !== null,
        });
      },
      onReady: () => {
        machine.send({ type: "form-ready", attempt });
      },
      // Leaving the session's state unmounts it, so a retry starts clean.
      onLoadError: (loadError) => {
        deps.logError("The direct checkout form failed to load", loadError);
        machine.send({ type: "load-failed", attempt, error: unavailable });
      },
    });
    // The panel may have unmounted (or the flow been cancelled) while the
    // provider script loaded; keeping this session would strand its iframe
    // with nothing able to destroy it.
    if (!machine.send({ type: "mounted", attempt, session })) {
      session.unmount();
    }
  } catch (mountError) {
    deps.logError("Failed to start the direct checkout", mountError);
    machine.send({ type: "start-failed", attempt, error: unavailable });
  }
}

/**
 * Mounts the provider form on entering `starting`, after React has committed
 * the render that lays out the host: the provider sizes its frames from the
 * host, so mounting from the Subscribe click, while the host is still
 * `display: none`, would collapse the form. Each attempt mounts once.
 */
export function useMountOnStart(
  machine: CheckoutMachine,
  state: DirectCheckoutMachineState,
  deps: MountCheckoutDeps,
): void {
  const latestDeps = useRef(deps);
  useEffect(() => {
    latestDeps.current = deps;
  });
  const mountedAttempt = useRef<number | null>(null);
  const starting = state.kind === "starting" ? state : null;
  const attempt = starting?.attempt ?? null;
  const plan = starting?.plan ?? null;
  useEffect(() => {
    if (attempt === null || plan === null) {
      return;
    }
    if (mountedAttempt.current === attempt) {
      return;
    }
    mountedAttempt.current = attempt;
    void mountCheckout(machine, attempt, plan, latestDeps.current);
  }, [attempt, machine, plan]);
}

export interface ConfirmCheckoutDeps {
  readonly logError: LogError;
  /** Marks activation pending and starts the shared billing poll. */
  readonly onPaid: () => void;
  readonly organizationId: string;
  /** Fetches the offer again after the server refused the chosen plan. */
  readonly reloadOptions: () => void;
  readonly tearleads: Tearleads;
}

/**
 * The server refused the attempt's plan as no longer offered, so nothing was
 * charged: close the form, which shows a plan that no longer applies, and
 * reload the offer at the current plans.
 */
function closeUnavailablePlan(
  machine: CheckoutMachine,
  attempt: number,
  reloadOptions: () => void,
): void {
  const closed = machine.send({
    type: "plan-unavailable",
    attempt,
    error: CHECKOUT_LABELS.planUnavailable,
  });
  if (closed) {
    reloadOptions();
  }
}

/** Points the blank tab at Stripe's page, or this tab when it was blocked. */
function navigateToStripe(tab: Window | null | undefined, url: string): void {
  if (tab) {
    // Sever the child's back-reference before it navigates cross-origin, so
    // the Stripe page cannot reach into this window (reverse tabnabbing); the
    // blank tab is still same-origin here.
    tab.opener = null;
    tab.location.href = url;
  } else {
    // The pop-up was blocked: fall back to same-tab navigation rather than
    // leaving the click dead.
    globalThis.location?.assign(url);
  }
}

/**
 * Pay on Stripe's hosted page instead, for the form's plan. The tab is opened
 * SYNCHRONOUSLY on the click — before the `await` — because a `window.open`
 * issued after an await is treated as programmatic and blocked by pop-up
 * blockers; the blank tab holds the user gesture and is pointed at the minted
 * URL once it resolves.
 *
 * The machine runs one way to pay at a time, and every answer names its
 * attempt: only the form that asked navigates (this tab included, when the
 * pop-up was blocked) and closes, so a late answer for a cancelled or
 * replaced form changes nothing. A refusal returns to the form with a notice;
 * a plan no longer offered closes it and reloads the plans, as at Pay.
 */
export function useOpenStripePage(
  machine: CheckoutMachine,
  deps: ConfirmCheckoutDeps,
): () => void {
  return useCallback(() => {
    const opening = machine.send({ type: "open-stripe" });
    if (opening?.kind !== "opening-stripe") {
      return;
    }
    const { attempt, plan } = opening;
    const tab = globalThis.open?.("about:blank", "_blank");
    const refuse = () => {
      tab?.close();
      machine.send({
        type: "stripe-refused",
        attempt,
        error: CHECKOUT_LABELS.payOnStripeUnavailable,
      });
    };
    void (async () => {
      try {
        const session =
          await deps.tearleads.organizations.createStripeCheckoutSession(
            plan.priceId,
            globalThis.location?.href ?? "",
            deps.organizationId,
          );
        // Unconfigured, or no organization signed in.
        if (!session?.url) {
          refuse();
          return;
        }
        if (!machine.send({ type: "stripe-opened", attempt })) {
          tab?.close();
          return;
        }
        navigateToStripe(tab, session.url);
      } catch (error) {
        if (isCheckoutPlanUnavailable(error)) {
          tab?.close();
          closeUnavailablePlan(machine, attempt, deps.reloadOptions);
          return;
        }
        // Not eligible, a checkout already in progress, or a failure.
        deps.logError("Failed to open the hosted Stripe checkout", error);
        refuse();
      }
    })();
  }, [deps, machine]);
}

/** Settles a Pay that threw: the server refused it, or the provider failed. */
function settleFailedPay(
  machine: CheckoutMachine,
  attempt: number,
  payError: unknown,
  deps: ConfirmCheckoutDeps,
): void {
  if (isCheckoutPlanUnavailable(payError)) {
    closeUnavailablePlan(machine, attempt, deps.reloadOptions);
    return;
  }
  deps.logError("Failed to confirm the direct checkout", payError);
  machine.send({
    type: "confirm-failed",
    attempt,
    error: checkoutPayErrorMessage(payError),
  });
}

/**
 * Pay: the server starts the subscription at the plan the form shows, and
 * the session confirms its payment. Every continuation names its attempt:
 * teardown (cancel, org switch, disable, unmount) ends it, and writing state
 * for a checkout the user already left would resurrect a dead form.
 */
export function useConfirmCheckout(
  machine: CheckoutMachine,
  deps: ConfirmCheckoutDeps,
): () => void {
  return useCallback(() => {
    // Ignored unless collecting. The Pay button disables itself while
    // confirming, but only after a re-render; the hook must not depend on the
    // UI to prevent a double charge.
    const confirming = machine.send({ type: "confirm" });
    if (confirming?.kind !== "confirming") {
      return;
    }
    const { attempt, plan, session } = confirming;
    const startPayment = async () => {
      const intent = await deps.tearleads.organizations.createStripeCheckout(
        plan.priceId,
        deps.organizationId,
      );
      if (!intent) {
        throw new Error("No signed-in organization to subscribe");
      }
      return intent.clientSecret;
    };
    void (async () => {
      try {
        const outcome = await session.confirm(startPayment);
        // Do not trust the session to report `cancelled` after a teardown —
        // the capability contract does not require it; the machine ignores
        // an attempt the user has already left.
        if (outcome.kind === "declined") {
          // The element stays mounted so the buyer can correct their input;
          // the next Pay resumes the same subscription.
          machine.send({
            type: "confirm-failed",
            attempt,
            error: outcome.message ?? ORG_MANAGER_LABELS.failedSubscribe,
          });
          return;
        }
        // Paid or cancelled, the session is spent: `confirmed` unmounts it
        // and returns to idle, so a later begin works again. Paid goes back
        // to idle too, not a checkout-owned "activating" state: the
        // entitlement arrives via Stripe → RevenueCat → our webhook, the
        // shared billing view renders activation-pending from the flag
        // `onPaid` sets, and a phase parked here would have no exit if that
        // poll gave up.
        const finished = machine.send({ type: "confirmed", attempt });
        if (finished && outcome.kind !== "cancelled") {
          deps.onPaid();
        }
      } catch (payError) {
        settleFailedPay(machine, attempt, payError, deps);
      }
    })();
  }, [deps, machine]);
}
