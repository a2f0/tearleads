import type { OrganizationBillingManagementUrl } from "@tearleads/client-sdk";
import { useEffect, useRef, useState } from "react";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";

interface ManagementUrlState {
  readonly canCancelDirectly: boolean;
  readonly organizationId: string | null;
  readonly managementUrl: string | null;
  readonly subscriptionSource: OrganizationBillingManagementUrl["subscriptionSource"];
}

/**
 * Loads the active organization's subscription-management URL through the SDK
 * facade so an admin can open the provider's manage/cancel page. The server
 * resolves the URL from the organization's stored customer id, so it works for
 * ANY admin — not just the buyer whose device holds the subscription. `enabled`
 * gates the fetch (only for admins of an org that has a provider-managed
 * subscription). `reloadToken` re-fetches when it changes — pass the billing
 * snapshot so a billing refresh keeps the link current. Both a load error and a
 * "no managed subscription" resolve to a null URL, which hides the manage button
 * rather than surfacing an error for what is only a convenience link.
 */
export function useBillingManagementUrl(
  organizationId: string,
  enabled: boolean,
  reloadToken?: unknown,
): {
  readonly canCancelDirectly: boolean;
  readonly managementUrl: string | null;
  readonly subscriptionSource: OrganizationBillingManagementUrl["subscriptionSource"];
} {
  const tearleads = useTearleads();
  const requestIdRef = useRef(0);
  const [state, setState] = useState<ManagementUrlState>({
    canCancelDirectly: false,
    organizationId: null,
    managementUrl: null,
    subscriptionSource: null,
  });

  useEffect(() => {
    // Drop any in-flight request from a previous org/enabled state.
    const requestId = ++requestIdRef.current;
    if (!enabled) {
      setState({
        canCancelDirectly: false,
        organizationId,
        managementUrl: null,
        subscriptionSource: null,
      });
      return;
    }
    void (async () => {
      try {
        const result = await tearleads.organizations.loadBillingManagementUrl();
        if (requestIdRef.current !== requestId) {
          return;
        }
        setState({
          canCancelDirectly: result?.canCancelDirectly ?? false,
          organizationId,
          managementUrl: result?.managementUrl ?? null,
          subscriptionSource: result?.subscriptionSource ?? null,
        });
      } catch (loadError) {
        if (requestIdRef.current !== requestId) {
          return;
        }
        console.error("Failed to load billing management URL:", loadError);
        setState({
          canCancelDirectly: false,
          organizationId,
          managementUrl: null,
          subscriptionSource: null,
        });
      }
    })();
    return () => {
      requestIdRef.current++;
    };
  }, [enabled, organizationId, tearleads, reloadToken]);

  // Scope the URL to the requesting org so a stale value never leaks across an
  // org switch before the new fetch resolves.
  return state.organizationId === organizationId
    ? {
        canCancelDirectly: state.canCancelDirectly,
        managementUrl: state.managementUrl,
        subscriptionSource: state.subscriptionSource,
      }
    : {
        canCancelDirectly: false,
        managementUrl: null,
        subscriptionSource: null,
      };
}
