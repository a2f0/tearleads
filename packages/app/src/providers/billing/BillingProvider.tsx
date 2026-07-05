import {
  type OrganizationBilling,
  type OrganizationBillingView,
  resolveOrganizationBillingView,
} from "@tearleads/client-sdk";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useCryptoSession } from "../crypto/CryptoSessionProvider";
import { useTearleads } from "../sdk/TearleadsProvider";
import { BILLING_LABELS } from "./billingLabels";

interface OrganizationBillingContextValue {
  readonly billing: OrganizationBilling | null;
  /** Derived display/gating view (`null` until billing loads). */
  readonly view: OrganizationBillingView | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  /** Start the free trial (admin-only server-side); returns whether it succeeded. */
  readonly startTrial: () => Promise<boolean>;
}

/** The billing methods this provider needs from the SDK facade. */
interface BillingClient {
  readonly organizations: {
    readonly loadBilling: () => Promise<OrganizationBilling | null>;
    readonly startTrial: () => Promise<OrganizationBilling | null>;
  };
}

/**
 * Dependency-injected core of the billing provider. Billing methods on the SDK
 * facade operate on the active organization, so `organizationId` is used only to
 * re-fetch when the active org changes. Exported for direct hook testing without
 * the full SDK/session provider stack.
 */
export function useOrganizationBillingState(
  client: BillingClient,
  organizationId: string | null,
): OrganizationBillingContextValue {
  const [billing, setBilling] = useState<OrganizationBilling | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Monotonic request token: only the latest in-flight fetch may commit state,
  // so an older response resolving late cannot clobber newer billing data.
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!organizationId) {
      setBilling(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await client.organizations.loadBilling();
      if (requestId !== requestIdRef.current) {
        return;
      }
      setBilling(next);
      if (!next) {
        setError(BILLING_LABELS.failedLoadBilling);
      }
    } catch {
      if (requestId === requestIdRef.current) {
        setError(BILLING_LABELS.failedLoadBilling);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [organizationId, client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startTrial = useCallback(async (): Promise<boolean> => {
    setError(null);
    try {
      const next = await client.organizations.startTrial();
      if (next) {
        setBilling(next);
        return true;
      }
      setError(BILLING_LABELS.failedStartTrial);
      return false;
    } catch {
      setError(BILLING_LABELS.failedStartTrial);
      return false;
    }
  }, [client]);

  // Derived per render (not memoized) so `Date.now()` stays fresh — the trial
  // countdown and sync gating must reflect the current time, and
  // `resolveOrganizationBillingView` is cheap enough to recompute each render.
  const view: OrganizationBillingView | null = billing
    ? resolveOrganizationBillingView(billing, Date.now())
    : null;

  return { billing, view, loading, error, refresh, startTrial };
}

const OrganizationBillingContext =
  createContext<OrganizationBillingContextValue | null>(null);

/**
 * Shares one billing snapshot for the active organization across the app: the
 * org-manager billing panel and the app-shell billing banner read the same
 * source and the same refresh, so a single GET backs both.
 */
export function BillingProvider({ children }: PropsWithChildren) {
  const tearleads = useTearleads();
  const { organizationId } = useCryptoSession();
  const value = useOrganizationBillingState(tearleads, organizationId);
  return (
    <OrganizationBillingContext.Provider value={value}>
      {children}
    </OrganizationBillingContext.Provider>
  );
}

export function useOrganizationBilling(): OrganizationBillingContextValue {
  const context = useContext(OrganizationBillingContext);
  if (!context) {
    throw new Error(
      "useOrganizationBilling must be used within a BillingProvider.",
    );
  }
  return context;
}
