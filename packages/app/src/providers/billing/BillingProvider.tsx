import {
  type OrganizationBilling,
  type OrganizationBillingView,
  requestAllDomainSyncLanes,
  resolveOrganizationBillingView,
} from "@tearleads/client-sdk";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCryptoSession } from "../crypto/CryptoSessionProvider";
import { useTearleads } from "../sdk/TearleadsProvider";
import { BILLING_LABELS } from "./billingLabels";

/** Stable billing snapshot shared via context; the derived view lives in the hook. */
interface OrganizationBillingContextValue {
  readonly billing: OrganizationBilling | null;
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
 * re-fetch when the active org changes. The returned value is memoized so this
 * root-level context reference stays stable across unrelated re-renders — only a
 * real billing/loading/error change churns it. Exported for direct hook testing
 * without the full SDK/session provider stack.
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
    } catch (loadError) {
      console.error("Failed to load organization billing:", loadError);
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
    // Invalidate any in-flight request on unmount / active-org change so a late
    // response cannot commit state after this effect has torn down.
    return () => {
      requestIdRef.current++;
    };
  }, [refresh]);

  const startTrial = useCallback(async (): Promise<boolean> => {
    const requestId = ++requestIdRef.current;
    setError(null);
    try {
      const next = await client.organizations.startTrial();
      if (requestId !== requestIdRef.current) {
        return false;
      }
      if (next) {
        setBilling(next);
        return true;
      }
      setError(BILLING_LABELS.failedStartTrial);
      return false;
    } catch (trialError) {
      console.error("Failed to start the free trial:", trialError);
      if (requestId === requestIdRef.current) {
        setError(BILLING_LABELS.failedStartTrial);
      }
      return false;
    }
  }, [client]);

  return useMemo(
    () => ({ billing, loading, error, refresh, startTrial }),
    [billing, loading, error, refresh, startTrial],
  );
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
  const { billing, refresh } = value;

  // When a sync write is rejected for payment (HTTP 402), refetch billing so the
  // banner flips to the sync-paused state without waiting for a remount. Ignore
  // blocks for a different org than the active one; an unknown org (null) still
  // refetches, since the active org is the usual sync target.
  useEffect(
    () =>
      tearleads.syncBillingGate.subscribe((blockedOrganizationId) => {
        if (
          blockedOrganizationId === null ||
          blockedOrganizationId === organizationId
        ) {
          void refresh();
        }
      }),
    [organizationId, refresh, tearleads],
  );

  // On re-activation (billing recovered to a syncable state after a block): a
  // rejected 402 write leaves its sync lane idle with no auto-resume, so
  // re-drive every lane to flush the stranded writes, then reset the gate so a
  // later lapse re-signals instead of being coalesced against the stale value.
  const canSync = billing
    ? resolveOrganizationBillingView(billing, Date.now()).canSync
    : false;
  useEffect(() => {
    if (!canSync) {
      return;
    }
    const gate = tearleads.syncBillingGate;
    if (gate.isBlocked) {
      requestAllDomainSyncLanes(tearleads.domainScope);
    }
    gate.clearBlock();
  }, [canSync, tearleads]);

  return (
    <OrganizationBillingContext.Provider value={value}>
      {children}
    </OrganizationBillingContext.Provider>
  );
}

/** The shared snapshot plus a per-render `view` derived with a fresh `Date.now()`. */
interface OrganizationBillingSnapshot extends OrganizationBillingContextValue {
  readonly view: OrganizationBillingView | null;
}

export function useOrganizationBilling(): OrganizationBillingSnapshot {
  const context = useContext(OrganizationBillingContext);
  if (!context) {
    throw new Error(
      "useOrganizationBilling must be used within a BillingProvider.",
    );
  }
  // Derived here — not stored in the (memoized) context value and not memoized on
  // `billing` — so `Date.now()` stays fresh for the trial countdown and sync
  // gating, while the context reference above remains stable.
  const view = context.billing
    ? resolveOrganizationBillingView(context.billing, Date.now())
    : null;
  return { ...context, view };
}
