import type { StripeSyncOptionResponse } from "@tearleads/validators/response";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDirectCheckout as useDirectCheckoutCapability } from "../../../providers/direct-checkout/DirectCheckoutProvider";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { ORG_MANAGER_LABELS } from "../labels";
import { readCheckoutAppearance } from "./checkoutAppearance";

/**
 * Orchestrates the in-app card checkout (issue #1654): load the option, start
 * a checkout on the server, mount the payment element into the panel, confirm,
 * then hand off to the existing activation poll.
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
  | { readonly kind: "confirming" }
  | { readonly kind: "activating" };

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

interface DirectCheckoutSessionHandle {
  confirm(): Promise<{ kind: string; message?: string }>;
  unmount(): void;
}

/**
 * Loads the single purchasable sync option once the platform can actually buy.
 * Split out so the flow hook below stays within the per-function budget.
 */
function useCheckoutOption(
  available: boolean,
  canSubscribe: boolean,
  tearleads: ReturnType<typeof useTearleads>,
): StripeSyncOptionResponse | null {
  const [option, setOption] = useState<StripeSyncOptionResponse | null>(null);
  useEffect(() => {
    if (!available || !canSubscribe) {
      setOption(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result =
          await tearleads.organizations.loadStripeCheckoutOptions();
        if (!cancelled) {
          setOption(result?.options[0] ?? null);
        }
      } catch {
        if (!cancelled) {
          setOption(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [available, canSubscribe, tearleads]);
  return option;
}

export function useDirectCheckoutFlow(input: {
  readonly canSubscribe: boolean;
  readonly organizationId: string;
  readonly onActivated: () => void;
}): DirectCheckoutState {
  const capability = useDirectCheckoutCapability();
  const tearleads = useTearleads();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<DirectCheckoutSessionHandle | null>(null);
  const [phase, setPhase] = useState<DirectCheckoutPhase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const available = capability.isAvailable;
  const option = useCheckoutOption(available, input.canSubscribe, tearleads);

  const teardown = useCallback(() => {
    sessionRef.current?.unmount();
    sessionRef.current = null;
  }, []);

  // The element must never outlive the panel that hosts it.
  useEffect(() => teardown, [teardown]);

  const cancel = useCallback(() => {
    teardown();
    setPhase({ kind: "idle" });
    setError(null);
  }, [teardown]);

  const begin = useCallback(() => {
    if (!available || !input.canSubscribe) {
      return;
    }
    setPhase({ kind: "starting" });
    setError(null);
    void (async () => {
      try {
        const intent = await tearleads.organizations.createStripeCheckout();
        const host = hostRef.current;
        if (!intent || !host) {
          setPhase({ kind: "idle" });
          setError(ORG_MANAGER_LABELS.billingCheckoutUnavailable);
          return;
        }
        sessionRef.current = await capability.mount({
          host,
          clientSecret: intent.clientSecret,
          appearance: readCheckoutAppearance(host),
        });
        setPhase({ kind: "collecting" });
      } catch (mountError) {
        console.error("Failed to start the direct checkout:", mountError);
        teardown();
        setPhase({ kind: "idle" });
        setError(ORG_MANAGER_LABELS.billingCheckoutUnavailable);
      }
    })();
  }, [available, capability, input.canSubscribe, tearleads, teardown]);

  const confirm = useCallback(() => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    setPhase({ kind: "confirming" });
    setError(null);
    void (async () => {
      try {
        const outcome = await session.confirm();
        if (outcome.kind === "declined") {
          // The element stays mounted so the buyer can correct their input.
          setPhase({ kind: "collecting" });
          setError(outcome.message ?? ORG_MANAGER_LABELS.failedSubscribe);
          return;
        }
        if (outcome.kind === "cancelled") {
          setPhase({ kind: "idle" });
          return;
        }
        // Paid. The entitlement arrives via Stripe → RevenueCat → our webhook,
        // so hand off to the existing activation poll rather than assuming.
        teardown();
        setPhase({ kind: "activating" });
        input.onActivated();
      } catch (confirmError) {
        console.error("Failed to confirm the direct checkout:", confirmError);
        setPhase({ kind: "collecting" });
        setError(ORG_MANAGER_LABELS.failedSubscribe);
      }
    })();
  }, [input, teardown]);

  return {
    available,
    option,
    phase,
    error,
    hostRef,
    begin,
    confirm,
    cancel,
  };
}
