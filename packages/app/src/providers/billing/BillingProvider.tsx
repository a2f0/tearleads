import {
  type OrganizationBilling,
  type OrganizationBillingView,
  requestAllDomainSyncLanes,
  resolveOrganizationBillingView,
  type SyncBillingGate,
} from "@tearleads/client-sdk";
import {
  createContext,
  type Dispatch,
  type PropsWithChildren,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
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

interface ScopedBillingState {
  readonly organizationId: string | null;
  readonly billing: OrganizationBilling | null;
  readonly loading: boolean;
  readonly error: string | null;
}

function emptyBillingState(organizationId: string | null): ScopedBillingState {
  return {
    organizationId,
    billing: null,
    loading: organizationId !== null,
    error: null,
  };
}

interface BillingRequestGuard {
  readonly activeOrganizationIdRef: {
    readonly current: string | null;
  };
  readonly billingMutationVersionRef: {
    current: number;
  };
  readonly readRequestIdRef: {
    current: number;
  };
  readonly scopeGenerationRef: {
    current: number;
  };
  readonly trialRequestIdRef: {
    current: number;
  };
}

interface BillingReadRequest {
  readonly billingMutationVersion: number;
  readonly organizationId: string;
  readonly requestId: number;
  readonly scopeGeneration: number;
}

function organizationScopeIsCurrent(
  guard: BillingRequestGuard,
  organizationId: string,
  scopeGeneration: number,
): boolean {
  return (
    guard.activeOrganizationIdRef.current === organizationId &&
    guard.scopeGenerationRef.current === scopeGeneration
  );
}

function readRequestIsCurrent(
  guard: BillingRequestGuard,
  request: BillingReadRequest,
): boolean {
  return (
    organizationScopeIsCurrent(
      guard,
      request.organizationId,
      request.scopeGeneration,
    ) &&
    guard.readRequestIdRef.current === request.requestId &&
    guard.billingMutationVersionRef.current === request.billingMutationVersion
  );
}

function useBillingRefresh(
  client: BillingClient,
  organizationId: string | null,
  guard: BillingRequestGuard,
  setState: Dispatch<SetStateAction<ScopedBillingState>>,
): () => Promise<void> {
  return useCallback(async () => {
    if (guard.activeOrganizationIdRef.current !== organizationId) {
      return;
    }
    if (!organizationId) {
      setState(emptyBillingState(null));
      return;
    }
    const request: BillingReadRequest = {
      billingMutationVersion: guard.billingMutationVersionRef.current,
      organizationId,
      requestId: ++guard.readRequestIdRef.current,
      scopeGeneration: guard.scopeGenerationRef.current,
    };
    setState((current) => ({
      organizationId,
      billing:
        current.organizationId === organizationId ? current.billing : null,
      loading: true,
      error: null,
    }));
    try {
      const next = await client.organizations.loadBilling();
      if (!readRequestIsCurrent(guard, request)) {
        return;
      }
      const validBilling =
        next?.organizationId === organizationId ? next : null;
      setState({
        organizationId,
        billing: validBilling,
        loading: false,
        error: validBilling ? null : BILLING_LABELS.failedLoadBilling,
      });
    } catch (loadError) {
      if (!readRequestIsCurrent(guard, request)) {
        return;
      }
      console.error("Failed to load organization billing:", loadError);
      setState({
        organizationId,
        billing: null,
        loading: false,
        error: BILLING_LABELS.failedLoadBilling,
      });
    }
  }, [client, guard, organizationId, setState]);
}

function useStartBillingTrial(
  client: BillingClient,
  organizationId: string | null,
  guard: BillingRequestGuard,
  setState: Dispatch<SetStateAction<ScopedBillingState>>,
): () => Promise<boolean> {
  return useCallback(async (): Promise<boolean> => {
    if (
      !organizationId ||
      guard.activeOrganizationIdRef.current !== organizationId
    ) {
      return false;
    }
    const scopeGeneration = guard.scopeGenerationRef.current;
    const trialRequestId = ++guard.trialRequestIdRef.current;
    guard.billingMutationVersionRef.current++;
    setState((current) => ({
      organizationId,
      billing:
        current.organizationId === organizationId ? current.billing : null,
      loading: false,
      error: null,
    }));
    try {
      const next = await client.organizations.startTrial();
      if (
        !organizationScopeIsCurrent(guard, organizationId, scopeGeneration) ||
        guard.trialRequestIdRef.current !== trialRequestId
      ) {
        return false;
      }
      guard.billingMutationVersionRef.current++;
      if (next?.organizationId === organizationId) {
        setState({
          organizationId,
          billing: next,
          loading: false,
          error: null,
        });
        return true;
      }
      setState((current) => ({
        organizationId,
        billing:
          current.organizationId === organizationId ? current.billing : null,
        loading: false,
        error: BILLING_LABELS.failedStartTrial,
      }));
    } catch (trialError) {
      if (
        !organizationScopeIsCurrent(guard, organizationId, scopeGeneration) ||
        guard.trialRequestIdRef.current !== trialRequestId
      ) {
        return false;
      }
      guard.billingMutationVersionRef.current++;
      console.error("Failed to start the free trial:", trialError);
      setState((current) => ({
        organizationId,
        billing:
          current.organizationId === organizationId ? current.billing : null,
        loading: false,
        error: BILLING_LABELS.failedStartTrial,
      }));
    }
    return false;
  }, [client, guard, organizationId, setState]);
}

/**
 * Dependency-injected core of the billing provider. Billing methods on the SDK
 * facade operate on the active organization, so every result is scoped back to
 * the organization that initiated it. The returned value is memoized so this
 * root-level context reference stays stable across unrelated re-renders — only a
 * real billing/loading/error change churns it. Exported for direct hook testing
 * without the full SDK/session provider stack.
 */
export function useOrganizationBillingState(
  client: BillingClient,
  organizationId: string | null,
): OrganizationBillingContextValue {
  const [state, setState] = useState<ScopedBillingState>(() =>
    emptyBillingState(organizationId),
  );
  const activeOrganizationIdRef = useRef(organizationId);
  const billingMutationVersionRef = useRef(0);
  const readRequestIdRef = useRef(0);
  const scopeGenerationRef = useRef(0);
  const trialRequestIdRef = useRef(0);
  const guard = useMemo<BillingRequestGuard>(
    () => ({
      activeOrganizationIdRef,
      billingMutationVersionRef,
      readRequestIdRef,
      scopeGenerationRef,
      trialRequestIdRef,
    }),
    [],
  );
  const refresh = useBillingRefresh(client, organizationId, guard, setState);
  const startTrial = useStartBillingTrial(
    client,
    organizationId,
    guard,
    setState,
  );

  useLayoutEffect(() => {
    activeOrganizationIdRef.current = organizationId;
    // Setup and cleanup both invalidate every request type across scope changes;
    // dedicated counters only order work within one organization scope.
    scopeGenerationRef.current++;
    return () => {
      scopeGenerationRef.current++;
    };
  }, [organizationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const stateMatchesActiveOrganization =
    state.organizationId === organizationId;
  const billing = stateMatchesActiveOrganization ? state.billing : null;
  const loading = stateMatchesActiveOrganization
    ? state.loading
    : organizationId !== null;
  const error = stateMatchesActiveOrganization ? state.error : null;

  return useMemo(
    () => ({ billing, loading, error, refresh, startTrial }),
    [billing, loading, error, refresh, startTrial],
  );
}

const OrganizationBillingContext =
  createContext<OrganizationBillingContextValue | null>(null);

type SyncBillingBlock = Pick<SyncBillingGate, "isBlockedForOrganization">;

/** Whether a payment block can be safely cleared in the active org's scope. */
export function syncBillingBlockAppliesToOrganization(
  block: SyncBillingBlock,
  organizationId: string,
): boolean {
  return block.isBlockedForOrganization(organizationId);
}

/**
 * Shares one billing snapshot for the active organization across the app: the
 * org-manager billing panel and the app-shell billing banner read the same
 * source and the same refresh, so a single GET backs both.
 */
export function BillingProvider({ children }: PropsWithChildren) {
  const tearleads = useTearleads();
  const { isAuthenticated, organizationId } = useCryptoSession();
  const activeOrganizationId = isAuthenticated ? organizationId : null;
  const value = useOrganizationBillingState(tearleads, activeOrganizationId);
  const { billing, refresh } = value;

  // When a sync write is rejected for payment (HTTP 402), refetch billing so the
  // banner flips to the sync-paused state without waiting for a remount. Ignore
  // blocks for a different org than the active one; an unknown org (null) still
  // refetches, since the active org is the usual sync target.
  useEffect(
    () =>
      tearleads.syncBillingGate.subscribe((blockedOrganizationId) => {
        if (
          activeOrganizationId !== null &&
          (blockedOrganizationId === null ||
            blockedOrganizationId === activeOrganizationId)
        ) {
          void refresh();
        }
      }),
    [activeOrganizationId, refresh, tearleads],
  );

  // On re-activation (billing recovered to a syncable state after a block): a
  // rejected 402 write leaves its sync lane idle with no auto-resume, so
  // re-drive every lane to flush the stranded writes, then clear this org so a
  // later lapse re-signals instead of being coalesced against the stale value.
  // Keyed on `billing` (not a derived `canSync`) so any refetch that shows the
  // org syncable clears a stale block, even when `canSync` never toggled — e.g.
  // a transient 402 whose refetch still reports the org as active. A block
  // naming another org remains intact until that organization is active again.
  useEffect(() => {
    if (!billing) {
      return;
    }
    const view = resolveOrganizationBillingView(billing, Date.now());
    if (!view.canSync) {
      return;
    }
    const gate = tearleads.syncBillingGate;
    if (!syncBillingBlockAppliesToOrganization(gate, billing.organizationId)) {
      return;
    }
    requestAllDomainSyncLanes(tearleads.domainScope);
    gate.clearBlock(billing.organizationId);
  }, [billing, tearleads]);

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
