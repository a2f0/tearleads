import { useEffect, useRef, useState } from "react";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";

interface ManagementUrlState {
  readonly organizationId: string | null;
  readonly managementUrl: string | null;
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
 *
 * Two providers can own a subscription now (issue #1654): one bought through
 * RevenueCat, one bought through the in-app card checkout on our own Stripe
 * account. RevenueCat is asked first because it still fronts the store
 * purchases; the Stripe billing portal is the fallback for a subscription it
 * does not know about. Both resolve server-side from the org's stored customer
 * id, so either works for any admin.
 */
/**
 * Resolves the Stripe billing portal for an org whose subscription RevenueCat
 * does not manage. A null here is the ordinary answer (no Stripe customer, or
 * the integration is unconfigured), so it degrades to no manage button rather
 * than an error.
 */
async function resolveStripePortalUrl(
  tearleads: ReturnType<typeof useTearleads>,
): Promise<string | null> {
  try {
    const portal = await tearleads.organizations.createStripePortalUrl(
      globalThis.location?.href ?? "",
    );
    return portal?.portalUrl ?? null;
  } catch (portalError) {
    console.error("Failed to load the Stripe billing portal:", portalError);
    return null;
  }
}

export function useBillingManagementUrl(
  organizationId: string,
  enabled: boolean,
  reloadToken?: unknown,
): string | null {
  const tearleads = useTearleads();
  const requestIdRef = useRef(0);
  const [state, setState] = useState<ManagementUrlState>({
    organizationId: null,
    managementUrl: null,
  });

  useEffect(() => {
    // Drop any in-flight request from a previous org/enabled state.
    const requestId = ++requestIdRef.current;
    if (!enabled) {
      setState({ organizationId, managementUrl: null });
      return;
    }
    void (async () => {
      try {
        const result = await tearleads.organizations.loadBillingManagementUrl();
        if (requestIdRef.current !== requestId) {
          return;
        }
        const managementUrl =
          result?.managementUrl ??
          // No RevenueCat-managed subscription: the org may have bought
          // through our own Stripe checkout instead. Return here so the
          // portal session lands the admin back on this page.
          (await resolveStripePortalUrl(tearleads));
        if (requestIdRef.current !== requestId) {
          return;
        }
        setState({ organizationId, managementUrl });
      } catch (loadError) {
        if (requestIdRef.current !== requestId) {
          return;
        }
        console.error("Failed to load billing management URL:", loadError);
        setState({ organizationId, managementUrl: null });
      }
    })();
    return () => {
      requestIdRef.current++;
    };
  }, [enabled, organizationId, tearleads, reloadToken]);

  // Scope the URL to the requesting org so a stale value never leaks across an
  // org switch before the new fetch resolves.
  return state.organizationId === organizationId ? state.managementUrl : null;
}
