import type { DirectCheckoutCapability } from "@tearleads/client-sdk";
import type { StripeSyncOptionResponse } from "@tearleads/validators/response";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDirectCheckout as useDirectCheckoutCapability } from "../../../providers/direct-checkout/DirectCheckoutProvider";
import { useLog } from "../../../providers/logging/LogProvider";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { ORG_MANAGER_LABELS } from "../labels";
import {
  type DirectCheckoutEvent,
  type DirectCheckoutMachineState,
  IDLE_DIRECT_CHECKOUT,
  transitionDirectCheckout,
} from "../model/directCheckoutMachine";
import { checkoutOptionErrorMessage } from "./billingCheckoutErrors";
import { readCheckoutAppearance } from "./checkoutAppearance";

/**
 * Orchestrates the in-app card checkout (issue #1654): load the option, start
 * a checkout on the server, mount the payment element into the panel, confirm,
 * then hand off to the shared activation poll.
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
 * was started for. The client secret is bound to one org's subscription, so
 * confirming it after an org switch would charge the previous organization
 * while the panel shows the new one — the same scope invalidation
 * `useBillingActions` performs for the provider-hosted flow.
 *
 * Note the panel's `organizationId` and the org the SDK charges cannot
 * disagree: both read `appData.auth.organizationId` (OrgManager passes it
 * down; `createStripeCheckout` resolves it through `authenticatedOrganizationId`).
 * The scope key is still required — switching orgs changes that one value, and
 * this teardown is what stops a secret minted for the old org from being
 * confirmed under the new one.
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
} {
  const [state, setState] = useState<{
    readonly error: string | null;
    readonly option: StripeSyncOptionResponse | null;
  }>({ error: null, option: null });
  useEffect(() => {
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
  }, [available, canSubscribe, enabled, organizationId, tearleads]);
  return state;
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

/**
 * The flow's state machine (`model/directCheckoutMachine.ts`). The ref is
 * the machine and the state copy renders it: a second click that lands before
 * React re-renders reads the ref, so it can neither start a second checkout
 * nor charge the card twice.
 */
interface CheckoutMachine {
  readonly hostRef: React.RefObject<HTMLDivElement | null>;
  readonly current: () => DirectCheckoutMachineState;
  /** Applies `event`; returns the new state, or null when it was ignored. */
  readonly send: (
    event: DirectCheckoutEvent,
  ) => DirectCheckoutMachineState | null;
  readonly nextAttempt: () => number;
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

type LogError = (message: string | Error, cause?: unknown) => void;

interface BeginCheckoutDeps {
  readonly available: boolean;
  readonly canSubscribe: boolean;
  readonly enabled: boolean;
  readonly organizationId: string;
  readonly capability: DirectCheckoutCapability;
  readonly logError: LogError;
  readonly tearleads: ReturnType<typeof useTearleads>;
}

/**
 * Starts a checkout on the server and mounts the payment element into the
 * panel's host.
 */
function useBeginCheckout(
  machine: CheckoutMachine,
  deps: BeginCheckoutDeps,
): () => void {
  return useCallback(() => {
    if (!deps.available || !deps.canSubscribe || !deps.enabled) {
      return;
    }
    // Ignored unless idle: a second begin would strand the previous
    // element's iframe. The UI prevents this today; the hook must not depend
    // on that.
    const attempt = machine.nextAttempt();
    if (!machine.send({ type: "begin", attempt })) {
      return;
    }
    const unavailable = ORG_MANAGER_LABELS.billingCheckoutUnavailable;
    void (async () => {
      try {
        const intent = await deps.tearleads.organizations.createStripeCheckout(
          deps.organizationId,
        );
        // Teardown (cancel, org switch, disable, unmount) ends the attempt,
        // and a losing attempt must neither mount onto the panel it no longer
        // owns nor disturb the attempt that replaced it.
        const now = machine.current();
        if (now.kind !== "starting" || now.attempt !== attempt) {
          return;
        }
        const host = machine.hostRef.current;
        if (!intent || !host) {
          machine.send({ type: "start-failed", attempt, error: unavailable });
          return;
        }
        const session = await deps.capability.mount({
          host,
          clientSecret: intent.clientSecret,
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
        });
        // The panel may have unmounted (or the flow been cancelled) while the
        // provider script loaded; keeping this session would strand its
        // iframe with nothing able to destroy it.
        if (!machine.send({ type: "mounted", attempt, session })) {
          session.unmount();
        }
      } catch (mountError) {
        deps.logError("Failed to start the direct checkout", mountError);
        machine.send({ type: "start-failed", attempt, error: unavailable });
      }
    })();
  }, [deps, machine]);
}

/**
 * Confirms the mounted payment. Every continuation names its attempt:
 * teardown (cancel, org switch, disable, unmount) ends it, and writing state
 * for a checkout the user already left would resurrect a dead form.
 */
function useConfirmCheckout(
  machine: CheckoutMachine,
  onPaid: () => void,
  logError: LogError,
): () => void {
  return useCallback(() => {
    // Ignored unless collecting. The Pay button disables itself while
    // confirming, but only after a re-render; the hook must not depend on the
    // UI to prevent a double charge.
    const confirming = machine.send({ type: "confirm" });
    if (confirming?.kind !== "confirming") {
      return;
    }
    const { attempt, session } = confirming;
    void (async () => {
      try {
        const outcome = await session.confirm();
        // Do not trust the session to report `cancelled` after a teardown —
        // the capability contract does not require it; the machine ignores
        // an attempt the user has already left.
        if (outcome.kind === "declined") {
          // The element stays mounted so the buyer can correct their input.
          machine.send({
            type: "confirm-failed",
            attempt,
            error: outcome.message ?? ORG_MANAGER_LABELS.failedSubscribe,
          });
          return;
        }
        // Paid or cancelled, the session is spent: `confirmed` unmounts it
        // and returns to idle, so a later begin works again. The web
        // capability does not return `cancelled` today, but the contract
        // permits it. Paid goes back to idle too, not a checkout-owned
        // "activating" state: the entitlement arrives via Stripe →
        // RevenueCat → our webhook, the shared billing view renders
        // activation-pending from the flag `onPaid` sets, and a phase parked
        // here would have no exit if that poll gave up.
        const finished = machine.send({ type: "confirmed", attempt });
        if (finished && outcome.kind !== "cancelled") {
          onPaid();
        }
      } catch (confirmError) {
        logError("Failed to confirm the direct checkout", confirmError);
        machine.send({
          type: "confirm-failed",
          attempt,
          error: ORG_MANAGER_LABELS.failedSubscribe,
        });
      }
    })();
  }, [logError, machine, onPaid]);
}

const PHASES: Record<DirectCheckoutMachineState["kind"], DirectCheckoutPhase> =
  {
    idle: { kind: "idle" },
    starting: { kind: "starting" },
    collecting: { kind: "collecting" },
    confirming: { kind: "confirming" },
  };

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
  const deps = useMemo<BeginCheckoutDeps>(
    () => ({
      available,
      canSubscribe: input.canSubscribe,
      enabled: input.enabled,
      organizationId: input.organizationId,
      capability,
      logError,
      tearleads,
    }),
    [
      available,
      capability,
      input.canSubscribe,
      input.enabled,
      input.organizationId,
      logError,
      tearleads,
    ],
  );

  const begin = useBeginCheckout(machine, deps);

  const confirm = useConfirmCheckout(machine, input.onPaid, logError);

  return {
    available,
    option: checkoutOption.option,
    organizationId: input.organizationId,
    phase: PHASES[state.kind],
    error: panelError(state) ?? checkoutOption.error,
    hostRef: machine.hostRef,
    billingEmailComplete: state.kind !== "idle" && state.emailComplete,
    begin,
    confirm,
    cancel,
  };
}
