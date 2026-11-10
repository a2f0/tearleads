import type { Tearleads } from "@tearleads/client-sdk";
import type { StripeSyncOptionResponse } from "@tearleads/validators/response";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDirectCheckout as useDirectCheckoutCapability } from "../../../providers/direct-checkout/DirectCheckoutProvider";
import { useLog } from "../../../providers/logging/LogProvider";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import {
  CHECKOUT_OPTION_OFF,
  type CheckoutOptionEvent,
  type CheckoutOptionState,
  transitionCheckoutOption,
} from "../model/checkoutOptionMachine";
import {
  type BeginCheckoutDeps,
  type CheckoutMachine,
  type ConfirmCheckoutDeps,
  useBeginCheckout,
  useChangePlan,
  useConfirmCheckout,
  useMountOnStart,
  useOpenStripePage,
} from "../model/directCheckoutActions";
import {
  type DirectCheckoutMachineState,
  IDLE_DIRECT_CHECKOUT,
  transitionDirectCheckout,
} from "../model/directCheckoutMachine";
import { checkoutOptionErrorMessage } from "./checkoutCopy";

/**
 * Orchestrates the in-app card checkout (issue #1654): load the plans that
 * cover the roster, mount the payment element for the one the buyer chooses
 * (switchable while the form is open), and on Pay have the server start the
 * subscription at that plan, confirm it, then hand off to the shared
 * activation poll. Nothing exists on the server until Pay.
 *
 * The hand-off matters: a confirmed payment does NOT mean the org can sync
 * yet — the entitlement travels Stripe → RevenueCat → our webhook, which
 * typically lands after a single refresh would have read the old status. So
 * success calls `onPaid`, which the panel wires to the SAME
 * `activationPending` flag `useBillingActions` uses, re-using its backoff
 * poll rather than refreshing once and appearing stuck.
 *
 * Deliberately NOT modelled on `useBillingActions`' purchases flow: there the
 * provider owned an uncancellable UI, which forced the abort/orphan machinery.
 * Here the element is ours — cancelling is just an unmount, so the state
 * machine below is the whole story.
 */

/** Where the flow currently is; drives what the panel renders. */
export type DirectCheckoutPhase =
  | { readonly kind: "idle" }
  /** The provider form is still loading. */
  | { readonly kind: "starting" }
  | { readonly kind: "collecting" }
  | { readonly kind: "confirming" }
  /** Stripe's hosted page for the form's plan is being opened. */
  | { readonly kind: "opening-stripe" };

export interface DirectCheckoutState {
  /** Whether this platform can run the in-app form at all. */
  readonly available: boolean;
  /** Every plan that covers the roster, smallest first; empty while loading. */
  readonly options: readonly StripeSyncOptionResponse[];
  /** The plan the open form shows and Pay starts; null while idle. */
  readonly chosen: StripeSyncOptionResponse | null;
  readonly organizationId: string;
  readonly phase: DirectCheckoutPhase;
  readonly error: string | null;
  /** Attach to the element the payment form mounts into. */
  readonly hostRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Whether the billing email in the provider form is complete; Pay waits
   * for it, since the provider requires it to confirm.
   */
  readonly billingEmailComplete: boolean;
  /** Subscribe: opens the form for one of `options`. */
  readonly begin: (option: StripeSyncOptionResponse) => void;
  /** Switches the open form to another of `options`; ignored while paying. */
  readonly changePlan: (option: StripeSyncOptionResponse) => void;
  /**
   * Pay on Stripe's hosted page instead, for the form's plan; the form closes
   * once the buyer is there. Only one way to pay runs at a time.
   */
  readonly openStripePage: () => void;
  readonly confirm: () => void;
  readonly cancel: () => void;
}

/**
 * Ties the mounted element's lifetime to the panel AND to the organization it
 * was started for. The form shows one org's plan and Pay starts that plan, so
 * paying after an org switch would charge the previous organization's offer
 * while the panel shows the new one — the same scope invalidation
 * `useBillingActions` performs for the provider-hosted flow.
 *
 * Note the panel's `organizationId` and the org the SDK charges cannot
 * disagree: both read `appData.auth.organizationId` (OrgManager passes it
 * down; `createStripeCheckout` resolves it through `authenticatedOrganizationId`).
 * The scope key is still required — switching orgs changes that one value, and
 * this teardown is what stops a form opened for the old org from paying under
 * the new one.
 */
function useCheckoutLifecycle(scopeKey: string, teardown: () => void): void {
  useEffect(() => {
    // `scopeKey` is intentionally a dependency without appearing in the body:
    // React runs the CLEANUP when a dependency changes, which is exactly the
    // teardown-on-scope-change this needs (plus teardown on unmount).
    return () => {
      teardown();
    };
  }, [scopeKey, teardown]);
}

/**
 * Loads the single purchasable sync option once the platform can actually buy
 * (`model/checkoutOptionMachine.ts`). Split out so the flow hook below stays
 * within the per-function budget. `reload` fetches them again, for a plan the
 * server refused as no longer offered; the offer is withdrawn until it lands.
 */
function useCheckoutOption(
  available: boolean,
  canSubscribe: boolean,
  /** The panel is offering the checkout; false for an org that already syncs. */
  enabled: boolean,
  organizationId: string,
  tearleads: Tearleads,
): { readonly offer: CheckoutOptionState; readonly reload: () => void } {
  const [offer, setOffer] = useState(CHECKOUT_OPTION_OFF);
  const send = useCallback((event: CheckoutOptionEvent) => {
    setOffer((current) => transitionCheckoutOption(current, event));
  }, []);
  const [loads, setLoads] = useState(0);
  const reload = useCallback(() => setLoads((count) => count + 1), []);
  useEffect(() => {
    // `reload` bumps `loads` to fetch again after a refused Pay.
    void loads;
    // `enabled` too: an admin of an already-syncing org would otherwise fire
    // this request on every billing-panel mount for an option they cannot buy.
    if (!available || !canSubscribe || !enabled) {
      send({ type: "off" });
      return;
    }
    let cancelled = false;
    send({ type: "load" });
    void (async () => {
      try {
        const result =
          await tearleads.organizations.loadStripeCheckoutOptions(
            organizationId,
          );
        if (!cancelled) {
          // An empty list means the server integration is intentionally not
          // configured. A rejected request is an actionable load failure.
          send({ type: "loaded", options: result?.options ?? NO_OPTIONS });
        }
      } catch (loadError) {
        // A misconfigured integration is otherwise invisible here — the panel
        // just renders nothing.
        console.warn("Failed to load Stripe checkout options:", loadError);
        if (!cancelled) {
          send({
            type: "load-failed",
            error: checkoutOptionErrorMessage(loadError),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    available,
    canSubscribe,
    enabled,
    organizationId,
    send,
    tearleads,
    loads,
  ]);
  return { offer, reload };
}

function useCheckoutOptionForFlow(
  input: Pick<FlowInput, "canSubscribe" | "enabled" | "organizationId">,
  available: boolean,
  tearleads: Tearleads,
) {
  return useCheckoutOption(
    available,
    input.canSubscribe,
    input.enabled,
    input.organizationId,
    tearleads,
  );
}

function useCheckoutMachine(): {
  readonly machine: CheckoutMachine;
  readonly state: DirectCheckoutMachineState;
} {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const current = useRef(IDLE_DIRECT_CHECKOUT);
  const attempts = useRef(0);
  const [state, setState] = useState(IDLE_DIRECT_CHECKOUT);
  const machine = useMemo<CheckoutMachine>(
    () => ({
      hostRef,
      current: () => current.current,
      send: (event) => {
        const previous = current.current;
        const next = transitionDirectCheckout(previous, event);
        if (next === previous) return null;
        current.current = next;
        setState(next);
        // The session belongs to the states holding it: leaving them (cancel,
        // org switch, disable, unmount, a spent confirmation) unmounts it.
        if ("session" in previous && !("session" in next)) {
          previous.session.unmount();
        }
        return next;
      },
      nextAttempt: () => {
        attempts.current += 1;
        return attempts.current;
      },
    }),
    [],
  );
  return { machine, state };
}
const IDLE: DirectCheckoutPhase = { kind: "idle" };
const STARTING: DirectCheckoutPhase = { kind: "starting" };
const COLLECTING: DirectCheckoutPhase = { kind: "collecting" };
const CONFIRMING: DirectCheckoutPhase = { kind: "confirming" };
const OPENING_STRIPE: DirectCheckoutPhase = { kind: "opening-stripe" };

function phaseOf(state: DirectCheckoutMachineState): DirectCheckoutPhase {
  switch (state.kind) {
    case "collecting":
      return state.formReady ? COLLECTING : STARTING;
    case "confirming":
      return CONFIRMING;
    case "opening-stripe":
      return OPENING_STRIPE;
    case "starting":
      return STARTING;
    default:
      return IDLE;
  }
}

function panelError(state: DirectCheckoutMachineState): string | null {
  return state.kind === "idle" || state.kind === "collecting"
    ? state.error
    : null;
}

const NO_OPTIONS: readonly StripeSyncOptionResponse[] = [];

/** The offered plan the open form shows, if any. */
function chosenOption(
  options: readonly StripeSyncOptionResponse[],
  state: DirectCheckoutMachineState,
): StripeSyncOptionResponse | null {
  return state.kind === "idle"
    ? null
    : (options.find((option) => option.priceId === state.plan.priceId) ?? null);
}

type FlowInput = Parameters<typeof useDirectCheckoutFlow>[0];

/**
 * Memoized: these are `useCallback` dependencies, so rebuilding them each
 * render would give `begin`/`confirm` a new identity every time and defeat the
 * memoization their consumers rely on.
 */
function useActionDeps(
  input: FlowInput,
  available: boolean,
  options: readonly StripeSyncOptionResponse[],
  reloadOptions: () => void,
): {
  readonly begin: BeginCheckoutDeps;
  readonly confirm: ConfirmCheckoutDeps;
} {
  const tearleads = useTearleads();
  const { logError } = useLog();
  const begin = useMemo<BeginCheckoutDeps>(
    () => ({
      available,
      canSubscribe: input.canSubscribe,
      enabled: input.enabled,
      options,
    }),
    [available, options, input.canSubscribe, input.enabled],
  );
  const confirm = useMemo<ConfirmCheckoutDeps>(
    () => ({
      logError,
      onPaid: input.onPaid,
      organizationId: input.organizationId,
      reloadOptions,
      tearleads,
    }),
    [input.onPaid, input.organizationId, logError, reloadOptions, tearleads],
  );
  return { begin, confirm };
}

export function useDirectCheckoutFlow(input: {
  readonly canSubscribe: boolean;
  /**
   * Whether the panel is currently offering this checkout. Flipping it off
   * (the org started syncing, admin rights lost) tears down any live element
   * instead of letting its host unmount underneath it.
   */
  readonly enabled: boolean;
  /** Scope key: a change tears down any in-flight checkout (see below). */
  readonly organizationId: string;
  /** Marks activation pending and starts the shared billing poll. */
  readonly onPaid: () => void;
}): DirectCheckoutState {
  const capability = useDirectCheckoutCapability();
  const tearleads = useTearleads();
  const { logError } = useLog();
  const { machine, state } = useCheckoutMachine();
  const available = capability.isAvailable;
  const { offer, reload } = useCheckoutOptionForFlow(
    input,
    available,
    tearleads,
  );
  const cancel = useCallback(() => {
    machine.send({ type: "teardown" });
  }, [machine]);

  useCheckoutLifecycle(`${input.organizationId}:${input.enabled}`, cancel);

  // Only a settled offer can be bought; none exists while it (re)loads.
  const options = offer.status === "ready" ? offer.options : NO_OPTIONS;
  const deps = useActionDeps(input, available, options, reload);
  const begin = useBeginCheckout(machine, deps.begin);
  const changePlan = useChangePlan(machine, options);
  const openStripePage = useOpenStripePage(machine, deps.confirm);
  useMountOnStart(machine, state, { capability, logError });
  const confirm = useConfirmCheckout(machine, deps.confirm);

  return {
    available,
    options,
    chosen: chosenOption(options, state),
    organizationId: input.organizationId,
    phase: phaseOf(state),
    error:
      panelError(state) ?? (offer.status === "failed" ? offer.error : null),
    hostRef: machine.hostRef,
    billingEmailComplete: state.kind !== "idle" && state.emailComplete,
    begin,
    changePlan,
    openStripePage,
    confirm,
    cancel,
  };
}
