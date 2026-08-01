import type {
  DirectCheckoutCapability,
  DirectCheckoutSession,
} from "@tearleads/client-sdk";
import type { StripeSyncOptionResponse } from "@tearleads/validators/response";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDirectCheckout as useDirectCheckoutCapability } from "../../../providers/direct-checkout/DirectCheckoutProvider";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { ORG_MANAGER_LABELS } from "../labels";
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
  readonly phase: DirectCheckoutPhase;
  readonly error: string | null;
  /** Attach to the element the payment form mounts into. */
  readonly hostRef: React.RefObject<HTMLDivElement | null>;
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
function useCheckoutLifecycle(
  scopeKey: string,
  teardown: () => void,
  reset: () => void,
): void {
  useEffect(() => {
    // `scopeKey` is intentionally a dependency without appearing in the body:
    // React runs the CLEANUP when a dependency changes, which is exactly the
    // teardown-on-scope-change this needs (plus teardown on unmount).
    return () => {
      teardown();
      reset();
    };
  }, [scopeKey, teardown, reset]);
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
          await tearleads.organizations.loadStripeCheckoutOptions();
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
  }, [available, canSubscribe, enabled, tearleads]);
  return state;
}

/** Maps the server's stable roster-policy failures to actionable copy. */
export function checkoutOptionErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof error.message === "string"
        ? error.message
        : String(error);
  if (message.includes("exceeds the maximum subscription tier")) {
    return ORG_MANAGER_LABELS.billingCheckoutOverCapacity;
  }
  if (message.includes("has no active members")) {
    return ORG_MANAGER_LABELS.billingCheckoutNoMembers;
  }
  return ORG_MANAGER_LABELS.billingCheckoutUnavailable;
}

/** Refs the begin/confirm actions share with the flow hook. */
interface CheckoutRefs {
  readonly hostRef: React.RefObject<HTMLDivElement | null>;
  readonly sessionRef: React.RefObject<DirectCheckoutSession | null>;
  /** Bumped by every begin/teardown so a late mount can detect it lost. */
  readonly startTokenRef: React.RefObject<number>;
  /**
   * True while a confirm is in flight. A ref, not the `confirming` phase:
   * state writes are asynchronous, so two clicks landing in the same React
   * batch would both read the pre-render phase and charge the card twice.
   */
  readonly confirmingRef: React.RefObject<boolean>;
  /**
   * True from the moment `begin` fires until the element mounts or the
   * attempt fails. `sessionRef` alone leaves the `starting` window open, so
   * two clicks in one React batch would both reach the server.
   */
  readonly startingRef: React.RefObject<boolean>;
  readonly setPhase: (phase: DirectCheckoutPhase) => void;
  readonly setError: (error: string | null) => void;
}

interface BeginCheckoutDeps {
  readonly available: boolean;
  readonly canSubscribe: boolean;
  readonly enabled: boolean;
  readonly capability: DirectCheckoutCapability;
  readonly tearleads: ReturnType<typeof useTearleads>;
  readonly teardown: () => void;
}

/**
 * Starts a checkout on the server and mounts the payment element into the
 * panel's host.
 */
function useBeginCheckout(
  refs: CheckoutRefs,
  deps: BeginCheckoutDeps,
): () => void {
  return useCallback(() => {
    if (!deps.available || !deps.canSubscribe || !deps.enabled) {
      return;
    }
    // Re-entrancy guard: a second begin would bump the token and overwrite
    // sessionRef, stranding the previous element's iframe. The UI prevents
    // this today; the hook must not depend on that. Both refs are needed —
    // `sessionRef` covers a mounted element, `startingRef` the window before
    // it mounts, where state has not re-rendered yet.
    if (refs.sessionRef.current || refs.startingRef.current) {
      return;
    }
    refs.startingRef.current = true;
    refs.setPhase({ kind: "starting" });
    refs.setError(null);
    refs.startTokenRef.current += 1;
    const token = refs.startTokenRef.current;
    void (async () => {
      try {
        const intent =
          await deps.tearleads.organizations.createStripeCheckout();
        // Every continuation re-checks the token: teardown (cancel, org
        // switch, disable, unmount) bumps it, and a losing attempt must
        // neither write state onto the panel it no longer owns nor cancel the
        // attempt that replaced it.
        if (refs.startTokenRef.current !== token) {
          return;
        }
        const host = refs.hostRef.current;
        if (!intent || !host) {
          refs.startingRef.current = false;
          refs.setPhase({ kind: "idle" });
          refs.setError(ORG_MANAGER_LABELS.billingCheckoutUnavailable);
          return;
        }
        const session = await deps.capability.mount({
          host,
          clientSecret: intent.clientSecret,
          appearance: readCheckoutAppearance(host),
        });
        // The panel may have unmounted (or the flow been cancelled) while the
        // provider script loaded; keeping this session would strand its
        // iframe with nothing able to destroy it.
        if (refs.startTokenRef.current !== token) {
          session.unmount();
          return;
        }
        refs.startingRef.current = false;
        refs.sessionRef.current = session;
        refs.setPhase({ kind: "collecting" });
      } catch (mountError) {
        console.error("Failed to start the direct checkout:", mountError);
        // Same guard: calling the shared teardown here would bump the token
        // and cancel a newer attempt started after this one failed.
        if (refs.startTokenRef.current !== token) {
          return;
        }
        refs.startingRef.current = false;
        refs.sessionRef.current = null;
        refs.setPhase({ kind: "idle" });
        refs.setError(ORG_MANAGER_LABELS.billingCheckoutUnavailable);
      }
    })();
  }, [deps, refs]);
}

/**
 * Confirms the mounted payment. Every continuation re-checks the start token:
 * teardown (cancel, org switch, disable, unmount) bumps it, and writing state
 * for a checkout the user already left would resurrect a dead form.
 */
function useConfirmCheckout(
  refs: CheckoutRefs,
  teardown: () => void,
  onPaid: () => void,
): () => void {
  return useCallback(() => {
    const session = refs.sessionRef.current;
    // Re-entrancy guard. The Pay button disables itself while confirming, but
    // that only takes effect after a re-render; the hook must not depend on
    // the UI to prevent a double charge.
    if (!session || refs.confirmingRef.current) {
      return;
    }
    refs.confirmingRef.current = true;
    refs.setPhase({ kind: "confirming" });
    refs.setError(null);
    const token = refs.startTokenRef.current;
    void (async () => {
      try {
        const outcome = await session.confirm();
        // Teardown (cancel, org switch, unmount) bumps the token. Do not
        // trust the session to report `cancelled` for us — the capability
        // contract does not require it — and never write state belonging to
        // a checkout the user has already left.
        if (refs.startTokenRef.current !== token) {
          return;
        }
        refs.confirmingRef.current = false;
        if (outcome.kind === "declined") {
          // The element stays mounted so the buyer can correct their input.
          refs.setPhase({ kind: "collecting" });
          refs.setError(outcome.message ?? ORG_MANAGER_LABELS.failedSubscribe);
          return;
        }
        if (outcome.kind === "cancelled") {
          // Tear down rather than only resetting the phase: the session is
          // spent, and leaving `sessionRef` populated would make the
          // re-entrancy guard in `begin` reject every later attempt. The web
          // capability does not return this today, but the contract permits
          // it, so a conforming implementation must not strand the panel.
          teardown();
          refs.setPhase({ kind: "idle" });
          return;
        }
        // Paid. The entitlement arrives via Stripe → RevenueCat → our webhook,
        // so hand off to the shared activation poll rather than assuming.
        teardown();
        // Back to idle, not a checkout-owned "activating" state: the shared
        // billing view already renders activation-pending from the flag
        // `onPaid` sets, and a phase parked here would have no exit if the
        // poll gave up.
        refs.setPhase({ kind: "idle" });
        refs.setError(null);
        onPaid();
      } catch (confirmError) {
        console.error("Failed to confirm the direct checkout:", confirmError);
        refs.confirmingRef.current = false;
        if (refs.startTokenRef.current !== token) {
          return;
        }
        refs.setPhase({ kind: "collecting" });
        refs.setError(ORG_MANAGER_LABELS.failedSubscribe);
      }
    })();
  }, [onPaid, refs, teardown]);
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
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<DirectCheckoutSession | null>(null);
  /** Bumped by every begin/teardown so a late mount can detect it lost. */
  const startTokenRef = useRef(0);
  const confirmingRef = useRef(false);
  const startingRef = useRef(false);
  const [phase, setPhase] = useState<DirectCheckoutPhase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const available = capability.isAvailable;
  const checkoutOption = useCheckoutOption(
    available,
    input.canSubscribe,
    input.enabled,
    tearleads,
  );

  const teardown = useCallback(() => {
    startTokenRef.current += 1;
    confirmingRef.current = false;
    startingRef.current = false;
    sessionRef.current?.unmount();
    sessionRef.current = null;
  }, []);

  const reset = useCallback(() => {
    setPhase({ kind: "idle" });
    setError(null);
  }, []);

  useCheckoutLifecycle(
    `${input.organizationId}:${input.enabled}`,
    teardown,
    reset,
  );

  // Memoized: these are `useCallback` dependencies, so rebuilding them each
  // render would give `begin`/`confirm` a new identity every time and defeat
  // the memoization their consumers rely on.
  const refs = useMemo<CheckoutRefs>(
    () => ({
      hostRef,
      sessionRef,
      startTokenRef,
      confirmingRef,
      startingRef,
      setPhase,
      setError,
    }),
    [],
  );
  const deps = useMemo<BeginCheckoutDeps>(
    () => ({
      available,
      canSubscribe: input.canSubscribe,
      enabled: input.enabled,
      capability,
      tearleads,
      teardown,
    }),
    [
      available,
      capability,
      input.canSubscribe,
      input.enabled,
      tearleads,
      teardown,
    ],
  );

  const cancel = useCallback(() => {
    teardown();
    reset();
  }, [reset, teardown]);

  const begin = useBeginCheckout(refs, deps);

  const confirm = useConfirmCheckout(refs, teardown, input.onPaid);

  return {
    available,
    option: checkoutOption.option,
    phase,
    error: error ?? checkoutOption.error,
    hostRef,
    begin,
    confirm,
    cancel,
  };
}
