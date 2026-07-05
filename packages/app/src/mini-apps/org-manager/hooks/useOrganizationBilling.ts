import {
  type OrganizationBilling,
  type OrganizationBillingView,
  resolveOrganizationBillingView,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
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

  const refresh = useCallback(async () => {
    if (!organizationId) {
      setBilling(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await tearleads.organizations.loadBilling();
      setBilling(next);
      if (!next) {
        setError(ORG_MANAGER_LABELS.failedLoadBilling);
      }
    } catch {
      setError(ORG_MANAGER_LABELS.failedLoadBilling);
    } finally {
      setLoading(false);
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

  const view = useMemo<OrganizationBillingView | null>(
    () =>
      billing ? resolveOrganizationBillingView(billing, Date.now()) : null,
    [billing],
  );

  return { billing, view, loading, error, refresh, startTrial };
}
