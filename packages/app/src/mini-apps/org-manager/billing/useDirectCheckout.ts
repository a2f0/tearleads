import type { StripeSyncOptionResponse } from "@tearleads/validators/response";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDirectCheckout as useDirectCheckoutCapability } from "../../../providers/direct-checkout/DirectCheckoutProvider";
import { useLog } from "../../../providers/logging/LogProvider";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import {
  type BeginCheckoutDeps,
  type CheckoutMachine,
  type ConfirmCheckoutDeps,
  useBeginCheckout,
  useConfirmCheckout,
  useMountOnStart,
} from "../model/directCheckoutActions";
import {
  type DirectCheckoutMachineState,
  IDLE_DIRECT_CHECKOUT,
  transitionDirectCheckout,
} from "../model/directCheckoutMachine";
import { checkoutOptionErrorMessage } from "./billingCheckoutErrors";

/**
 * Orchestrates the in-app card checkout (issue #1654): load the option, mount
 * the payment element for its price, and on Pay have the server start the
 * subscription at that price, confirm it, then hand off to the shared
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
  | { readonly kind: "confirming" };

export interface DirectCheckoutState {
  /** Whether this platform can run the in-app form at all. */
  readonly available: boolean;
  readonly option: StripeSyncOptionResponse | null;
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
  readonly begin: () => void;
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
 * Loads the single purchasable sync option once the platform can actually buy.
 * Split out so the flow hook below stays within the per-function budget.
 * `reload` fetches it again, for a Pay refused because the roster changed
 * the plan.
 */
function useCheckoutOption(
  available: boolean,
  canSubscribe: boolean,
  /** The panel is offering the checkout; false for an org that already syncs. */
  enabled: boolean,
  organizationId: string,
  tearleads: ReturnType<typeof useTearleads>,
): {
  readonly error: string | null;
  readonly option: StripeSyncOptionResponse | null;
  readonly reload: () => void;
} {
  const [state, setState] = useState<{
    readonly error: string | null;
    readonly option: StripeSyncOptionResponse | null;
  }>({ error: null, option: null });
  const [loads, setLoads] = useState(0);
  const reload = useCallback(() => setLoads((count) => count + 1), []);
  useEffect(() => {
    // `reload` bumps `loads` to fetch again after a refused Pay.
    void loads;
    // `enabled` too: an admin of an already-syncing org would otherwise fire
    // this request on every billing-panel mount for an option they cannot buy.
    if (!available || !canSubscribe || !enabled) {
      setState({ error: null, option: null });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result =
          await tearleads.organizations.loadStripeCheckoutOptions(
            organizationId,
          );
        if (!cancelled) {
          const option = result?.options[0] ?? null;
          setState({
            // An empty list means the server integration is intentionally not
            // configured. A rejected request is an actionable load failure.
            error: null,
            option,
          });
        }
      } catch (loadError) {
        // A misconfigured integration is otherwise invisible here — the panel
        // just renders nothing.
        console.warn("Failed to load Stripe checkout options:", loadError);
        if (!cancelled) {
          setState({
            error: checkoutOptionErrorMessage(loadError),
            option: null,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [available, canSubscribe, enabled, organizationId, tearleads, loads]);
  return { ...state, reload };
}

function useCheckoutOptionForFlow(
  input: Pick<
    Parameters<typeof useDirectCheckoutFlow>[0],
    "canSubscribe" | "enabled" | "organizationId"
  >,
  available: boolean,
  tearleads: ReturnType<typeof useTearleads>,
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

function phaseOf(state: DirectCheckoutMachineState): DirectCheckoutPhase {
  switch (state.kind) {
    case "collecting":
      return state.formReady ? COLLECTING : STARTING;
    case "confirming":
      return CONFIRMING;
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
  const checkoutOption = useCheckoutOptionForFlow(input, available, tearleads);
  const cancel = useCallback(() => {
    machine.send({ type: "teardown" });
  }, [machine]);

  useCheckoutLifecycle(`${input.organizationId}:${input.enabled}`, cancel);

  // Memoized: these are `useCallback` dependencies, so rebuilding them each
  // render would give `begin`/`confirm` a new identity every time and defeat
  // the memoization their consumers rely on.
  const beginDeps = useMemo<BeginCheckoutDeps>(
    () => ({
      available,
      canSubscribe: input.canSubscribe,
      enabled: input.enabled,
      option: checkoutOption.option,
    }),
    [available, checkoutOption.option, input.canSubscribe, input.enabled],
  );
  const confirmDeps = useMemo<ConfirmCheckoutDeps>(
    () => ({
      logError,
      onPaid: input.onPaid,
      organizationId: input.organizationId,
      reloadOption: checkoutOption.reload,
      tearleads,
    }),
    [
      checkoutOption.reload,
      input.onPaid,
      input.organizationId,
      logError,
      tearleads,
    ],
  );

  const begin = useBeginCheckout(machine, beginDeps);
  useMountOnStart(machine, state, { capability, logError });
  const confirm = useConfirmCheckout(machine, confirmDeps);

  return {
    available,
    option: checkoutOption.option,
    organizationId: input.organizationId,
    phase: phaseOf(state),
    error: panelError(state) ?? checkoutOption.error,
    hostRef: machine.hostRef,
    billingEmailComplete: state.kind !== "idle" && state.emailComplete,
    begin,
    confirm,
    cancel,
  };
}
