import type { OrganizationBillingHistoryEntry } from "@tearleads/client-sdk";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { ORG_MANAGER_LABELS } from "../labels";
import { useScopedOrganizationLoad } from "./useScopedOrganizationLoad";

interface BillingHistorySnapshot {
  readonly entries: ReadonlyArray<OrganizationBillingHistoryEntry> | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * Loads the active organization's billing lifecycle history through the SDK
 * facade (mirroring how the billing snapshot is loaded). The facade reads the
 * ACTIVE organization, so every result is scoped back to the organization that
 * requested it and stale responses are dropped. `enabled` gates the fetch:
 * the panel only requests history for org admins. `reloadToken` re-fetches when
 * it changes — pass the billing snapshot so a billing refresh (the activation
 * poll or the Refresh button) also refreshes the history, keeping the two in
 * sync instead of leaving the history stale after a purchase.
 */
export function useBillingHistory(
  organizationId: string,
  enabled: boolean,
  reloadToken?: unknown,
): BillingHistorySnapshot {
  const tearleads = useTearleads();
  const snapshot = useScopedOrganizationLoad<BillingHistorySnapshot>({
    enabled,
    load: async () => {
      try {
        const history = await tearleads.organizations.loadBillingHistory();
        const scoped =
          history?.organizationId === organizationId ? history : null;
        return {
          entries: scoped?.entries ?? null,
          error: scoped ? null : ORG_MANAGER_LABELS.failedLoadBillingHistory,
          loading: false,
        };
      } catch (loadError) {
        console.error("Failed to load billing history:", loadError);
        return {
          entries: null,
          error: ORG_MANAGER_LABELS.failedLoadBillingHistory,
          loading: false,
        };
      }
    },
    // Preserve already-loaded rows across a background reload (a billing
    // refresh bumps reloadToken) so the list does not flicker; only the first
    // load for an organization shows the loading state.
    onBegin: (previousValue) =>
      previousValue && previousValue.entries !== null
        ? { entries: previousValue.entries, error: null, loading: false }
        : { entries: null, error: null, loading: true },
    organizationId,
    reloadToken,
  });

  return snapshot ?? { entries: null, error: null, loading: enabled };
}
