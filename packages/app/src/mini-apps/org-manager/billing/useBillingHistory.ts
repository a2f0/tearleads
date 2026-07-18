import type { OrganizationBillingHistoryEntry } from "@tearleads/client-sdk";
import { useEffect, useRef, useState } from "react";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { ORG_MANAGER_LABELS } from "../labels";

interface BillingHistorySnapshot {
  readonly entries: ReadonlyArray<OrganizationBillingHistoryEntry> | null;
  readonly loading: boolean;
  readonly error: string | null;
}

interface BillingHistoryState extends BillingHistorySnapshot {
  readonly organizationId: string | null;
}

/**
 * Loads the active organization's billing lifecycle history through the SDK
 * facade (mirroring how the billing snapshot is loaded). The facade reads the
 * ACTIVE organization, so every result is scoped back to the organization that
 * requested it and stale responses are dropped. `enabled` gates the fetch:
 * the panel only requests history for org admins.
 */
export function useBillingHistory(
  organizationId: string,
  enabled: boolean,
): BillingHistorySnapshot {
  const tearleads = useTearleads();
  const requestIdRef = useRef(0);
  const [state, setState] = useState<BillingHistoryState>({
    organizationId: null,
    entries: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const requestId = ++requestIdRef.current;
    setState({ organizationId, entries: null, loading: true, error: null });
    void (async () => {
      try {
        const history = await tearleads.organizations.loadBillingHistory();
        if (requestIdRef.current !== requestId) {
          return;
        }
        const scoped =
          history?.organizationId === organizationId ? history : null;
        setState({
          organizationId,
          entries: scoped?.entries ?? null,
          loading: false,
          error: scoped ? null : ORG_MANAGER_LABELS.failedLoadBillingHistory,
        });
      } catch (loadError) {
        if (requestIdRef.current !== requestId) {
          return;
        }
        console.error("Failed to load billing history:", loadError);
        setState({
          organizationId,
          entries: null,
          loading: false,
          error: ORG_MANAGER_LABELS.failedLoadBillingHistory,
        });
      }
    })();
    return () => {
      requestIdRef.current++;
    };
  }, [enabled, organizationId, tearleads]);

  const scoped = state.organizationId === organizationId;
  return {
    entries: scoped ? state.entries : null,
    loading: scoped ? state.loading : enabled,
    error: scoped ? state.error : null,
  };
}
