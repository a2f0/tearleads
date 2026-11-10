import type {
  DirectCheckoutCapability,
  Tearleads,
} from "@tearleads/client-sdk";
import type { StripeSyncOptionResponse } from "@tearleads/validators/response";
import { useCallback, useEffect, useRef } from "react";
import {
  CHECKOUT_LABELS,
  checkoutPayErrorMessage,
  isCheckoutPriceChanged,
} from "../billing/billingCheckoutErrors";
import { readCheckoutAppearance } from "../billing/checkoutAppearance";
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
  /** The offer the buyer clicked Subscribe on. */
  readonly option: StripeSyncOptionResponse | null;
}

/** Subscribe: opens the form for the offered plan. Nothing starts server-side. */
export function useBeginCheckout(
  machine: CheckoutMachine,
  deps: BeginCheckoutDeps,
): () => void {
  return useCallback(() => {
    const { option } = deps;
    if (
      !deps.available ||
      !deps.canSubscribe ||
      !deps.enabled ||
      !option ||
      option.unitAmount === null
    ) {
      return;
    }
    // Ignored unless idle: a second begin would strand the previous
    // element's iframe. The UI prevents this today; the hook must not depend
    // on that.
    machine.send({
      type: "begin",
      attempt: machine.nextAttempt(),
      plan: {
        priceId: option.priceId,
        amount: option.unitAmount,
        currency: option.currency,
      },
    });
  }, [deps, machine]);
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
  const unavailable = ORG_MANAGER_LABELS.billingCheckoutUnavailable;
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
  /** Fetches the offer again after a Pay the roster change repriced. */
  readonly reloadOption: () => void;
  readonly tearleads: Tearleads;
}

/** Settles a Pay that threw: the server refused it, or the provider failed. */
function settleFailedPay(
  machine: CheckoutMachine,
  attempt: number,
  payError: unknown,
  deps: ConfirmCheckoutDeps,
): void {
  if (isCheckoutPriceChanged(payError)) {
    // Nothing was charged, and the form shows a price that no longer
    // applies: close it and offer the current plan instead.
    const repriced = machine.send({
      type: "repriced",
      attempt,
      error: CHECKOUT_LABELS.priceChanged,
    });
    if (repriced) {
      deps.reloadOption();
    }
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
