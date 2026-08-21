import type { OrganizationBillingView } from "@symcrypt/client-sdk";
import { useActiveMiniAppRoute } from "../../mini-apps/miniAppLauncher";
import { useOrganizationBilling } from "../../providers/billing/BillingProvider";
import { BILLING_LABELS } from "../../providers/billing/billingLabels";
import "./BillingBanner.css";

function needsAttentionMessage(view: OrganizationBillingView): string {
  if (view.syncSeatUnavailable) {
    return BILLING_LABELS.bannerSyncSeatUnavailable;
  }
  switch (view.status) {
    case "past_due":
      return BILLING_LABELS.bannerPastDue;
    case "deleting":
      return BILLING_LABELS.bannerDeleting;
    case "purged":
      return BILLING_LABELS.bannerPurged;
    default:
      return BILLING_LABELS.bannerSyncPaused;
  }
}

const BILLING_ROUTE = {
  appId: "org-manager",
  pathSegments: ["billing"],
} as const;

/**
 * Billing warning shown only while sync needs attention (lapsed/disabled/past
 * due) and the active pane route is not Organization Billing itself, where the
 * warning would duplicate the screen it points at. Trial promotion no longer
 * occupies app chrome.
 */
export function BillingBannerView({
  view,
}: {
  view: OrganizationBillingView | null;
}) {
  const activeRoute = useActiveMiniAppRoute();
  // Billing sub-routes retain the same leading segment and hide the banner too.
  const isBillingScreen =
    activeRoute?.appId === BILLING_ROUTE.appId &&
    activeRoute.pathSegments[0] === BILLING_ROUTE.pathSegments[0];

  if (!view || isBillingScreen || !view.needsAttention) {
    return null;
  }

  return (
    <div className="billing-banner billing-banner--warning" role="alert">
      {needsAttentionMessage(view)}
    </div>
  );
}

export function BillingBanner() {
  const { view } = useOrganizationBilling();
  return <BillingBannerView view={view} />;
}
