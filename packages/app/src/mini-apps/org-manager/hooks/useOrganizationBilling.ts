import {
  type OrganizationBilling,
  type OrganizationBillingView,
  resolveOrganizationBillingView,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { ORG_MANAGER_LABELS } from "../labels";

interface UseOrganizationBillingResult {
  readonly billing: OrganizationBilling | null;
  /** Derived display/gating view (`null` until billing loads). */
  readonly view: OrganizationBillingView | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  /** Start the free trial (admin-only server-side); returns whether it succeeded. */
  readonly startTrial: () => Promise<boolean>;
}

/**
 * Loads the active organization's sync-billing snapshot and derives its display
 * view. Billing methods on the SDK facade operate on the active organization, so
 * `organizationId` is used only to re-fetch when the active org changes.
 */
export function useOrganizationBilling(
  organizationId: string | null,
): UseOrganizationBillingResult {
  const tearleads = useTearleads();
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
      const next = await tearleads.organizations.loadBilling();
      if (requestId !== requestIdRef.current) {
        return;
      }
      setBilling(next);
      if (!next) {
        setError(ORG_MANAGER_LABELS.failedLoadBilling);
      }
    } catch {
      if (requestId === requestIdRef.current) {
        setError(ORG_MANAGER_LABELS.failedLoadBilling);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [organizationId, tearleads]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startTrial = useCallback(async (): Promise<boolean> => {
    setError(null);
    try {
      const next = await tearleads.organizations.startTrial();
      if (next) {
        setBilling(next);
        return true;
      }
      setError(ORG_MANAGER_LABELS.failedStartTrial);
      return false;
    } catch {
      setError(ORG_MANAGER_LABELS.failedStartTrial);
      return false;
    }
  }, [tearleads]);

  // Derived per render (not memoized) so `Date.now()` stays fresh — the trial
  // countdown and sync gating must reflect the current time, and
  // `resolveOrganizationBillingView` is cheap enough to recompute each render.
  const view: OrganizationBillingView | null = billing
    ? resolveOrganizationBillingView(billing, Date.now())
    : null;

  return { billing, view, loading, error, refresh, startTrial };
}
